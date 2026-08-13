import multipart from '@fastify/multipart';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { RATE_LIMITS, UPLOAD_LIMITS } from '../../lib/constants';
import type { Permission } from '../../lib/constants';
import { AppError, ERROR_CODES, badRequest } from '../../lib/errors';
import { ok, parseQuery } from '../../lib/http';
import { enforce } from '../../lib/rate-limit';
import { deleteObject, putObject, storageConfigured } from '../../lib/storage';
import { storeOf } from '../../plugins/tenant';

/**
 * What a file is for, and who may upload one.
 *
 * A single "can upload" permission does not exist and inventing one would put
 * this API out of step with the permission catalogue every store already has
 * seeded. Instead the purpose names the section the file belongs to and borrows
 * that section's own permission — so an admin who may not touch marketing
 * cannot quietly use the uploader to put an image on the homepage.
 */
const PURPOSES: Record<string, { folder: string; permission: Permission; video: boolean }> = {
  products: { folder: 'products', permission: 'products.update', video: true },
  categories: { folder: 'categories', permission: 'categories.manage', video: false },
  brands: { folder: 'brands', permission: 'brands.manage', video: false },
  banners: { folder: 'banners', permission: 'marketing.manage', video: false },
  website: { folder: 'website', permission: 'website.manage', video: false },
};

const querySchema = z.object({
  purpose: z.enum(Object.keys(PURPOSES) as [string, ...string[]]).default('products'),
});

const deleteSchema = z.object({
  key: z.string().trim().min(1).max(400),
});

/**
 * Uploading a file.
 *
 * Proxied through the API rather than handed to the browser as a signed URL. A
 * presigned `PUT` is faster and is the usual advice, but it moves the size and
 * type checks to the client — and the client is the one party that cannot be
 * trusted to apply them. Ten megabytes through this process is cheap; a bucket
 * full of whatever anyone felt like sending is not.
 *
 * The type is taken from the **declared** mimetype and checked against an
 * allow-list. That is not a guarantee about the bytes, which is why the storage
 * layer never returns an executable content type and files are served from a
 * separate domain — a mislabelled file cannot become script on the store's own
 * origin.
 */
export default async function uploadRoutes(app: FastifyInstance) {
  await app.register(multipart, {
    limits: {
      fileSize: UPLOAD_LIMITS.maxBytes,
      files: 1,
      // No text fields are read; everything else travels in the query string.
      fields: 0,
    },
  });

  app.post('/uploads', { preHandler: [app.requireStoreAdmin] }, async (request, reply) => {
    const store = storeOf(request);
    const { purpose } = parseQuery(querySchema, request.query);
    const rule = PURPOSES[purpose]!;

    // The permission is checked here rather than in a `preHandler`, because
    // which one applies is not known until the query string has been read.
    await app.requirePermission(rule.permission)(request, reply);

    if (!storageConfigured()) {
      throw new AppError(
        ERROR_CODES.STORAGE_NOT_CONFIGURED,
        'File storage is not set up for this platform yet.',
        503,
      );
    }

    await enforce(request, 'upload', RATE_LIMITS.upload);

    const file = await request.file();
    if (!file) throw badRequest('Choose a file to upload.');

    const allowed: readonly string[] = rule.video
      ? [...UPLOAD_LIMITS.imageTypes, ...UPLOAD_LIMITS.videoTypes]
      : UPLOAD_LIMITS.imageTypes;

    if (!allowed.includes(file.mimetype)) {
      throw new AppError(
        ERROR_CODES.UNSUPPORTED_FILE_TYPE,
        rule.video
          ? 'Upload a JPEG, PNG, WebP, AVIF, GIF or MP4.'
          : 'Upload a JPEG, PNG, WebP, AVIF or GIF.',
        415,
      );
    }

    const body = await file.toBuffer();

    /*
     * `toBuffer()` resolves even when the stream was cut short at the limit, so
     * the truncation flag is the only thing that distinguishes a 10MB file from
     * the first 10MB of a 400MB one. Without this the shop would store a
     * half-written image and nobody would know until it failed to render.
     */
    if (file.file.truncated) {
      throw new AppError(
        ERROR_CODES.UPLOAD_TOO_LARGE,
        `That file is larger than ${Math.round(UPLOAD_LIMITS.maxBytes / (1024 * 1024))}MB.`,
        413,
      );
    }

    const stored = await putObject(store.tenantRef, rule.folder, file.filename, body, file.mimetype);

    request.log.info(
      { tenantRef: store.tenantRef, key: stored.key, bytes: stored.sizeBytes, purpose },
      'file uploaded',
    );

    return ok(reply, stored, 201);
  });

  /**
   * Removing a file.
   *
   * Scoped to this store's own prefix — the key is supplied by the caller, and
   * without that check one shop could delete another's images by guessing a
   * path. The prefix is built by `objectKeyFor` and is the tenant reference, so
   * the comparison is exact rather than a substring match.
   */
  app.delete(
    '/uploads',
    { preHandler: [app.requireStoreAdmin, app.requirePermission('products.update')] },
    async (request, reply) => {
      const store = storeOf(request);
      const { key } = parseQuery(deleteSchema, request.query);

      if (!key.startsWith(`stores/${store.tenantRef}/`)) {
        throw badRequest('That file does not belong to this store.');
      }

      await deleteObject(key);

      return ok(reply, { deleted: true });
    },
  );
}
