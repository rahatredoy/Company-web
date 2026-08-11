import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { and, asc, count, desc, eq, ilike, or } from 'drizzle-orm';
import { db } from '../../db/client';
import {
  auditLogs,
  clientAccounts,
  clientBusinessProfiles,
  companyAdmin,
  domains,
  invoices,
  payments,
  plans,
  provisioningJobs,
  supportMessages,
  supportTickets,
  tenants,
} from '../../db/schema/index';
import { config } from '../../config/index';
import { AppError, ERROR_CODES, notFound } from '../../lib/errors';
import { buildMeta, ok, paginated, parseBody, parseParams, parseQuery, paginationSchema, uuidParamSchema } from '../../lib/http';
import { AUDIT_ACTIONS, recordAudit } from '../../lib/audit';
import { PROVISIONING_STEP_LABELS, type ProvisioningStepName } from '../../lib/constants';
import { checkDomain } from '../../lib/dns';
import { emails } from '../../lib/mailer';
import { getSettings, updateSettings } from '../../lib/settings';
import { provisioningStepsView, runProvisioning } from '../../services/provisioning';
import { queueProvisioning } from '../../queues/index';
import { renderInvoiceText } from '../../services/invoice-render';

export default async function adminPlatformRoutes(app: FastifyInstance) {
  // --- Payments ---------------------------------------------------------------

  app.get('/payments', { preHandler: app.requireAdmin }, async (request, reply) => {
    const query = parseQuery(paginationSchema, request.query);
    const search = query.search?.trim();

    const conditions = [];
    if (search) {
      conditions.push(
        or(
          ilike(payments.transactionId, `%${search}%`),
          ilike(payments.reference, `%${search}%`),
          ilike(clientBusinessProfiles.businessName, `%${search}%`),
        ),
      );
    }
    if (query.status && query.status !== 'all') {
      conditions.push(eq(payments.status, query.status as 'pending' | 'paid' | 'failed' | 'refunded'));
    }
    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const base = db
      .select({
        payment: payments,
        planName: plans.name,
        businessName: clientBusinessProfiles.businessName,
        fullName: clientAccounts.fullName,
        clientId: clientAccounts.id,
      })
      .from(payments)
      .innerJoin(clientAccounts, eq(clientAccounts.id, payments.clientAccountId))
      .leftJoin(clientBusinessProfiles, eq(clientBusinessProfiles.clientAccountId, clientAccounts.id))
      .leftJoin(plans, eq(plans.id, payments.planId));

    const rows = await (where ? base.where(where) : base)
      .orderBy(desc(payments.createdAt))
      .limit(query.pageSize)
      .offset((query.page - 1) * query.pageSize);

    const totalBase = db
      .select({ total: count() })
      .from(payments)
      .innerJoin(clientAccounts, eq(clientAccounts.id, payments.clientAccountId))
      .leftJoin(clientBusinessProfiles, eq(clientBusinessProfiles.clientAccountId, clientAccounts.id));

    const totals = await (where ? totalBase.where(where) : totalBase);

    return paginated(
      reply,
      rows.map((row) => ({
        id: row.payment.id,
        transactionId: row.payment.transactionId,
        clientId: row.clientId,
        businessName: row.businessName ?? row.fullName,
        planName: row.planName,
        amount: row.payment.amount,
        currency: row.payment.currency,
        provider: row.payment.provider,
        status: row.payment.status,
        createdAt: row.payment.createdAt,
        paidAt: row.payment.paidAt,
      })),
      buildMeta(query.page, query.pageSize, Number(totals[0]?.total ?? 0)),
    );
  });

  // --- Invoices ---------------------------------------------------------------

  app.get('/invoices', { preHandler: app.requireAdmin }, async (request, reply) => {
    const query = parseQuery(paginationSchema, request.query);
    const search = query.search?.trim();

    const conditions = [];
    if (search) {
      conditions.push(
        or(ilike(invoices.invoiceNumber, `%${search}%`), ilike(clientBusinessProfiles.businessName, `%${search}%`)),
      );
    }
    if (query.status && query.status !== 'all') {
      conditions.push(eq(invoices.status, query.status as 'draft' | 'issued' | 'paid' | 'void' | 'refunded'));
    }
    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const base = db
      .select({
        invoice: invoices,
        planName: plans.name,
        businessName: clientBusinessProfiles.businessName,
        fullName: clientAccounts.fullName,
        clientId: clientAccounts.id,
      })
      .from(invoices)
      .innerJoin(clientAccounts, eq(clientAccounts.id, invoices.clientAccountId))
      .leftJoin(clientBusinessProfiles, eq(clientBusinessProfiles.clientAccountId, clientAccounts.id))
      .leftJoin(plans, eq(plans.id, invoices.planId));

    const rows = await (where ? base.where(where) : base)
      .orderBy(desc(invoices.issuedAt))
      .limit(query.pageSize)
      .offset((query.page - 1) * query.pageSize);

    const totalBase = db
      .select({ total: count() })
      .from(invoices)
      .innerJoin(clientAccounts, eq(clientAccounts.id, invoices.clientAccountId))
      .leftJoin(clientBusinessProfiles, eq(clientBusinessProfiles.clientAccountId, clientAccounts.id));

    const totals = await (where ? totalBase.where(where) : totalBase);

    return paginated(
      reply,
      rows.map((row) => ({
        id: row.invoice.id,
        invoiceNumber: row.invoice.invoiceNumber,
        clientId: row.clientId,
        businessName: row.businessName ?? row.fullName,
        planName: row.planName,
        amount: row.invoice.amount,
        currency: row.invoice.currency,
        status: row.invoice.status,
        issuedAt: row.invoice.issuedAt,
        paidAt: row.invoice.paidAt,
      })),
      buildMeta(query.page, query.pageSize, Number(totals[0]?.total ?? 0)),
    );
  });

  app.get('/invoices/:id/download', { preHandler: app.requireAdmin }, async (request, reply) => {
    const { id } = parseParams(uuidParamSchema, request.params);

    const rows = await db
      .select({ invoice: invoices, planName: plans.name, storeName: tenants.storeName })
      .from(invoices)
      .leftJoin(plans, eq(plans.id, invoices.planId))
      .leftJoin(tenants, eq(tenants.id, invoices.tenantId))
      .where(eq(invoices.id, id))
      .limit(1);

    const row = rows[0];
    if (!row) throw notFound('Invoice not found.');

    reply.header('Content-Type', 'text/plain; charset=utf-8');
    reply.header('Content-Disposition', `attachment; filename="${row.invoice.invoiceNumber}.txt"`);
    return reply.send(renderInvoiceText(row.invoice, row.planName, row.storeName ?? 'Store'));
  });

  app.post('/invoices/:id/send', { preHandler: app.requireAdmin }, async (request, reply) => {
    const { id } = parseParams(uuidParamSchema, request.params);

    const rows = await db
      .select({
        invoice: invoices,
        email: clientAccounts.email,
        fullName: clientAccounts.fullName,
        clientId: clientAccounts.id,
      })
      .from(invoices)
      .innerJoin(clientAccounts, eq(clientAccounts.id, invoices.clientAccountId))
      .where(eq(invoices.id, id))
      .limit(1);

    const row = rows[0];
    if (!row) throw notFound('Invoice not found.');

    await emails.paymentReceived(
      row.email,
      row.fullName,
      `${row.invoice.currency} ${row.invoice.amount}`,
      row.invoice.invoiceNumber,
      { clientAccountId: row.clientId, tenantId: row.invoice.tenantId },
    );

    await db.update(invoices).set({ sentAt: new Date() }).where(eq(invoices.id, id));
    await recordAudit(request, {
      action: AUDIT_ACTIONS.INVOICE_SENT,
      actorId: request.adminAuth!.adminId,
      actorLabel: request.adminAuth!.email,
      clientAccountId: row.clientId,
      targetLabel: row.invoice.invoiceNumber,
    });

    return ok(reply, { sent: true });
  });

  // --- Domains ----------------------------------------------------------------

  app.get('/domains', { preHandler: app.requireAdmin }, async (request, reply) => {
    const query = parseQuery(paginationSchema, request.query);
    const search = query.search?.trim();

    const conditions = [];
    if (search) {
      conditions.push(or(ilike(domains.domain, `%${search}%`), ilike(clientBusinessProfiles.businessName, `%${search}%`)));
    }
    if (query.status && query.status !== 'all') {
      conditions.push(eq(domains.status, query.status as 'pending' | 'verifying' | 'active' | 'failed' | 'disabled'));
    }
    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const base = db
      .select({
        domain: domains,
        businessName: clientBusinessProfiles.businessName,
        fullName: clientAccounts.fullName,
        clientId: clientAccounts.id,
      })
      .from(domains)
      .innerJoin(tenants, eq(tenants.id, domains.tenantId))
      .innerJoin(clientAccounts, eq(clientAccounts.id, tenants.clientAccountId))
      .leftJoin(clientBusinessProfiles, eq(clientBusinessProfiles.clientAccountId, clientAccounts.id));

    const rows = await (where ? base.where(where) : base)
      .orderBy(desc(domains.createdAt))
      .limit(query.pageSize)
      .offset((query.page - 1) * query.pageSize);

    const totalBase = db
      .select({ total: count() })
      .from(domains)
      .innerJoin(tenants, eq(tenants.id, domains.tenantId))
      .innerJoin(clientAccounts, eq(clientAccounts.id, tenants.clientAccountId))
      .leftJoin(clientBusinessProfiles, eq(clientBusinessProfiles.clientAccountId, clientAccounts.id));

    const totals = await (where ? totalBase.where(where) : totalBase);

    return paginated(
      reply,
      rows.map((row) => ({
        id: row.domain.id,
        clientId: row.clientId,
        businessName: row.businessName ?? row.fullName,
        domain: row.domain.domain,
        domainType: row.domain.domainType,
        isPrimary: row.domain.isPrimary,
        verified: row.domain.verified,
        status: row.domain.status,
        createdAt: row.domain.createdAt,
        lastCheckedAt: row.domain.lastCheckedAt,
      })),
      buildMeta(query.page, query.pageSize, Number(totals[0]?.total ?? 0)),
    );
  });

  app.post('/domains/:id/verify', { preHandler: app.requireAdmin }, async (request, reply) => {
    const { id } = parseParams(uuidParamSchema, request.params);

    const rows = await db.select().from(domains).where(eq(domains.id, id)).limit(1);
    const domain = rows[0];
    if (!domain) throw notFound('Domain not found.');
    if (domain.domainType === 'platform_subdomain') {
      throw new AppError(ERROR_CODES.BAD_REQUEST, 'Platform subdomains are managed automatically.', 400);
    }

    const now = new Date();
    const result = await checkDomain(domain.domain, domain.verificationToken ?? '');

    await db
      .update(domains)
      .set({
        verified: result.ownershipVerified,
        status: result.ownershipVerified ? 'active' : 'pending',
        verifiedAt: result.ownershipVerified ? now : null,
        lastCheckedAt: now,
        lastError: result.ownershipVerified ? null : (result.error ?? 'Verification record not found.'),
        updatedAt: now,
      })
      .where(eq(domains.id, id));

    if (result.ownershipVerified) {
      await recordAudit(request, {
        action: AUDIT_ACTIONS.DOMAIN_VERIFIED,
        actorId: request.adminAuth!.adminId,
        actorLabel: request.adminAuth!.email,
        tenantId: domain.tenantId,
        targetLabel: domain.domain,
        newValue: 'active',
      });
    }

    const refreshed = await db.select().from(domains).where(eq(domains.id, id)).limit(1);
    return ok(reply, {
      id: refreshed[0]!.id,
      domain: refreshed[0]!.domain,
      verified: refreshed[0]!.verified,
      status: refreshed[0]!.status,
    });
  });

  app.post('/domains/:id/disable', { preHandler: app.requireAdminReauth }, async (request, reply) => {
    const { id } = parseParams(uuidParamSchema, request.params);

    const rows = await db.select().from(domains).where(eq(domains.id, id)).limit(1);
    const domain = rows[0];
    if (!domain) throw notFound('Domain not found.');
    if (domain.domainType === 'platform_subdomain') {
      throw new AppError(ERROR_CODES.FORBIDDEN, 'The platform subdomain cannot be disabled.', 403);
    }

    await db
      .update(domains)
      .set({ status: 'disabled', isPrimary: false, updatedAt: new Date() })
      .where(eq(domains.id, id));

    await recordAudit(request, {
      action: AUDIT_ACTIONS.DOMAIN_DISABLED,
      actorId: request.adminAuth!.adminId,
      actorLabel: request.adminAuth!.email,
      tenantId: domain.tenantId,
      targetLabel: domain.domain,
      oldValue: domain.status,
      newValue: 'disabled',
    });

    return ok(reply, { disabled: true });
  });

  app.delete('/domains/:id', { preHandler: app.requireAdminReauth }, async (request, reply) => {
    const { id } = parseParams(uuidParamSchema, request.params);

    const rows = await db.select().from(domains).where(eq(domains.id, id)).limit(1);
    const domain = rows[0];
    if (!domain) throw notFound('Domain not found.');
    if (domain.domainType === 'platform_subdomain') {
      throw new AppError(ERROR_CODES.FORBIDDEN, 'The platform subdomain cannot be removed.', 403);
    }

    await db.delete(domains).where(eq(domains.id, id));

    if (domain.isPrimary) {
      await db
        .update(domains)
        .set({ isPrimary: true })
        .where(and(eq(domains.tenantId, domain.tenantId), eq(domains.domainType, 'platform_subdomain')));
    }

    await recordAudit(request, {
      action: AUDIT_ACTIONS.DOMAIN_REMOVED,
      actorId: request.adminAuth!.adminId,
      actorLabel: request.adminAuth!.email,
      tenantId: domain.tenantId,
      targetLabel: domain.domain,
      oldValue: domain.status,
      newValue: 'removed',
    });

    return ok(reply, { removed: true });
  });

  // --- Provisioning -----------------------------------------------------------

  app.get('/provisioning', { preHandler: app.requireAdmin }, async (request, reply) => {
    const query = parseQuery(paginationSchema, request.query);
    const search = query.search?.trim();

    const conditions = [];
    if (search) {
      conditions.push(or(ilike(tenants.tenantRef, `%${search}%`), ilike(clientBusinessProfiles.businessName, `%${search}%`)));
    }
    if (query.status && query.status !== 'all') {
      conditions.push(eq(provisioningJobs.status, query.status as 'pending' | 'creating' | 'completed' | 'failed'));
    }
    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const base = db
      .select({
        job: provisioningJobs,
        tenantRef: tenants.tenantRef,
        businessName: clientBusinessProfiles.businessName,
        fullName: clientAccounts.fullName,
        clientId: clientAccounts.id,
      })
      .from(provisioningJobs)
      .innerJoin(tenants, eq(tenants.id, provisioningJobs.tenantId))
      .innerJoin(clientAccounts, eq(clientAccounts.id, tenants.clientAccountId))
      .leftJoin(clientBusinessProfiles, eq(clientBusinessProfiles.clientAccountId, clientAccounts.id));

    const rows = await (where ? base.where(where) : base)
      .orderBy(desc(provisioningJobs.createdAt))
      .limit(query.pageSize)
      .offset((query.page - 1) * query.pageSize);

    const totalBase = db
      .select({ total: count() })
      .from(provisioningJobs)
      .innerJoin(tenants, eq(tenants.id, provisioningJobs.tenantId))
      .innerJoin(clientAccounts, eq(clientAccounts.id, tenants.clientAccountId))
      .leftJoin(clientBusinessProfiles, eq(clientBusinessProfiles.clientAccountId, clientAccounts.id));

    const totals = await (where ? totalBase.where(where) : totalBase);

    return paginated(
      reply,
      rows.map((row) => ({
        id: row.job.id,
        clientId: row.clientId,
        businessName: row.businessName ?? row.fullName,
        tenantId: row.tenantRef,
        status: row.job.status,
        currentStep: row.job.currentStep,
        steps: provisioningStepsView(row.job.completedSteps).map((entry) => ({
          step: entry.step,
          label: PROVISIONING_STEP_LABELS[entry.step as ProvisioningStepName],
          done: entry.done,
        })),
        errorMessage: row.job.errorMessage,
        startedAt: row.job.startedAt,
        completedAt: row.job.completedAt,
        createdAt: row.job.createdAt,
      })),
      buildMeta(query.page, query.pageSize, Number(totals[0]?.total ?? 0)),
    );
  });

  app.post('/provisioning/:id/retry', { preHandler: app.requireAdmin }, async (request, reply) => {
    const { id } = parseParams(uuidParamSchema, request.params);

    const rows = await db.select().from(provisioningJobs).where(eq(provisioningJobs.id, id)).limit(1);
    const job = rows[0];
    if (!job) throw notFound('Provisioning job not found.', ERROR_CODES.PROVISIONING_NOT_FOUND);
    if (job.status === 'creating') {
      throw new AppError(ERROR_CODES.PROVISIONING_IN_PROGRESS, 'This job is already running.', 409);
    }

    await recordAudit(request, {
      action: AUDIT_ACTIONS.PROVISIONING_RETRIED,
      actorId: request.adminAuth!.adminId,
      actorLabel: request.adminAuth!.email,
      tenantId: job.tenantId,
      oldValue: job.status,
      newValue: 'creating',
    });

    const queued = await queueProvisioning(job.tenantId);
    if (!queued) await runProvisioning(job.tenantId);

    return ok(reply, { retried: true });
  });

  // --- Support ----------------------------------------------------------------

  app.get('/support', { preHandler: app.requireAdmin }, async (request, reply) => {
    const query = parseQuery(paginationSchema, request.query);
    const search = query.search?.trim();

    const conditions = [];
    if (search) {
      conditions.push(
        or(
          ilike(supportTickets.reference, `%${search}%`),
          ilike(supportTickets.subject, `%${search}%`),
          ilike(clientBusinessProfiles.businessName, `%${search}%`),
        ),
      );
    }
    if (query.status && query.status !== 'all') {
      conditions.push(eq(supportTickets.status, query.status as 'open' | 'in_progress' | 'resolved' | 'closed'));
    }
    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const base = db
      .select({
        ticket: supportTickets,
        businessName: clientBusinessProfiles.businessName,
        fullName: clientAccounts.fullName,
        clientId: clientAccounts.id,
      })
      .from(supportTickets)
      .innerJoin(clientAccounts, eq(clientAccounts.id, supportTickets.clientAccountId))
      .leftJoin(clientBusinessProfiles, eq(clientBusinessProfiles.clientAccountId, clientAccounts.id));

    const rows = await (where ? base.where(where) : base)
      .orderBy(desc(supportTickets.createdAt))
      .limit(query.pageSize)
      .offset((query.page - 1) * query.pageSize);

    const totalBase = db
      .select({ total: count() })
      .from(supportTickets)
      .innerJoin(clientAccounts, eq(clientAccounts.id, supportTickets.clientAccountId))
      .leftJoin(clientBusinessProfiles, eq(clientBusinessProfiles.clientAccountId, clientAccounts.id));

    const totals = await (where ? totalBase.where(where) : totalBase);

    return paginated(
      reply,
      rows.map((row) => ({
        id: row.ticket.id,
        reference: row.ticket.reference,
        clientId: row.clientId,
        businessName: row.businessName ?? row.fullName,
        subject: row.ticket.subject,
        status: row.ticket.status,
        priority: row.ticket.priority,
        createdAt: row.ticket.createdAt,
        lastReplyAt: row.ticket.lastReplyAt,
        messageCount: row.ticket.messageCount,
      })),
      buildMeta(query.page, query.pageSize, Number(totals[0]?.total ?? 0)),
    );
  });

  app.get('/support/:id', { preHandler: app.requireAdmin }, async (request, reply) => {
    const { id } = parseParams(uuidParamSchema, request.params);

    const rows = await db
      .select({
        ticket: supportTickets,
        businessName: clientBusinessProfiles.businessName,
        fullName: clientAccounts.fullName,
        clientId: clientAccounts.id,
      })
      .from(supportTickets)
      .innerJoin(clientAccounts, eq(clientAccounts.id, supportTickets.clientAccountId))
      .leftJoin(clientBusinessProfiles, eq(clientBusinessProfiles.clientAccountId, clientAccounts.id))
      .where(eq(supportTickets.id, id))
      .limit(1);

    const row = rows[0];
    if (!row) throw notFound('Ticket not found.');

    const messages = await db
      .select()
      .from(supportMessages)
      .where(eq(supportMessages.ticketId, id))
      .orderBy(asc(supportMessages.createdAt));

    return ok(reply, {
      id: row.ticket.id,
      reference: row.ticket.reference,
      clientId: row.clientId,
      businessName: row.businessName ?? row.fullName,
      subject: row.ticket.subject,
      status: row.ticket.status,
      priority: row.ticket.priority,
      createdAt: row.ticket.createdAt,
      lastReplyAt: row.ticket.lastReplyAt,
      messageCount: row.ticket.messageCount,
      messages: messages.map((message) => ({
        id: message.id,
        authorType: message.authorType,
        authorName: message.authorName,
        body: message.body,
        createdAt: message.createdAt,
      })),
    });
  });

  app.post('/support/:id/reply', { preHandler: app.requireAdmin }, async (request, reply) => {
    const { id } = parseParams(uuidParamSchema, request.params);
    const { message } = parseBody(z.object({ message: z.string().trim().min(1).max(5000) }), request.body);

    const rows = await db
      .select({
        ticket: supportTickets,
        email: clientAccounts.email,
        fullName: clientAccounts.fullName,
        clientId: clientAccounts.id,
      })
      .from(supportTickets)
      .innerJoin(clientAccounts, eq(clientAccounts.id, supportTickets.clientAccountId))
      .where(eq(supportTickets.id, id))
      .limit(1);

    const row = rows[0];
    if (!row) throw notFound('Ticket not found.');
    if (row.ticket.status === 'closed') {
      throw new AppError(ERROR_CODES.TICKET_CLOSED, 'This ticket is closed.', 409);
    }

    const now = new Date();
    await db.insert(supportMessages).values({
      ticketId: id,
      authorType: 'admin',
      authorName: 'Support Team',
      body: message,
    });

    await db
      .update(supportTickets)
      .set({
        messageCount: row.ticket.messageCount + 1,
        lastReplyAt: now,
        lastReplyBy: 'admin',
        status: row.ticket.status === 'open' ? 'in_progress' : row.ticket.status,
        updatedAt: now,
      })
      .where(eq(supportTickets.id, id));

    await emails.supportReply(
      row.email,
      row.fullName,
      row.ticket.subject,
      `${config.urls.website}/account/support/${id}`,
      row.clientId,
    );

    return ok(reply, { replied: true });
  });

  app.post('/support/:id/status', { preHandler: app.requireAdmin }, async (request, reply) => {
    const { id } = parseParams(uuidParamSchema, request.params);
    const { status } = parseBody(
      z.object({ status: z.enum(['open', 'in_progress', 'resolved', 'closed']) }),
      request.body,
    );

    const rows = await db.select().from(supportTickets).where(eq(supportTickets.id, id)).limit(1);
    const ticket = rows[0];
    if (!ticket) throw notFound('Ticket not found.');

    const now = new Date();
    await db
      .update(supportTickets)
      .set({
        status,
        resolvedAt: status === 'resolved' ? now : ticket.resolvedAt,
        closedAt: status === 'closed' ? now : ticket.closedAt,
        updatedAt: now,
      })
      .where(eq(supportTickets.id, id));

    await recordAudit(request, {
      action: AUDIT_ACTIONS.SUPPORT_STATUS_CHANGED,
      actorId: request.adminAuth!.adminId,
      actorLabel: request.adminAuth!.email,
      clientAccountId: ticket.clientAccountId,
      targetLabel: ticket.reference,
      oldValue: ticket.status,
      newValue: status,
    });

    return ok(reply, { status });
  });

  // --- Audit logs (read only) -------------------------------------------------

  app.get('/audit', { preHandler: app.requireAdmin }, async (request, reply) => {
    const query = parseQuery(paginationSchema, request.query);
    const search = query.search?.trim();

    const conditions = [];
    if (search) {
      conditions.push(
        or(
          ilike(auditLogs.action, `%${search}%`),
          ilike(auditLogs.targetLabel, `%${search}%`),
          ilike(auditLogs.actorLabel, `%${search}%`),
        ),
      );
    }
    if (query.status && query.status !== 'all') {
      conditions.push(ilike(auditLogs.action, `%${query.status}%`));
    }
    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const base = db
      .select({
        log: auditLogs,
        tenantRef: tenants.tenantRef,
        businessName: clientBusinessProfiles.businessName,
      })
      .from(auditLogs)
      .leftJoin(tenants, eq(tenants.id, auditLogs.tenantId))
      .leftJoin(clientBusinessProfiles, eq(clientBusinessProfiles.clientAccountId, auditLogs.clientAccountId));

    const rows = await (where ? base.where(where) : base)
      .orderBy(desc(auditLogs.createdAt))
      .limit(query.pageSize)
      .offset((query.page - 1) * query.pageSize);

    const totalBase = db.select({ total: count() }).from(auditLogs);
    const totals = await (where ? totalBase.where(where) : totalBase);

    return paginated(
      reply,
      rows.map((row) => ({
        id: row.log.id,
        action: row.log.action,
        actor: row.log.actorLabel ?? row.log.actorType,
        tenantId: row.tenantRef,
        businessName: row.businessName,
        oldValue: row.log.oldValue,
        newValue: row.log.newValue,
        ipAddress: row.log.ipAddress,
        userAgent: row.log.userAgent,
        requestId: row.log.requestId,
        createdAt: row.log.createdAt,
      })),
      buildMeta(query.page, query.pageSize, Number(totals[0]?.total ?? 0)),
    );
  });

  // --- Settings ---------------------------------------------------------------

  app.get('/settings', { preHandler: app.requireAdmin }, async (_request, reply) => {
    const settings = await getSettings();


    return ok(reply, {
      general: settings.general,
      trial: settings.trial,
      payments: {
        provider: config.payment.provider,
        currency: config.payment.currency,
        configured: config.payment.configured,
      },
      email: {
        senderName: settings.email.senderName,
        senderEmail: settings.email.senderEmail,
        driver: config.mail.driver,
        configured: config.mail.configured,
      },
      messaging: {
        smsProvider: settings.messaging.smsProvider,
        smsConfigured: Boolean(settings.messaging.smsProvider),
        whatsappProvider: settings.messaging.whatsappProvider,
        whatsappConfigured: Boolean(settings.messaging.whatsappProvider),
      },
      domain: {
        platformRootDomain: config.urls.platformRootDomain,
        clientAdminUrlPattern: config.urls.clientAdminPattern,
        dnsTarget: config.urls.dnsTarget,
      },
      security: {
        sessionTtlMinutes: config.security.sessionTtlMinutes,
        adminSessionTtlMinutes: config.security.adminSessionTtlMinutes,
        reauthWindowMinutes: config.security.reauthWindowMinutes,

      },
    });
  });

  app.put('/settings', { preHandler: app.requireAdmin }, async (request, reply) => {
    const body = parseBody(
      z.object({
        general: z
          .object({
            platformName: z.string().trim().min(2).max(60),
            supportEmail: z.string().trim().email(),
            supportPhone: z.string().trim().max(24).nullable().optional(),
            defaultCurrency: z.string().trim().length(3).toUpperCase(),
            timezone: z.string().trim().min(3).max(64),
          })
          .optional(),
        trial: z
          .object({
            trialDays: z.coerce.number().int().min(1).max(365),
            reminderDays: z.array(z.coerce.number().int().min(1).max(365)).max(6),
          })
          .optional(),
        email: z
          .object({
            senderName: z.string().trim().min(2).max(60),
            senderEmail: z.string().trim().email(),
          })
          .optional(),
        messaging: z
          .object({
            smsProvider: z.string().trim().max(40).nullable().optional(),
            whatsappProvider: z.string().trim().max(40).nullable().optional(),
          })
          .optional(),
      }),
      request.body,
    );

    const before = await getSettings();
    // Only these four groups are writable; infrastructure config stays in ENV.
    const updated = await updateSettings({
      ...(body.general ? { general: { ...before.general, ...body.general, supportPhone: body.general.supportPhone ?? null } } : {}),
      ...(body.trial ? { trial: body.trial } : {}),
      ...(body.email ? { email: body.email } : {}),
      ...(body.messaging
        ? {
            messaging: {
              smsProvider: body.messaging.smsProvider ?? null,
              whatsappProvider: body.messaging.whatsappProvider ?? null,
            },
          }
        : {}),
    });

    await recordAudit(request, {
      action: AUDIT_ACTIONS.SETTINGS_CHANGED,
      actorId: request.adminAuth!.adminId,
      actorLabel: request.adminAuth!.email,
      oldValue: JSON.stringify(before).slice(0, 500),
      newValue: JSON.stringify(updated).slice(0, 500),
    });

    return ok(reply, { saved: true });
  });
}
