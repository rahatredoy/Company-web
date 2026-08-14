import { NextResponse } from 'next/server';
import { z } from 'zod';

const addressSchema = z.object({
  label: z.string().trim().max(40).nullable().optional(),
  fullName: z.string().trim().min(2).max(120),
  phone: z.string().trim().min(6).max(24),
  addressLine1: z.string().trim().min(3).max(200),
  addressLine2: z.string().trim().max(200).nullable().optional(),
  city: z.string().trim().min(2).max(80),
  state: z.string().trim().max(80).nullable().optional(),
  postalCode: z.string().trim().max(20).nullable().optional(),
  country: z.string().trim().min(2).max(80),
  isDefault: z.boolean().default(false),
});

const idSchema = z.string().uuid();

/**
 * The address book's writes.
 *
 * A thin proxy: the session cookie is `httpOnly`, so the browser cannot call the
 * Commerce API itself, and every write has to pass through a route handler that
 * can read it. Validation is duplicated here only to fail fast with a per-field
 * message — the API validates again and is the one that decides.
 */
async function forward(
  method: 'POST' | 'PUT' | 'DELETE',
  path: string,
  body?: unknown,
): Promise<NextResponse> {
  const { apiFetch, ApiError, flattenDetails } = await import('@/lib/api/client');
  const { storeCall, cookieHeader } = await import('@/lib/tenant');

  try {
    const data = await apiFetch<unknown>(path, {
      method,
      body,
      ...(await storeCall()),
      cookieHeader: await cookieHeader(),
    });
    return method === 'DELETE'
      ? new NextResponse(null, { status: 204 })
      : NextResponse.json({ data }, { status: method === 'POST' ? 201 : 200 });
  } catch (error) {
    if (error instanceof ApiError) {
      return NextResponse.json(
        { error: error.message, details: flattenDetails(error.details) },
        { status: error.status || 502 },
      );
    }
    return NextResponse.json({ error: 'We could not save that address.' }, { status: 502 });
  }
}

async function parse(request: Request) {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return { ok: false as const, response: NextResponse.json({ error: 'Please check the address.' }, { status: 400 }) };
  }

  const parsed = addressSchema.safeParse(payload);
  if (!parsed.success) {
    const details: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path.join('.');
      if (key && !details[key]) details[key] = 'Please check this field.';
    }
    return {
      ok: false as const,
      response: NextResponse.json({ error: 'Some details need your attention.', details }, { status: 422 }),
    };
  }

  return { ok: true as const, data: parsed.data };
}

export async function POST(request: Request): Promise<NextResponse> {

  const parsed = await parse(request);
  if (!parsed.ok) return parsed.response;

  return forward('POST', '/api/v1/storefront/account/addresses', parsed.data);
}

export async function PUT(request: Request): Promise<NextResponse> {

  const id = new URL(request.url).searchParams.get('id') ?? '';
  if (!idSchema.safeParse(id).success) {
    return NextResponse.json({ error: 'That address does not exist.' }, { status: 400 });
  }

  const parsed = await parse(request);
  if (!parsed.ok) return parsed.response;

  return forward('PUT', `/api/v1/storefront/account/addresses/${id}`, parsed.data);
}

export async function DELETE(request: Request): Promise<NextResponse> {

  const id = new URL(request.url).searchParams.get('id') ?? '';
  if (!idSchema.safeParse(id).success) {
    return NextResponse.json({ error: 'That address does not exist.' }, { status: 400 });
  }

  return forward('DELETE', `/api/v1/storefront/account/addresses/${id}`);
}
