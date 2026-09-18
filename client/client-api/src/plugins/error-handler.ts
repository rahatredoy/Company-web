import fp from 'fastify-plugin';
import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { ZodError } from 'zod';
import { AppError, ERROR_CODES, type ErrorResponseBody } from '../lib/errors';
import { isProduction } from '../config/index';
import { languageOf, translate, translateDetails } from '../lib/i18n/index';

interface PgError extends Error {
  code?: string;
  constraint?: string;
  detail?: string;
}

/** Maps a Postgres error to a safe, caller-facing message. */
function fromDatabaseError(error: PgError): AppError | null {
  switch (error.code) {
    case '23505': // unique_violation
      return new AppError(ERROR_CODES.CONFLICT, 'That value is already in use.', 409);
    case '23503': // foreign_key_violation
      return new AppError(ERROR_CODES.BAD_REQUEST, 'A referenced record does not exist.', 400);
    case '23514': // check_violation
      return new AppError(ERROR_CODES.BAD_REQUEST, 'That value is not allowed.', 400);
    case '22P02': // invalid_text_representation
      return new AppError(ERROR_CODES.BAD_REQUEST, 'Malformed identifier.', 400);
    default:
      return null;
  }
}

function zodDetails(error: ZodError): Record<string, string[]> {
  const details: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const key = issue.path.length > 0 ? issue.path.join('.') : '_';
    (details[key] ??= []).push(issue.message);
  }
  return details;
}

/**
 * Single exit point for every error. Stack traces, SQL text, driver messages and
 * configuration values never leave this function.
 *
 * It is also where a message becomes the store's language. Every `message` and
 * every per-field `details` entry is passed through `lib/i18n` on the way out,
 * so a route throws its English sentence exactly as before and a Bangla store's
 * owner and shoppers read it in Bangla. The `code` is never translated: it is
 * what the frontends branch on.
 */
export default fp(async function errorHandler(app: FastifyInstance) {
  app.setNotFoundHandler((request: FastifyRequest, reply: FastifyReply) => {
    const body: ErrorResponseBody = {
      code: ERROR_CODES.NOT_FOUND,
      message: 'The requested endpoint does not exist.',
      requestId: String(request.id),
    };
    return reply.status(404).send(body);
  });

  app.setErrorHandler(async (error: FastifyError, request: FastifyRequest, reply: FastifyReply) => {
    const requestId = String(request.id);
    // Logged in English above each branch; only what is sent is translated.
    const language = await languageOf(request);
    const say = (message: string) => translate(language, message);

    if (error instanceof AppError) {
      request.log.info({ code: error.code, statusCode: error.statusCode }, 'handled error');
      const body: ErrorResponseBody = { code: error.code, message: say(error.message), requestId };
      if (error.details) body.details = translateDetails(language, error.details);
      return reply.status(error.statusCode).send(body);
    }

    if (error instanceof ZodError) {
      return reply.status(422).send({
        code: ERROR_CODES.VALIDATION_FAILED,
        message: say('Some fields need your attention.'),
        requestId,
        details: translateDetails(language, zodDetails(error)),
      } satisfies ErrorResponseBody);
    }

    const mapped = fromDatabaseError(error as PgError);
    if (mapped) {
      request.log.warn({ pgCode: (error as PgError).code }, 'database constraint violation');
      return reply.status(mapped.statusCode).send({
        code: mapped.code,
        message: say(mapped.message),
        requestId,
      } satisfies ErrorResponseBody);
    }

    // Fastify's own client errors (bad JSON, payload too large, …).
    if (typeof error.statusCode === 'number' && error.statusCode >= 400 && error.statusCode < 500) {
      return reply.status(error.statusCode).send({
        code: error.code ?? ERROR_CODES.BAD_REQUEST,
        message: say(error.statusCode === 429 ? 'Too many requests. Please try again later.' : 'Invalid request.'),
        requestId,
      } satisfies ErrorResponseBody);
    }

    request.log.error(
      { err: error.message, stack: isProduction ? undefined : error.stack },
      'unhandled error',
    );

    return reply.status(500).send({
      code: ERROR_CODES.INTERNAL_ERROR,
      message: say('Something went wrong. Please try again.'),
      requestId,
    } satisfies ErrorResponseBody);
  });
});
