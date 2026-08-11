import { NextResponse } from 'next/server';
import { z } from 'zod';
import { updateCustomer } from '@/lib/api/account';

/**
 * Profile update.
 *
 * Only three fields, and deliberately not the email address: changing the
 * address an account signs in with needs verification of the new one, which is
 * a different flow with a different endpoint. Accepting `email` here would let
 * a hijacked session quietly move the account to an attacker's inbox.
 */

const schema = z.object({
  fullName: z.string().trim().min(2).max(120),
  phone: z.string().trim().max(32).nullable().optional(),
  acceptsMarketing: z.boolean(),
});

export async function PUT(request: Request): Promise<NextResponse> {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: 'Please check your details.' }, { status: 400 });
  }

  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Please check your details.' }, { status: 422 });
  }

  const customer = await updateCustomer(parsed.data);
  if (!customer) {
    return NextResponse.json({ error: 'Please sign in again.' }, { status: 401 });
  }

  return NextResponse.json({ data: customer });
}
