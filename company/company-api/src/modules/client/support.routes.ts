import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { and, asc, count, desc, eq } from 'drizzle-orm';
import { db } from '../../db/client';
import { supportMessages, supportTickets, tenants } from '../../db/schema/index';
import { AppError, ERROR_CODES, notFound } from '../../lib/errors';
import { buildMeta, ok, paginated, parseBody, parseParams, parseQuery, paginationSchema, uuidParamSchema } from '../../lib/http';
import { enforce } from '../../lib/rate-limit';
import { RATE_LIMITS } from '../../lib/constants';
import { publicId } from '../../lib/crypto';
import { recordActivity } from '../../lib/audit';

const createSchema = z.object({
  subject: z.string().trim().min(4, 'Enter a subject.').max(160),
  priority: z.enum(['low', 'normal', 'high', 'urgent']).default('normal'),
  message: z.string().trim().min(10, 'Describe the issue in a little more detail.').max(5000),
});

const replySchema = z.object({
  message: z.string().trim().min(1, 'Write a reply.').max(5000),
});

function ticketView(ticket: typeof supportTickets.$inferSelect) {
  return {
    id: ticket.id,
    reference: ticket.reference,
    subject: ticket.subject,
    status: ticket.status,
    priority: ticket.priority,
    createdAt: ticket.createdAt,
    lastReplyAt: ticket.lastReplyAt,
    messageCount: ticket.messageCount,
  };
}

export default async function clientSupportRoutes(app: FastifyInstance) {
  app.get('/support', { preHandler: app.requireClient }, async (request, reply) => {
    const query = parseQuery(paginationSchema, request.query);
    const accountId = request.clientAuth!.accountId;

    const [rows, totals] = await Promise.all([
      db
        .select()
        .from(supportTickets)
        .where(eq(supportTickets.clientAccountId, accountId))
        .orderBy(desc(supportTickets.createdAt))
        .limit(query.pageSize)
        .offset((query.page - 1) * query.pageSize),
      db.select({ total: count() }).from(supportTickets).where(eq(supportTickets.clientAccountId, accountId)),
    ]);

    return paginated(reply, rows.map(ticketView), buildMeta(query.page, query.pageSize, Number(totals[0]?.total ?? 0)));
  });

  app.post('/support', { preHandler: app.requireClient }, async (request, reply) => {
    await enforce(request, 'support-create', RATE_LIMITS.supportCreate, request.clientAuth!.accountId);
    const body = parseBody(createSchema, request.body);
    const accountId = request.clientAuth!.accountId;

    const tenantRows = await db
      .select({ id: tenants.id })
      .from(tenants)
      .where(eq(tenants.clientAccountId, accountId))
      .limit(1);

    const now = new Date();
    const [ticket] = await db
      .insert(supportTickets)
      .values({
        reference: publicId('TKT'),
        clientAccountId: accountId,
        tenantId: tenantRows[0]?.id ?? null,
        subject: body.subject,
        priority: body.priority,
        messageCount: 1,
        lastReplyAt: now,
        lastReplyBy: 'client',
      })
      .returning();

    await db.insert(supportMessages).values({
      ticketId: ticket!.id,
      authorType: 'client',
      authorName: request.clientAuth!.fullName,
      body: body.message,
    });

    await recordActivity({
      type: 'support_ticket_opened',
      title: 'Support ticket opened',
      subject: body.subject,
      clientAccountId: accountId,
      tenantId: tenantRows[0]?.id ?? null,
      metadata: { reference: ticket!.reference, priority: body.priority },
    });

    return ok(reply, ticketView(ticket!), 201);
  });

  app.get('/support/:id', { preHandler: app.requireClient }, async (request, reply) => {
    const { id } = parseParams(uuidParamSchema, request.params);

    // Always scope by account — a ticket id must never be enough to read it.
    const rows = await db
      .select()
      .from(supportTickets)
      .where(and(eq(supportTickets.id, id), eq(supportTickets.clientAccountId, request.clientAuth!.accountId)))
      .limit(1);

    const ticket = rows[0];
    if (!ticket) throw notFound('Ticket not found.');

    const messages = await db
      .select()
      .from(supportMessages)
      .where(eq(supportMessages.ticketId, ticket.id))
      .orderBy(asc(supportMessages.createdAt));

    return ok(reply, {
      ...ticketView(ticket),
      messages: messages.map((message) => ({
        id: message.id,
        authorType: message.authorType,
        authorName: message.authorName,
        body: message.body,
        createdAt: message.createdAt,
      })),
    });
  });

  app.post('/support/:id/reply', { preHandler: app.requireClient }, async (request, reply) => {
    const { id } = parseParams(uuidParamSchema, request.params);
    const body = parseBody(replySchema, request.body);

    const rows = await db
      .select()
      .from(supportTickets)
      .where(and(eq(supportTickets.id, id), eq(supportTickets.clientAccountId, request.clientAuth!.accountId)))
      .limit(1);

    const ticket = rows[0];
    if (!ticket) throw notFound('Ticket not found.');
    if (ticket.status === 'closed') {
      throw new AppError(ERROR_CODES.TICKET_CLOSED, 'This ticket is closed. Open a new one instead.', 409);
    }

    const now = new Date();
    await db.insert(supportMessages).values({
      ticketId: ticket.id,
      authorType: 'client',
      authorName: request.clientAuth!.fullName,
      body: body.message,
    });

    await db
      .update(supportTickets)
      .set({
        messageCount: ticket.messageCount + 1,
        lastReplyAt: now,
        lastReplyBy: 'client',
        // A client reply reopens a resolved ticket.
        status: ticket.status === 'resolved' ? 'open' : ticket.status,
        updatedAt: now,
      })
      .where(eq(supportTickets.id, ticket.id));

    return ok(reply, { replied: true });
  });
}
