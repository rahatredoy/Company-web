import type { FastifyReply, FastifyRequest } from 'fastify';
import { z, type ZodType } from 'zod';
import { AppError, ERROR_CODES } from './errors';

export interface PageMeta {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

/**
 * What a keyset-paginated list reports about itself.
 *
 * `total` is **only** present on the first batch. The panel scrolls rather than
 * pages, so a count re-run per batch would pay for a figure that has already
 * been shown and cannot have moved much — and the count is the expensive half of
 * a list read, since it cannot stop at `pageSize` rows the way the batch does.
 */
export interface ListMeta {
  pageSize: number;
  /** Opaque marker for the row after the last one sent; null when the list ends here. */
  nextCursor: string | null;
  hasMore: boolean;
  total?: number;
}

export function ok<T>(reply: FastifyReply, data: T, statusCode = 200) {
  return reply.status(statusCode).send({ data });
}

export function paginated<T>(reply: FastifyReply, data: T[], meta: PageMeta) {
  return reply.send({ data, meta });
}

/** The keyset counterpart of `paginated`. Same envelope, different meta. */
export function listed<T>(reply: FastifyReply, data: T[], meta: ListMeta) {
  return reply.send({ data, meta });
}

export function noContent(reply: FastifyReply) {
  return reply.status(204).send();
}

export function buildMeta(page: number, pageSize: number, total: number): PageMeta {
  return { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
}

/** Turns Zod issues into the `details` map the frontends render per field. */
function toDetails(error: z.ZodError): Record<string, string[]> {
  const details: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const key = issue.path.length > 0 ? issue.path.join('.') : '_';
    (details[key] ??= []).push(issue.message);
  }
  return details;
}

export function parseOrThrow<T extends ZodType>(schema: T, value: unknown): z.infer<T> {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new AppError(ERROR_CODES.VALIDATION_FAILED, 'Some fields need your attention.', 422, {
      details: toDetails(result.error),
    });
  }
  return result.data;
}

export const parseBody = parseOrThrow;
export const parseQuery = parseOrThrow;
export const parseParams = parseOrThrow;

/**
 * The cursor every admin list accepts.
 *
 * Kept separate so a list schema can spread it in beside its own filters, and
 * generous in length because the marker carries one value per sort column.
 */
export const cursorField = {
  cursor: z.string().trim().max(512).optional(),
} as const;

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().trim().max(120).optional(),
  status: z.string().trim().max(40).optional(),
  sort: z.string().trim().max(40).optional(),
  order: z.enum(['asc', 'desc']).default('desc'),
  ...cursorField,
});

export type PaginationQuery = z.infer<typeof paginationSchema>;

export const uuidParamSchema = z.object({ id: z.string().uuid('Invalid identifier.') });

export function clientIp(request: FastifyRequest): string {
  const forwarded = request.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length > 0) {
    return forwarded.split(',')[0]!.trim().slice(0, 64);
  }
  return (request.ip ?? '').slice(0, 64);
}

export function userAgent(request: FastifyRequest): string {
  const value = request.headers['user-agent'];
  return typeof value === 'string' ? value.slice(0, 512) : '';
}
