import { request as httpRequest, type IncomingHttpHeaders } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { Readable } from 'node:stream';
import type { NextRequest } from 'next/server';

/**
 * `/api/v1/*` on this app's own origin, forwarded to the Commerce API with the
 * visitor's `Host` intact.
 *
 * On a connected custom domain the storefront has no per-store API hostname to call,
 * so it calls its own origin and relies on something in front of it to send
 * `/api/v1` on to client-api. That used to be the edge proxy's job alone, and a
 * path route there is easy to get subtly wrong — the symptom is every API call
 * landing back on this app, which renders a page that calls the API again.
 * Doing it here makes the deployment one domain per app with nothing path-based.
 *
 * **`Host` is the whole point**, and it is why this is `node:http` rather than
 * `fetch` or a Next rewrite: both of those replace `Host` with the
 * destination's, and client-api identifies the store from that header alone.
 *
 * `CLIENT_API_INTERNAL_URL` is server-only and names client-api on the private
 * network (e.g. `http://company-project-clientbackedn-jauori:4100`). Unset, the
 * route answers 404, which is the right behaviour in development: there the
 * storefront calls the API directly with `X-Store-Slug`, and a path this app does
 * not serve should not pretend to.
 *
 * A deliberate copy lives in `client-admin/src/app/api/v1/[...path]/route.ts`.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Headers that describe one connection, not the message, and must not be passed on. */
const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
]);

function upstreamHeaders(request: NextRequest): Record<string, string> {
  const headers: Record<string, string> = {};
  request.headers.forEach((value, key) => {
    if (HOP_BY_HOP.has(key)) return;
    // Asked uncompressed: the body is streamed through untouched, and the edge
    // compresses what reaches the browser anyway.
    if (key === 'accept-encoding') return;
    headers[key] = value;
  });

  // The visitor's hostname, not this container's — `x-forwarded-host` first,
  // because that is what the edge saw when it rewrote `host` for us.
  const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host');
  if (host) headers.host = host.split(',')[0]!.trim();
  headers['x-forwarded-proto'] = request.headers.get('x-forwarded-proto') ?? 'https';
  return headers;
}

function responseHeaders(incoming: IncomingHttpHeaders): Headers {
  const headers = new Headers();
  for (const [key, value] of Object.entries(incoming)) {
    if (value === undefined || HOP_BY_HOP.has(key)) continue;
    // One `Set-Cookie` per value: joining them with a comma breaks any cookie
    // whose `Expires` carries one.
    if (Array.isArray(value)) value.forEach((entry) => headers.append(key, entry));
    else headers.set(key, value);
  }
  return headers;
}

async function forward(request: NextRequest): Promise<Response> {
  const base = process.env.CLIENT_API_INTERNAL_URL;
  if (!base) return new Response('Not found', { status: 404 });

  const target = new URL(request.nextUrl.pathname + request.nextUrl.search, base);
  const send = target.protocol === 'https:' ? httpsRequest : httpRequest;
  const hasBody = request.method !== 'GET' && request.method !== 'HEAD' && request.body !== null;

  return new Promise<Response>((resolve) => {
    const upstream = send(
      target,
      { method: request.method, headers: upstreamHeaders(request) },
      (res) => {
        const status = res.statusCode ?? 502;
        const body = status === 204 || status === 304 || request.method === 'HEAD'
          ? null
          : (Readable.toWeb(res) as ReadableStream<Uint8Array>);
        resolve(new Response(body, { status, headers: responseHeaders(res.headers) }));
      },
    );

    upstream.on('error', () => {
      resolve(
        Response.json(
          { code: 'UPSTREAM_UNAVAILABLE', message: 'The store service could not be reached.' },
          { status: 502 },
        ),
      );
    });

    if (hasBody) {
      Readable.fromWeb(request.body as import('node:stream/web').ReadableStream).pipe(upstream);
    } else {
      upstream.end();
    }
  });
}

export const GET = forward;
export const HEAD = forward;
export const POST = forward;
export const PUT = forward;
export const PATCH = forward;
export const DELETE = forward;
export const OPTIONS = forward;
