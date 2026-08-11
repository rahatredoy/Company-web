import { Resend } from 'resend';
import { db } from '../db/client';
import { notifications } from '../db/schema/index';
import { config } from '../config/index';
import { logger } from './logger';
import { getGeneralSettings } from './settings';

export interface MailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
  template: string;
  clientAccountId?: string | null;
  tenantId?: string | null;
}

let resendClient: Resend | null = null;

function getResend(): Resend | null {
  if (config.mail.driver !== 'resend' || !config.mail.resendApiKey) return null;
  resendClient ??= new Resend(config.mail.resendApiKey);
  return resendClient;
}

/**
 * Where the message is actually delivered, which is not always who it is
 * addressed to: see `MAIL_DEV_REDIRECT_TO`. The `notifications` row always keeps
 * the intended recipient, so the audit trail stays honest.
 */
function deliveryAddress(intended: string): string {
  const override = config.mail.devRedirectTo;
  if (!override || override === intended) return intended;
  logger.warn({ intended, override }, 'mail diverted by MAIL_DEV_REDIRECT_TO');
  return override;
}

/**
 * Sends through Resend, throwing on failure.
 *
 * The SDK reports API errors in its return value rather than by throwing, so
 * that is unwrapped here — otherwise a rejected send would be recorded as
 * delivered.
 */
async function deliver(from: string, to: string, message: MailMessage): Promise<void> {
  const resend = getResend();
  if (!resend) {
    // `log` driver: useful in development, and makes it obvious that nothing was actually sent.
    logger.info({ to, subject: message.subject, template: message.template }, 'email (log driver)');
    logger.debug({ body: message.text }, 'email body');
    return;
  }

  const { data, error } = await resend.emails.send({
    from,
    to,
    subject: message.subject,
    html: message.html,
    text: message.text,
  });
  if (error) throw new Error(`resend ${error.name}: ${error.message}`);
  logger.info({ to, subject: message.subject, providerId: data?.id }, 'email sent (resend)');
}

/**
 * Startup probe for the mail provider.
 *
 * A rejected API key is otherwise invisible until a customer sits waiting for a
 * passcode that was never delivered: every send is best-effort, so the failure
 * lands in a `notifications` row nobody is watching. This turns that into one
 * loud line at boot.
 */
export async function checkMailCredentials(): Promise<void> {
  const resend = getResend();
  if (!resend) return;

  const { error } = await resend.domains.list().catch((err: unknown) => ({ error: err as Error }));
  if (error) {
    logger.error(
      { err: 'message' in error ? error.message : String(error), from: config.mail.fromEmail },
      'RESEND_API_KEY was rejected — no email will be delivered until it is replaced',
    );
    return;
  }

  if (config.mail.devRedirectTo) {
    logger.warn(
      { redirectTo: config.mail.devRedirectTo },
      'MAIL_DEV_REDIRECT_TO is set — every email, including passcodes, goes to this address instead of the recipient',
    );
  }
}

/**
 * Sends the message and records it in `notifications`. Delivery failures never
 * break the calling request — the row keeps the failure for the admin to see.
 */
export async function sendMail(message: MailMessage): Promise<void> {
  const from = `${config.mail.fromName} <${config.mail.fromEmail}>`;

  const [row] = await db
    .insert(notifications)
    .values({
      clientAccountId: message.clientAccountId ?? null,
      tenantId: message.tenantId ?? null,
      channel: 'email',
      template: message.template,
      recipient: message.to,
      subject: message.subject,
      status: 'queued',
    })
    .returning({ id: notifications.id })
    .catch(() => [undefined]);

  try {
    await deliver(from, deliveryAddress(message.to), message);

    if (row?.id) {
      const { eq } = await import('drizzle-orm');
      await db
        .update(notifications)
        .set({ status: 'sent', sentAt: new Date() })
        .where(eq(notifications.id, row.id));
    }
  } catch (error) {
    logger.error({ err: (error as Error).message, to: message.to }, 'failed to send email');
    if (row?.id) {
      const { eq } = await import('drizzle-orm');
      await db
        .update(notifications)
        .set({ status: 'failed', error: (error as Error).message })
        .where(eq(notifications.id, row.id))
        .catch(() => undefined);
    }
  }
}

function layout(platformName: string, heading: string, body: string, cta?: { label: string; url: string }): string {
  return `<!doctype html>
<html><body style="margin:0;background:#f5f7fb;font-family:ui-sans-serif,system-ui,'Segoe UI',sans-serif;color:#0b1220">
  <div style="max-width:560px;margin:0 auto;padding:32px 20px">
    <p style="font-size:15px;font-weight:600;margin:0 0 24px">${platformName}</p>
    <div style="background:#fff;border:1px solid #e6e9f0;border-radius:12px;padding:28px">
      <h1 style="font-size:20px;margin:0 0 12px">${heading}</h1>
      <div style="font-size:14px;line-height:22px;color:#475569">${body}</div>
      ${
        cta
          ? `<p style="margin:24px 0 0"><a href="${cta.url}" style="display:inline-block;background:#6d4aff;color:#fff;text-decoration:none;padding:11px 20px;border-radius:8px;font-size:14px;font-weight:600">${cta.label}</a></p>
             <p style="margin:16px 0 0;font-size:12px;color:#94a3b8;word-break:break-all">Or paste this link into your browser:<br>${cta.url}</p>`
          : ''
      }
    </div>
    <p style="font-size:12px;color:#94a3b8;margin:20px 0 0">You are receiving this because you have an account with ${platformName}.</p>
  </div>
</body></html>`;
}

/** `123456` → `123 456`, which is markedly easier to read back from a screen. */
function spacedCode(code: string): string {
  return `${code.slice(0, 3)} ${code.slice(3)}`;
}

/** The digits, big enough to read at a glance and impossible to mistake for prose. */
function codeBlock(code: string): string {
  return `<p style="font-size:32px;font-weight:700;letter-spacing:.18em;margin:24px 0;">${spacedCode(code)}</p>`;
}

export const emails = {
  /**
   * The sign-in passcode.
   *
   * Deliberately carries no link and no button: a passcode email that contains
   * a one-click sign-in link is a phishing template waiting to be copied. The
   * recipient types the digits into a page they already have open.
   */
  async signInCode(to: string, code: string, minutes: number, ip: string) {
    const { platformName } = await getGeneralSettings();

    await sendMail({
      to,
      template: 'admin_sign_in_code',
      subject: `${code} is your ${platformName} sign-in code`,
      text: `Your ${platformName} admin sign-in code is ${code}.

It expires in ${minutes} minutes and can be used once.
Requested from ${ip || 'an unknown address'}.

If this was not you, change your password immediately.`,
      html: layout(
        platformName,
        'Your sign-in code',
        `${codeBlock(code)}
         <p>This code expires in ${minutes} minutes and can be used once.</p>
         <p style="color:#6b7280;font-size:13px;">Requested from ${ip || 'an unknown address'}. If this was not you, change your password immediately.</p>`,
      ),
    });
  },

  /** Second step of a customer sign-in — same reasoning as `signInCode`, no link. */
  async clientSignInCode(
    to: string,
    name: string,
    code: string,
    minutes: number,
    ip: string,
    clientAccountId: string,
  ) {
    const { platformName } = await getGeneralSettings();

    await sendMail({
      to,
      clientAccountId,
      template: 'client_sign_in_code',
      subject: `${code} is your ${platformName} sign-in code`,
      text: `Hi ${name},

Your ${platformName} sign-in code is ${code}.

It expires in ${minutes} minutes and can be used once.
Requested from ${ip || 'an unknown address'}.

If this was not you, change your password immediately.`,
      html: layout(
        platformName,
        'Your sign-in code',
        `<p>Hi ${name},</p>
         ${codeBlock(code)}
         <p>Enter this code on the sign-in page to finish signing in. It expires in ${minutes} minutes and can be used once.</p>
         <p style="color:#6b7280;font-size:13px;">Requested from ${ip || 'an unknown address'}. If this was not you, change your password immediately.</p>`,
      ),
    });
  },

  /** Activates a new account. A code, not a link, so it works across devices. */
  async verificationCode(to: string, name: string, code: string, minutes: number, clientAccountId: string) {
    const { platformName } = await getGeneralSettings();
    await sendMail({
      to,
      clientAccountId,
      template: 'email_verification',
      subject: `${code} is your ${platformName} verification code`,
      text: `Hi ${name},

Your ${platformName} verification code is ${code}.

Enter it on the verification page to activate your account. It expires in ${minutes} minutes.

If you did not create an account, you can ignore this email.`,
      html: layout(
        platformName,
        'Verify your email address',
        `<p>Hi ${name},</p>
         ${codeBlock(code)}
         <p>Enter this code on the verification page to activate your account and set up your store. It expires in ${minutes} minutes.</p>
         <p style="color:#6b7280;font-size:13px;">If you did not create an account, you can safely ignore this email.</p>`,
      ),
    });
  },

  /**
   * Confirms the address someone chose as their store admin login, before the
   * store is built around it. Sent to that address rather than to the SaaS
   * account: the whole point is to prove the new mailbox can be read, and a
   * typo caught here is a typo that never becomes a panel nobody can open.
   */
  async storeAdminSetupCode(
    to: string,
    code: string,
    minutes: number,
    ids: { clientAccountId: string; tenantId: string },
  ) {
    const { platformName } = await getGeneralSettings();
    await sendMail({
      to,
      ...ids,
      template: 'store_admin_setup_code',
      subject: `${code} is your store admin verification code`,
      text: `Your ${platformName} store admin verification code is ${code}.

Enter it to finish setting up your store. It expires in ${minutes} minutes.

If you were not setting up a store, you can ignore this email — nothing has been created.`,
      html: layout(
        platformName,
        'Confirm your store admin login',
        `<p>This address was chosen as the login for a new store admin panel.</p>
         ${codeBlock(code)}
         <p>Enter this code to finish setting up the store. It expires in ${minutes} minutes.</p>
         <p style="color:#6b7280;font-size:13px;">If you were not setting up a store, you can ignore this email — nothing has been created.</p>`,
      ),
    });
  },

  /** Resets the store admin panel password. A code, never a link — see `signInCode`. */
  async storeAdminResetCode(
    to: string,
    code: string,
    minutes: number,
    ids: { clientAccountId: string; tenantId: string },
  ) {
    const { platformName } = await getGeneralSettings();
    await sendMail({
      to,
      ...ids,
      template: 'store_admin_reset_code',
      subject: `${code} is your store admin password reset code`,
      text: `Your ${platformName} store admin password reset code is ${code}.

It expires in ${minutes} minutes. Once the password is changed, every open admin panel session is signed out.

If you did not ask for this, your password has not changed — you can ignore this email.`,
      html: layout(
        platformName,
        'Reset your store admin password',
        `${codeBlock(code)}
         <p>Enter this code in your dashboard to choose a new store admin password. It expires in ${minutes} minutes.</p>
         <p>Changing it signs out every open admin panel session.</p>
         <p style="color:#6b7280;font-size:13px;">If you did not ask for this, your password has not changed and you can ignore this email.</p>`,
      ),
    });
  },

  async passwordReset(to: string, name: string, url: string, clientAccountId: string) {
    const { platformName } = await getGeneralSettings();
    await sendMail({
      to,
      clientAccountId,
      template: 'password_reset',
      subject: `Reset your password — ${platformName}`,
      text: `Hi ${name},\n\nReset your ${platformName} password:\n${url}\n\nThis link expires in 1 hour. If you did not request it, you can ignore this email.`,
      html: layout(
        platformName,
        'Reset your password',
        `<p>Hi ${name},</p><p>Use the button below to choose a new password. This link expires in one hour. If you did not request a reset, you can safely ignore this email.</p>`,
        { label: 'Reset password', url },
      ),
    });
  },

  async storeReady(
    to: string,
    name: string,
    storeUrl: string,
    adminUrl: string,
    adminEmail: string,
    ids: { clientAccountId: string; tenantId: string },
  ) {
    const { platformName } = await getGeneralSettings();
    // The password is never repeated back — only the address it goes with.
    await sendMail({
      to,
      ...ids,
      template: 'store_ready',
      subject: `Your store is ready — ${platformName}`,
      text: `Hi ${name},\n\nYour store is live: ${storeUrl}\nYour admin panel: ${adminUrl}\n\nSign in to the admin panel as ${adminEmail}, using the password you set during signup. Everything else — products, theme, currency, delivery — is set up inside that panel.`,
      html: layout(
        platformName,
        'Your store is ready',
        `<p>Hi ${name},</p><p>Your storefront, admin panel and dedicated database have been created.</p>
         <p><strong>Storefront:</strong> <a href="${storeUrl}">${storeUrl}</a><br>
         <strong>Admin panel:</strong> <a href="${adminUrl}">${adminUrl}</a><br>
         <strong>Admin sign-in:</strong> ${adminEmail}</p>
         <p>Use the password you set during signup. Everything else — products, theme, currency, delivery — is set up inside that panel.</p>`,
        { label: 'Open my admin panel', url: adminUrl },
      ),
    });
  },

  async trialReminder(to: string, name: string, days: number, url: string, ids: { clientAccountId: string; tenantId: string }) {
    const { platformName } = await getGeneralSettings();
    await sendMail({
      to,
      ...ids,
      template: `trial_reminder_${days}`,
      subject: `${days} days left in your trial — ${platformName}`,
      text: `Hi ${name},\n\nYour trial ends in ${days} days. Choose a plan to keep your store online:\n${url}`,
      html: layout(
        platformName,
        `${days} days left in your trial`,
        `<p>Hi ${name},</p><p>Your free trial ends in ${days} days. Choose a plan now so your storefront and admin panel stay online — nothing is deleted either way.</p>`,
        { label: 'Choose a plan', url },
      ),
    });
  },

  async trialExpired(to: string, name: string, url: string, ids: { clientAccountId: string; tenantId: string }) {
    const { platformName } = await getGeneralSettings();
    await sendMail({
      to,
      ...ids,
      template: 'trial_expired',
      subject: `Your trial has ended — ${platformName}`,
      text: `Hi ${name},\n\nYour trial has ended and your store is paused. Subscribe to bring it back online:\n${url}`,
      html: layout(
        platformName,
        'Your trial has ended',
        `<p>Hi ${name},</p><p>Your store is paused — your data is safe and nothing has been deleted. Subscribe to bring your storefront and admin panel back online.</p>`,
        { label: 'Subscribe now', url },
      ),
    });
  },

  async paymentReceived(to: string, name: string, amount: string, invoiceNumber: string, ids: { clientAccountId: string; tenantId: string }) {
    const { platformName } = await getGeneralSettings();
    await sendMail({
      to,
      ...ids,
      template: 'payment_received',
      subject: `Payment received — invoice ${invoiceNumber}`,
      text: `Hi ${name},\n\nWe received your payment of ${amount}. Invoice ${invoiceNumber} is available in your account.`,
      html: layout(
        platformName,
        'Payment received',
        `<p>Hi ${name},</p><p>We received your payment of <strong>${amount}</strong>. Invoice ${invoiceNumber} is available in your account area.</p>`,
      ),
    });
  },

  async supportReply(to: string, name: string, subject: string, url: string, clientAccountId: string) {
    const { platformName } = await getGeneralSettings();
    await sendMail({
      to,
      clientAccountId,
      template: 'support_reply',
      subject: `Re: ${subject}`,
      text: `Hi ${name},\n\nOur support team replied to your ticket. Read it here:\n${url}`,
      html: layout(
        platformName,
        'New reply to your ticket',
        `<p>Hi ${name},</p><p>Our support team has replied to <strong>${subject}</strong>.</p>`,
        { label: 'View ticket', url },
      ),
    });
  },
};
