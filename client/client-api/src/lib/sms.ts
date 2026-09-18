import { config, isProduction } from '../config/index';
import { logger } from './logger';

/**
 * Text messages.
 *
 * The shape is `lib/mailer.ts`'s on purpose, down to never throwing: a shopper
 * must not be told their sign-in failed because a gateway was down, and a code
 * that did not arrive is always recoverable by asking for another.
 *
 * **There is one driver and it is `log`.** That is not an oversight — with
 * `SMS_DRIVER=log` the message is written to the API log, which is how a code is
 * read during local development, exactly as `MAIL_DRIVER=log` is how a password
 * reset link is. Adding a real gateway is a branch in `sendSms` and two env
 * vars; it is deliberately not guessed at here, because every Bangladeshi SMS
 * provider has a different idea of what an API looks like and a wrong guess is
 * worse than an obvious gap.
 *
 * In production the body is **not** logged. A one-time code in a log file is a
 * one-time code anybody with log access can use, and the whole point of sending
 * it to the handset is that it goes nowhere else.
 */
export interface SmsMessage {
  /** E.164, always — see `lib/phone.ts`. */
  to: string;
  body: string;
}

export async function sendSms(message: SmsMessage): Promise<boolean> {
  if (config.sms.driver === 'log') {
    logger.info(
      { to: message.to, body: isProduction ? undefined : message.body },
      'sms (log driver)',
    );
    return true;
  }

  /*
   * Unreachable while `log` is the only value the config allows, and left here
   * as the shape the next driver slots into rather than as dead code: a gateway
   * is one `if` above this line and a failure is reported, never thrown.
   */
  logger.error({ to: message.to, driver: config.sms.driver }, 'no sms driver is configured');
  return false;
}
