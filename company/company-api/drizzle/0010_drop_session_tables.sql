-- Sessions moved out of PostgreSQL entirely.
--
-- A session is now a JWT in an HttpOnly cookie, with a Redis record that its
-- `jti` names deciding whether it is still live (see `src/lib/session.ts`).
-- Nothing reads these tables any more, and leaving them would leave two places
-- that look like they answer "who is signed in" while only one of them does.
--
-- Dropping them signs everyone out, which is the honest outcome: the tokens
-- these rows backed cannot be verified by the new guards either way.
DROP TABLE IF EXISTS "company_admin_sessions";
--> statement-breakpoint
DROP TABLE IF EXISTS "client_sessions";
