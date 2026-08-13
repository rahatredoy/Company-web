import { createHash, createHmac, randomUUID } from 'node:crypto';
import { config } from '../config/index';
import { AppError, ERROR_CODES } from './errors';
import { logger } from './logger';

/**
 * Cloudflare R2, signed by hand.
 *
 * R2 speaks S3, and a `PUT` of one object needs exactly one thing the platform
 * does not already have: an AWS SigV4 signature. That is ~60 lines of HMAC
 * chaining below, against `@aws-sdk/client-s3` and its transitive tree — which
 * would be the largest dependency in an API that has seventeen of them and
 * hand-rolls its own TOTP and HTML sanitiser for the same reason.
 *
 * The signature is deterministic and the whole of it is on this page, so it can
 * be read in one sitting. If this ever needs multipart uploads, resumable
 * transfers or lifecycle rules, that is the point to take the SDK — those are
 * where hand-rolling stops being reasonable.
 *
 * **Credentials never leave this module** and no signed URL is ever returned to
 * a browser. An upload is proxied through the API so that size, type and the
 * caller's permission are all checked by something that cannot be edited by the
 * person uploading.
 */

const SERVICE = 's3';
/** R2 ignores the region but SigV4 requires one in the scope. */
const REGION = 'auto';

function sha256Hex(payload: Buffer | string): string {
  return createHash('sha256').update(payload).digest('hex');
}

function hmac(key: Buffer | string, value: string): Buffer {
  return createHmac('sha256', key).update(value, 'utf8').digest();
}

/**
 * `20260812T121314Z` and `20260812`.
 *
 * SigV4 wants both, and they must agree — a signature built from one day's key
 * and another day's timestamp is rejected with a message that names neither.
 */
function stamps(now: Date): { amzDate: string; dateStamp: string } {
  const amzDate = `${now.toISOString().replace(/[-:]/g, '').split('.')[0]}Z`;
  return { amzDate, dateStamp: amzDate.slice(0, 8) };
}

/**
 * Percent-encodes a key the way S3 expects in a canonical request.
 *
 * `encodeURIComponent` leaves `!'()*` alone and S3 does not, so a filename with
 * a bracket in it would sign correctly and then fail to match. Slashes stay
 * literal because they are path separators in the object key.
 */
function encodeKey(key: string): string {
  return key
    .split('/')
    .map((segment) =>
      encodeURIComponent(segment).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`),
    )
    .join('/');
}

interface SignedRequest {
  url: string;
  headers: Record<string, string>;
}

function sign(method: 'PUT' | 'DELETE', key: string, body: Buffer, contentType?: string): SignedRequest {
  const { endpoint, accessKey, secretKey, bucket } = config.storage;
  if (!endpoint || !accessKey || !secretKey || !bucket) {
    throw new AppError(ERROR_CODES.STORAGE_NOT_CONFIGURED, 'File storage is not set up.', 503);
  }

  const host = new URL(endpoint).host;
  const canonicalUri = `/${bucket}/${encodeKey(key)}`;
  const { amzDate, dateStamp } = stamps(new Date());
  const payloadHash = sha256Hex(body);

  const headers: Record<string, string> = {
    host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDate,
  };
  if (contentType) headers['content-type'] = contentType;

  // Signed headers must be sorted, lower-cased, and listed in the same order in
  // both the canonical request and the `SignedHeaders` of the authorization.
  const signedHeaderNames = Object.keys(headers).sort();
  const canonicalHeaders = signedHeaderNames.map((name) => `${name}:${headers[name]!.trim()}\n`).join('');
  const signedHeaders = signedHeaderNames.join(';');

  const canonicalRequest = [
    method,
    canonicalUri,
    '',
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n');

  const scope = `${dateStamp}/${REGION}/${SERVICE}/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256Hex(canonicalRequest)].join('\n');

  const signature = hmac(
    hmac(hmac(hmac(hmac(`AWS4${secretKey}`, dateStamp), REGION), SERVICE), 'aws4_request'),
    stringToSign,
  ).toString('hex');

  headers.authorization = `AWS4-HMAC-SHA256 Credential=${accessKey}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  return { url: `${endpoint.replace(/\/$/, '')}${canonicalUri}`, headers };
}

export interface StoredObject {
  key: string;
  url: string;
  sizeBytes: number;
  contentType: string;
}

/**
 * Where an uploaded file lives.
 *
 * Namespaced by tenant so one store's objects are visibly separate in a shared
 * bucket, and named with a UUID rather than the uploaded filename — a name a
 * user chose is a name that can collide, carry a path, or carry an extension
 * that disagrees with the bytes.
 */
export function objectKeyFor(tenantRef: string, folder: string, filename: string): string {
  const extension = (filename.split('.').pop() ?? '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 8);
  const safeFolder = folder.replace(/[^a-z0-9-]/gi, '').slice(0, 24) || 'files';
  return `stores/${tenantRef}/${safeFolder}/${randomUUID()}${extension ? `.${extension}` : ''}`;
}

/** The address the file is served from. Never the credentialed endpoint. */
export function publicUrlFor(key: string): string {
  const base = config.storage.publicUrl?.replace(/\/$/, '');
  if (base) return `${base}/${encodeKey(key)}`;

  // Without a public domain the bucket is not reachable from a browser, and a
  // link to the signing endpoint would 401 for every visitor. Saying so is more
  // useful than returning an address that cannot work.
  throw new AppError(
    ERROR_CODES.STORAGE_NOT_CONFIGURED,
    'File storage has no public address configured.',
    503,
  );
}

export async function putObject(
  tenantRef: string,
  folder: string,
  filename: string,
  body: Buffer,
  contentType: string,
): Promise<StoredObject> {
  const key = objectKeyFor(tenantRef, folder, filename);
  const { url, headers } = sign('PUT', key, body, contentType);

  const response = await fetch(url, { method: 'PUT', headers, body: new Uint8Array(body) });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    logger.error({ status: response.status, key, detail: detail.slice(0, 400) }, 'R2 upload failed');
    throw new AppError(ERROR_CODES.INTERNAL_ERROR, 'The file could not be saved. Try again.', 502);
  }

  return { key, url: publicUrlFor(key), sizeBytes: body.byteLength, contentType };
}

/**
 * Best-effort removal.
 *
 * A file that outlives the row pointing at it costs storage; a delete that
 * throws costs the user their action. The row is the record that matters, so a
 * failure here is logged and swallowed.
 *
 * **The object goes immediately; the CDN copy does not.** The public domain is
 * behind Cloudflare with a four-hour `max-age`, so the old URL keeps answering
 * `200` from the edge until that expires. That is harmless here only because
 * keys are UUIDs and never reused — nothing points at the old address any more.
 * It would not be harmless for a scheme that reused names, which is the reason
 * `objectKeyFor` does not.
 */
export async function deleteObject(key: string): Promise<void> {
  try {
    const { url, headers } = sign('DELETE', key, Buffer.alloc(0));
    const response = await fetch(url, { method: 'DELETE', headers });
    if (!response.ok && response.status !== 404) {
      logger.warn({ status: response.status, key }, 'R2 delete failed');
    }
  } catch (error) {
    logger.warn({ err: (error as Error).message, key }, 'R2 delete failed');
  }
}

export const storageConfigured = (): boolean => config.storage.configured && Boolean(config.storage.publicUrl);
