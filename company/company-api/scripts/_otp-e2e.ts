/**
 * Throwaway end-to-end check of the client OTP flow against the running API.
 * Recovers each passcode by hashing the six-digit space against the stored
 * hash, which is only possible because this script has database access.
 */
import { createHash } from 'node:crypto';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { closeDatabase, db } from '../src/db/client';
import { clientAccounts, clientEmailVerificationTokens } from '../src/db/schema/index';
import { listClientSessions } from '../src/lib/session';

const BASE = 'http://localhost:4000/api/v1';
const email = `otp-e2e-${Date.now()}@example.com`;
const password = 'Sup3rSecret!Pass';

let failures = 0;
function check(label: string, condition: boolean, detail?: unknown) {
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${label}${condition ? '' : `  -> ${JSON.stringify(detail)}`}`);
  if (!condition) failures += 1;
}

function crack(hash: string): string | null {
  for (let i = 0; i < 1_000_000; i += 1) {
    const candidate = String(i).padStart(6, '0');
    if (createHash('sha256').update(candidate, 'utf8').digest('hex') === hash) return candidate;
  }
  return null;
}

function cookieValue(response: Response, name: string): string | null {
  const headers = response.headers.getSetCookie?.() ?? [];
  for (const raw of headers) {
    const [pair] = raw.split(';');
    const [key, value] = (pair ?? '').split('=');
    if (key === name) return value ?? null;
  }
  return null;
}

async function post(path: string, body?: unknown, cookie?: string) {
  const response = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { response, json: (await response.json().catch(() => null)) as any };
}

async function get(path: string, cookie?: string) {
  const response = await fetch(`${BASE}${path}`, { headers: cookie ? { cookie } : {} });
  return { response, json: (await response.json().catch(() => null)) as any };
}

// --- Registration -> emailed code -> activation -----------------------------

const register = await post('/public/register', {
  fullName: 'OTP Test',
  email,
  phone: '+8801712345678',
  password,
  acceptTerms: true,
});
check('register returns otpRequired', register.json?.data?.otpRequired === true, register.json);
check('register sets no session cookie', cookieValue(register.response, 'company_client_session') === null);

const [account] = await db
  .select({ id: clientAccounts.id })
  .from(clientAccounts)
  .where(eq(clientAccounts.email, email))
  .limit(1);

const [codeRow] = await db
  .select()
  .from(clientEmailVerificationTokens)
  .where(eq(clientEmailVerificationTokens.clientAccountId, account!.id))
  .orderBy(desc(clientEmailVerificationTokens.createdAt))
  .limit(1);

const verificationCode = crack(codeRow!.codeHash)!;
check('verification code stored hashed', !!verificationCode && codeRow!.codeHash.length === 64);

const wrongCode = await post('/public/verify-email', {
  email,
  code: verificationCode === '000000' ? '111111' : '000000',
});
check('wrong verification code rejected', wrongCode.json?.code === 'OTP_INVALID', wrongCode.json);

const verified = await post('/public/verify-email', { email, code: verificationCode });
const verifiedCookie = cookieValue(verified.response, 'company_client_session');
check('correct code verifies + signs in', verified.json?.data?.signedIn === true, verified.json);
check('verification issues a session cookie', !!verifiedCookie);

const me = await get('/client/me', `company_client_session=${verifiedCookie}`);
check('session from verification reaches /client/me', me.json?.data?.email === email, me.json);

const replay = await post('/public/verify-email', { email, code: verificationCode });
check('code cannot be replayed', replay.response.status === 409, replay.json);

await post('/public/logout', undefined, `company_client_session=${verifiedCookie}`);

// --- Sign-in -> challenge -> passcode ---------------------------------------

const login = await post('/public/login', { email, password, remember: true });
const challengeCookie = cookieValue(login.response, 'company_client_otp');
check('login returns otpRequired', login.json?.data?.otpRequired === true, login.json);
check('login masks the destination address', /\*/.test(login.json?.data?.sentTo ?? ''), login.json?.data);
check('login issues challenge cookie only', !!challengeCookie);
check('login does not issue a session cookie', !cookieValue(login.response, 'company_client_session'));

const challengeAsSession = await get('/client/me', `company_client_session=${challengeCookie}`);
check(
  'challenge token cannot be replayed as a session',
  challengeAsSession.response.status === 401,
  challengeAsSession.json,
);

// Read from the session records: a challenge is a Redis record now, not a row.
const [challengeRow] = await listClientSessions(account!.id);

check('challenge record is unverified', challengeRow?.otpVerified === false);
check('challenge remembers the remember-me choice', challengeRow?.remember === true);

const signInCode = crack(challengeRow!.otpCodeHash!)!;
const badOtp = await post(
  '/public/login/otp/verify',
  { code: signInCode === '000000' ? '111111' : '000000' },
  `company_client_otp=${challengeCookie}`,
);
check('wrong sign-in code rejected', badOtp.json?.code === 'OTP_INVALID', badOtp.json);

const resend = await post('/public/login/otp/resend', undefined, `company_client_otp=${challengeCookie}`);
check('resend inside cooldown refused', resend.json?.code === 'OTP_RESEND_TOO_SOON', resend.json);

const promoted = await post('/public/login/otp/verify', { code: signInCode }, `company_client_otp=${challengeCookie}`);
const sessionCookie = cookieValue(promoted.response, 'company_client_session');
check('correct sign-in code signs in', promoted.json?.data?.signedIn === true, promoted.json);
check('promotion issues a session cookie', !!sessionCookie);
check('promotion rotates the token', sessionCookie !== challengeCookie);

const meAgain = await get('/client/me', `company_client_session=${sessionCookie}`);
check('promoted session reaches /client/me', meAgain.json?.data?.email === email, meAgain.json);

const oldToken = await get('/client/me', `company_client_session=${challengeCookie}`);
check('pre-promotion token is dead', oldToken.response.status === 401, oldToken.json);

// --- Cleanup ----------------------------------------------------------------

await db.delete(clientAccounts).where(eq(clientAccounts.id, account!.id));
await closeDatabase();

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
