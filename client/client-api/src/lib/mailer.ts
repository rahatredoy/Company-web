import { Resend } from 'resend';
import { config, isProduction } from '../config/index';
import { translate } from './i18n/index';
import type { Language } from './languages';
import { logger } from './logger';

export interface MailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
  /** Overrides the platform default so mail reads as coming from the store. */
  fromName?: string;
  replyTo?: string;
}

let resendClient: Resend | null = null;

function getResend(): Resend | null {
  if (config.mail.driver !== 'resend' || !config.mail.resendApiKey) return null;
  resendClient ??= new Resend(config.mail.resendApiKey);
  return resendClient;
}

/**
 * Where the message is actually delivered, which is not always who it is
 * addressed to: see `MAIL_DEV_REDIRECT_TO`.
 */
function deliveryAddress(intended: string): string {
  const override = config.mail.devRedirectTo;
  if (!override || override === intended) return intended;
  logger.warn({ intended, override }, 'mail diverted by MAIL_DEV_REDIRECT_TO');
  return override;
}

/**
 * Sending is best-effort and never throws: a store owner must still get a
 * success response when the mail provider is down, and a reset token is always
 * recoverable by requesting a new one.
 *
 * With `MAIL_DRIVER=log` the whole message is written to the log — that is how
 * reset links are read during local development.
 */
export async function sendMail(message: MailMessage): Promise<boolean> {
  const from = `"${message.fromName ?? config.mail.fromName}" <${config.mail.fromEmail}>`;
  const to = deliveryAddress(message.to);

  const resend = getResend();
  if (!resend) {
    logger.info(
      { to, subject: message.subject, body: isProduction ? undefined : message.text },
      'mail (log driver)',
    );
    return true;
  }

  // The SDK reports API errors in its return value rather than by throwing, so a
  // rejected send must be unwrapped or it would look like a success.
  const { data, error } = await resend.emails.send({
    from,
    to,
    subject: message.subject,
    html: message.html,
    text: message.text,
    ...(message.replyTo ? { replyTo: message.replyTo } : {}),
  });

  if (error) {
    logger.error({ err: `${error.name}: ${error.message}`, to }, 'mail delivery failed (resend)');
    return false;
  }
  logger.info({ to, subject: message.subject, providerId: data?.id }, 'mail sent (resend)');
  return true;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * A sentence of a mail in the store's language, with its `{name}` placeholders
 * filled in **after** translating — a mail sentence carries a store name, a
 * first name or a number, so it cannot be an exact key with the value inside.
 *
 * Values are inserted as given: escaping for HTML stays the caller's job, as it
 * was before mail had a language. A number is written in the language's digits;
 * in English it is exactly `String(value)`, so English mail is unchanged.
 */
export function mailText(
  language: Language,
  text: string,
  values: Record<string, string | number> = {},
): string {
  return translate(language, text).replace(/\{(\w+)\}/g, (whole, name: string) => {
    const value = values[name];
    if (value === undefined) return whole;
    if (typeof value === 'number' && language !== 'en') {
      return new Intl.NumberFormat(language === 'bn' ? 'bn-BD' : language, { useGrouping: false }).format(value);
    }
    return String(value);
  });
}

/** Plain, table-free layout — it renders the same in every mail client. */
export function layout(storeName: string, heading: string, bodyHtml: string, language: Language = 'en'): string {
  return `<!doctype html>
<html><body style="margin:0;padding:24px;background:#f4f5f7;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1f2937;">
  <div style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #e5e7eb;border-radius:12px;padding:32px;">
    <p style="margin:0 0 24px;font-size:13px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;color:#6b7280;">${escapeHtml(storeName)}</p>
    <h1 style="margin:0 0 16px;font-size:20px;line-height:1.35;color:#111827;">${escapeHtml(heading)}</h1>
    ${bodyHtml}
  </div>
  <p style="max-width:560px;margin:16px auto 0;font-size:12px;color:#9ca3af;text-align:center;">
    ${mailText(language, 'Sent by {storeName} via {platform}.', {
      storeName: escapeHtml(storeName),
      platform: escapeHtml(config.mail.fromName),
    })}
  </p>
</body></html>`;
}

export function button(label: string, url: string, language: Language = 'en'): string {
  return `<p style="margin:0 0 24px;">
    <a href="${url}" style="display:inline-block;background:#7c3aed;color:#ffffff;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:600;font-size:14px;">${escapeHtml(label)}</a>
  </p>
  <p style="margin:0 0 8px;font-size:13px;color:#6b7280;">${mailText(language, 'If the button does not work, paste this link into your browser:')}</p>
  <p style="margin:0 0 24px;font-size:13px;word-break:break-all;"><a href="${url}" style="color:#7c3aed;">${escapeHtml(url)}</a></p>`;
}

export function paragraph(text: string): string {
  return `<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#374151;">${escapeHtml(text)}</p>`;
}
