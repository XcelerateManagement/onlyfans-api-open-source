import type { NextAuthOptions } from "next-auth";
import type { JWT } from "next-auth/jwt";
import CredentialsProvider from "next-auth/providers/credentials";

import {
  accountSecurityCall,
  accountSecurityEnabled,
  sessionMetadata,
  MFA_REQUIRED_PREFIX,
} from "@/lib/account-security";
import { backendUrl } from "@/lib/backend-url";

/**
 * Authentication for a self-hosted install.
 *
 * There is exactly one authority here: your own API container. Signing in posts
 * the credentials to its `/api/auth/login`, which returns the panel's `crm_id`
 * and API key. Those go into the signed session cookie, and every dashboard
 * request is proxied server-side with the key attached.
 *
 * Nothing contacts an external service. There is no subscription to check, no
 * plan, no account-slot count and no licence — an account either exists in your
 * database or it does not.
 *
 * Optional: panel-level 2FA and revocable sessions, which live in the API behind
 * `/internal/account-security/*`. They stay off unless you set BOTH
 * ACCOUNT_SECURITY_CRM_IDS and INTER_SERVICE_TOKEN. See .env.example.
 */

type CrmCredentials = { crmId: string; apiKey: string };

/** Exchange an email and password for the panel's crm_id + API key. */
async function login(
  email: string,
  password: string,
): Promise<CrmCredentials | null> {
  try {
    const res = await fetch(`${backendUrl()}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
      cache: "no-store",
    });

    if (!res.ok) return null;

    const data = await res.json();

    if (!data?.crm_id || !data?.api_key) return null;

    return { crmId: String(data.crm_id), apiKey: String(data.api_key) };
  } catch (e) {
    // Reached when the API container is down or BACKEND_URL is wrong.
    console.error(
      "[auth] could not reach the API - check BACKEND_URL and that the api " +
        `container is running: ${e instanceof Error ? e.message : String(e)}`,
    );

    return null;
  }
}

/** Open a revocable server-side session, when the panel has that enabled. */
async function startSession(
  crmId: string,
  meta: { email: string; name: string },
  reqHeaders: Record<string, string | undefined>,
): Promise<string | undefined> {
  try {
    const created = await accountSecurityCall<{ session_id: string }>(
      "sessions/create",
      {
        crm_id: crmId,
        method: "password",
        ...meta,
        ...sessionMetadata(reqHeaders),
      },
    );

    return created?.session_id;
  } catch {
    // Session tracking is a convenience; never block a valid login on it.
    return undefined;
  }
}

/** Second step of a 2FA login: verify the code against the challenge. */
async function completeTwoFactor(
  challenge: string,
  code: string,
  recovery: boolean,
  reqHeaders: Record<string, string | undefined>,
) {
  const verified = await accountSecurityCall<{
    ok: boolean;
    crm_id?: string;
    api_key?: string;
    email?: string;
    name?: string;
  }>("challenge/verify", { challenge, code, recovery });

  if (!verified?.ok || !verified.crm_id || !verified.api_key) {
    throw new Error("That code was not correct.");
  }

  const sessionId = await startSession(
    verified.crm_id,
    { email: verified.email || "", name: verified.name || "" },
    reqHeaders,
  );

  return {
    id: verified.crm_id,
    email: verified.email || "",
    name: verified.name || verified.email?.split("@")[0] || "",
    crmId: verified.crm_id,
    apiKey: verified.api_key,
    sessionId,
  };
}

export const authOptions: NextAuthOptions = {
  session: { strategy: "jwt" },
  providers: [
    CredentialsProvider({
      id: "credentials",
      name: "Email and password",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
        // Second step, for panels with 2FA enabled.
        challenge: { label: "Challenge", type: "text" },
        code: { label: "Code", type: "text" },
        recovery: { label: "Recovery code", type: "text" },
      },
      async authorize(credentials, req) {
        const reqHeaders = (req?.headers || {}) as Record<
          string,
          string | undefined
        >;

        if (credentials?.challenge) {
          return (await completeTwoFactor(
            credentials.challenge as string,
            (credentials.code as string) || "",
            credentials.recovery === "true",
            reqHeaders,
          )) as never;
        }

        if (!credentials?.email || !credentials?.password) return null;

        const email = (credentials.email as string).trim().toLowerCase();
        const password = credentials.password as string;

        const crm = await login(email, password);

        if (!crm) {
          // Throw rather than return null so the login page shows a real reason
          // instead of the opaque "Failed to create session". The wording is
          // deliberately generic - it must not reveal whether the address exists.
          throw new Error("Invalid email or password.");
        }

        const name = email.split("@")[0];

        // With 2FA on, stop here and make the client complete the challenge.
        if (accountSecurityEnabled(crm.crmId)) {
          const mfa = await accountSecurityCall<{
            mfa_required: boolean;
            challenge?: string;
          }>("challenge/start", { crm_id: crm.crmId, email }).catch(() => null);

          if (mfa?.mfa_required && mfa.challenge) {
            throw new Error(`${MFA_REQUIRED_PREFIX}${mfa.challenge}`);
          }
        }

        const sessionId = accountSecurityEnabled(crm.crmId)
          ? await startSession(crm.crmId, { email, name }, reqHeaders)
          : undefined;

        return {
          id: crm.crmId,
          email,
          name,
          crmId: crm.crmId,
          apiKey: crm.apiKey,
          sessionId,
        } as never;
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        const u = user as unknown as {
          crmId?: string;
          apiKey?: string;
          sessionId?: string;
        };

        token.crmId = u.crmId ?? null;
        // The API key lives ONLY on the signed server-side JWT. It is never
        // copied onto the session object - see the session callback below.
        (token as JWT).apiKey = u.apiKey ?? null;
        token.sessionId = u.sessionId;
      }

      // If the panel revoked this session from Settings, stop honouring it.
      if (token.crmId && token.sessionId && accountSecurityEnabled(token.crmId)) {
        const alive = await accountSecurityCall<{ active: boolean }>(
          "sessions/check",
          { crm_id: token.crmId, session_id: token.sessionId },
        ).catch(() => null);

        // Only act on a definite "revoked" - a transient API error must not log
        // everybody out.
        if (alive && alive.active === false) {
          return {} as JWT;
        }
      }

      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        const u = session.user;

        u.crmId = (token.crmId as string | null) ?? null;
        u.provider = "credentials";

        // NOTE: `apiKey` is deliberately NOT copied here. It stays on the signed
        // JWT and reaches the browser only through:
        //   - /api/crm/[...path]  - attached as X-API-Key by the proxy
        //   - /api/me/api-key     - session-gated, on demand
        // Putting it on session.user would expose it to every client component
        // via useSession(), making any XSS a one-step credential leak.
      }

      return session;
    },
  },
  pages: { signIn: "/login" },
  secret: process.env.NEXTAUTH_SECRET,
  events: {
    async signOut({ token }) {
      if (!token?.crmId || !token.sessionId) return;

      await accountSecurityCall("sessions/end", {
        crm_id: token.crmId,
        session_id: token.sessionId,
      }).catch(() => {
        /* the cookie is cleared regardless */
      });
    },
  },
  logger: {
    error(code, metadata) {
      const detail =
        metadata instanceof Error
          ? metadata.message
          : (metadata as { error?: { message?: string } })?.error?.message ||
            JSON.stringify(metadata);

      console.error(`[next-auth][error][${code}] ${detail}`);
    },
    warn(code) {
      console.warn(`[next-auth][warn][${code}]`);
    },
    debug() {
      /* silenced */
    },
  },
};
