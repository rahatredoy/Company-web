import multipart from '@fastify/multipart';
import { and, asc, eq, sql } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  orderItems,
  orders,
  returnAttachments,
  returnHistory,
  returnItems,
  returns,
} from '../../db/schema/index';
import type { TenantExecutor } from '../../db/tenant-manager';
import type { OrderStatus } from '../../lib/constants';
import { RATE_LIMITS } from '../../lib/constants';
import { AppError, ERROR_CODES, notFound, unprocessable } from '../../lib/errors';
import { ok, parseBody, parseParams } from '../../lib/http';
import { enforce } from '../../lib/rate-limit';
import { deleteObject, putObject, storageConfigured, type StoredObject } from '../../lib/storage';
import { moneyToNumber, toMoney } from '../../lib/utils';
import { storeOf } from '../../plugins/tenant';
import { authoriseOrder } from './orders.routes';
import { canRequestReturn, claimDailyRef, DEFAULT_RETURN_WINDOW_DAYS } from './orders.service';

const paramsSchema = z.object({ orderNumber: z.string().trim().min(1).max(32) });

const returnSchema = z.object({
  items: z
    .array(
      z.object({
        /** Index into the order's own line list, as the wizard sends it. */
        lineIndex: z.coerce.number().int().min(0).max(99),
        quantity: z.coerce.number().int().min(1).max(99),
      }),
    )
    .min(1, 'Choose what you are returning.')
    .max(50),
  reason: z.string().trim().min(1, 'Tell us why.').max(60),
  description: z.string().trim().max(2000).nullable().optional(),
  resolution: z.enum(['refund', 'exchange', 'replacement']),
});

/**
 * The photos a customer may attach to a return.
 *
 * Two is enough to show the fault and the label, and keeps the whole request
 * well under the storefront proxy's 10MB body cap. The storefront shrinks a
 * photo before sending it; these limits are what hold when something else sends.
 */
const RETURN_PHOTO_LIMITS = {
  maxFiles: 2,
  maxBytes: 5 * 1024 * 1024,
  types: ['image/jpeg', 'image/png', 'image/webp'] as readonly string[],
};

/**
 * Reasons that are a fault with the product, and therefore need a photo — a
 * damage claim is decided on the picture, "changed my mind" has nothing to show.
 * Mirrored by `REASONS` in the storefront's `return-wizard.tsx`.
 */
const EVIDENCE_REASONS = new Set(['damaged', 'wrong_item', 'not_as_described']);

interface Photo {
  filename: string;
  mimetype: string;
  body: Buffer;
}

function photoTooLarge(): AppError {
  return new AppError(
    ERROR_CODES.UPLOAD_TOO_LARGE,
    `Each photo must be under ${RETURN_PHOTO_LIMITS.maxBytes / (1024 * 1024)}MB.`,
    413,
  );
}

/**
 * The request, as JSON or as `multipart/form-data`.
 *
 * With photos, the form carries the same JSON object in a `payload` field and
 * the files as `photos`. Without them a plain JSON body still works.
 */
async function readReturnRequest(request: FastifyRequest): Promise<{ body: unknown; photos: Photo[] }> {
  if (!request.isMultipart()) return { body: request.body, photos: [] };

  let body: unknown = null;
  const photos: Photo[] = [];

  try {
    for await (const part of request.parts()) {
      if (part.type === 'field') {
        if (part.fieldname === 'payload' && typeof part.value === 'string') {
          try {
            body = JSON.parse(part.value);
          } catch {
            body = null;
          }
        }
        continue;
      }

      if (!RETURN_PHOTO_LIMITS.types.includes(part.mimetype)) {
        throw new AppError(ERROR_CODES.UNSUPPORTED_FILE_TYPE, 'Photos must be JPEG, PNG or WebP.', 415);
      }

      const buffer = await part.toBuffer();
      // `toBuffer()` can resolve on a stream cut short at the limit; see uploads.
      if (part.file.truncated) throw photoTooLarge();

      photos.push({ filename: part.filename, mimetype: part.mimetype, body: buffer });
    }
  } catch (error) {
    if (error instanceof AppError) throw error;
    const code = (error as { code?: string }).code;
    if (code === 'FST_REQ_FILE_TOO_LARGE') throw photoTooLarge();
    if (code === 'FST_FILES_LIMIT') {
      const message = `Attach at most ${RETURN_PHOTO_LIMITS.maxFiles} photos.`;
      throw unprocessable(message, ERROR_CODES.VALIDATION_FAILED, { photos: [message] });
    }
    throw error;
  }

  return { body, photos };
}

/**
 * Customer-initiated returns.
 *
 * Items arrive as **`lineIndex`** — the position in `OrderDetail.lines` — not as
 * a row id, because that is what the storefront's wizard has to hand. The index
 * is resolved against the same ordering `loadOrderDetail` uses, so the two
 * cannot drift; anything out of range is refused rather than clamped.
 */
export default async function storefrontReturnRoutes(app: FastifyInstance) {
  await app.register(multipart, {
    limits: {
      fileSize: RETURN_PHOTO_LIMITS.maxBytes,
      files: RETURN_PHOTO_LIMITS.maxFiles,
      fields: 1,
    },
  });

  app.post(
    '/account/orders/:orderNumber/returns',
    { preHandler: [app.optionalCustomer] },
    async (request, reply) => {
      const store = storeOf(request);
      const { orderNumber } = parseParams(paramsSchema, request.params);
      await enforce(request, 'return-request', RATE_LIMITS.forgotPassword);
      const { body: raw, photos } = await readReturnRequest(request);
      const body = parseBody(returnSchema, raw);

      if (EVIDENCE_REASONS.has(body.reason) && photos.length === 0) {
        throw unprocessable('Add a photo of the problem.', ERROR_CODES.VALIDATION_FAILED, {
          photos: ['A photo of the problem is needed for this reason.'],
        });
      }

      const owned = await authoriseOrder(request, store, orderNumber);
      if (!owned) throw notFound('That order does not exist.');

      if (photos.length > 0 && !storageConfigured()) {
        throw new AppError(
          ERROR_CODES.STORAGE_NOT_CONFIGURED,
          'Photos cannot be uploaded right now. Please try again later.',
          503,
        );
      }

      /*
       * Uploaded before the transaction, never inside it: a tenant has four
       * database connections, and holding one open across an upload is how a
       * slow connection stalls the shop. A return the transaction then refuses
       * has its objects removed again.
       */
      const stored: StoredObject[] = [];
      const discardPhotos = () => Promise.all(stored.map((object) => deleteObject(object.key)));
      try {
        for (const photo of photos) {
          stored.push(await putObject(store.tenantRef, 'returns', photo.filename, photo.body, photo.mimetype));
        }
      } catch (error) {
        await discardPhotos();
        throw error;
      }

      const created = await store.db.transaction(async (tx) => {
        const [order] = await tx
          .select({
            id: orders.id,
            status: orders.status,
            deliveredAt: orders.deliveredAt,
            customerId: orders.customerId,
          })
          .from(orders)
          .where(eq(orders.id, owned.id))
          .limit(1);

        if (!order) throw notFound('That order does not exist.');

        // Same ordering as the detail endpoint — this is what makes `lineIndex`
        // mean the same thing on both sides.
        const lines = await tx
          .select({
            id: orderItems.id,
            productName: orderItems.productName,
            quantity: orderItems.quantity,
            returnedQuantity: orderItems.returnedQuantity,
            unitPrice: orderItems.unitPrice,
            unitSalePrice: orderItems.unitSalePrice,
          })
          .from(orderItems)
          .where(eq(orderItems.orderId, order.id))
          .orderBy(asc(orderItems.createdAt));

        const eligible = lines.some((line) => line.quantity > line.returnedQuantity);

        if (
          !canRequestReturn(
            order.status as OrderStatus,
            order.deliveredAt,
            DEFAULT_RETURN_WINDOW_DAYS,
            eligible,
          )
        ) {
          throw unprocessable(
            'This order cannot be returned.',
            order.status === 'delivered'
              ? ERROR_CODES.RETURN_WINDOW_CLOSED
              : ERROR_CODES.PRODUCT_NOT_RETURNABLE,
          );
        }

        const chosen = body.items.map((item) => {
          const line = lines[item.lineIndex];
          if (!line) {
            throw unprocessable('That item is not on this order.', ERROR_CODES.VALIDATION_FAILED, {
              items: ['One of the chosen items is not on this order.'],
            });
          }

          const remaining = line.quantity - line.returnedQuantity;
          if (item.quantity > remaining) {
            throw unprocessable(
              `You can return at most ${remaining} of ${line.productName}.`,
              ERROR_CODES.RETURN_QUANTITY_EXCEEDED,
              { items: [`Only ${remaining} of ${line.productName} can be returned.`] },
            );
          }

          const unit = line.unitSalePrice ?? line.unitPrice;
          return {
            orderItemId: line.id,
            quantity: item.quantity,
            unitPrice: unit,
            lineTotal: toMoney(moneyToNumber(unit) * item.quantity),
          };
        });

        const refundable = chosen.reduce((sum, item) => sum + moneyToNumber(item.lineTotal), 0);
        const returnNumber = await claimReturnNumber(tx);

        const [row] = await tx
          .insert(returns)
          .values({
            returnNumber,
            orderId: order.id,
            customerId: order.customerId,
            reason: body.reason,
            description: body.description ?? null,
            resolution: body.resolution,
            // What it is worth if approved in full. Staff can reduce it during
            // inspection; the customer is never quoted more than they paid.
            refundableAmount: toMoney(refundable),
          })
          .returning({ id: returns.id, returnNumber: returns.returnNumber });

        await tx.insert(returnItems).values(
          chosen.map((item) => ({ ...item, returnId: row!.id })),
        );

        if (stored.length > 0) {
          await tx.insert(returnAttachments).values(
            stored.map((object) => ({
              returnId: row!.id,
              url: object.url,
              objectKey: object.key,
              mimeType: object.contentType,
              sizeBytes: object.sizeBytes,
            })),
          );
        }

        await tx.insert(returnHistory).values({
          returnId: row!.id,
          toStatus: 'requested',
          note: body.reason,
        });

        /*
         * `returned_quantity` is claimed now, not on approval. Two requests for
         * the same line would otherwise both pass the remaining-quantity check
         * and the shop would owe twice what it sold.
         */
        for (const item of chosen) {
          await tx
            .update(orderItems)
            .set({ returnedQuantity: sql`${orderItems.returnedQuantity} + ${item.quantity}` })
            .where(and(eq(orderItems.id, item.orderItemId)));
        }

        return row!;
      }).catch(async (error: unknown) => {
        await discardPhotos();
        throw error;
      });

      return ok(reply, { returnNumber: created.returnNumber, photos: stored.length }, 201);
    },
  );
}

/** `RET-20260812-0003`, allocated the same way an order number is. */
async function claimReturnNumber(tx: TenantExecutor): Promise<string> {
  return claimDailyRef(
    'RET',
    async () => {
      const [row] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(returns)
        .where(sql`${returns.createdAt} >= date_trunc('day', now())`);
      return Number(row?.count ?? 0);
    },
    async (candidate) => {
      const [taken] = await tx
        .select({ id: returns.id })
        .from(returns)
        .where(eq(returns.returnNumber, candidate))
        .limit(1);
      return Boolean(taken);
    },
  );
}
