import "next-auth";
import "next-auth/jwt";

interface DashboardSubscription {
  dashboardUserId: string | null;
  planId: string | null;
  planName: string | null;
  status: string | null;
  isActive: boolean;
  currentPeriodEnd: string | null;
}

declare module "next-auth" {
  // `apiKey` is carried internally through the credentials provider's return
  // value into the JWT — it MUST live on User but NOT on Session.user so it
  // doesn't leak to the browser via useSession()/getServerSession on the
  // client. Server code that needs it reads from the JWT via getToken().
  interface User {
    crmId: string | null;
    apiKey: string | null;
    xcelerateUserId?: string;
    provider?: string;
    // Row in Flask user_sessions (Settings → Signed-in sessions).
    sessionId?: string;
  }

  interface Session {
    user: {
      id: string;
      email: string;
      name: string;
      crmId: string | null;
      // apiKey intentionally absent — see auth-options.ts session callback.
      xcelerateUserId: string | null;
      provider: string;
      subscription: DashboardSubscription;
    };
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    crmId: string | null;
    apiKey: string | null;
    xcelerateUserId?: string;
    provider?: string;
    dashboardUserId?: string | null;
    planId?: string | null;
    planName?: string | null;
    subscriptionStatus?: string | null;
    subscriptionActive?: boolean;
    currentPeriodEnd?: string | null;
    subscriptionCheckedAt?: number;
    subscriptionLastSuccessAt?: number;
    // Row in Flask user_sessions. Absent on cookies issued before session
    // tracking; the jwt callback adds one the next time the cookie is refreshed.
    sessionId?: string;
    iat?: number;
    jti?: string;
  }
}
