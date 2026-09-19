import { getActiveToken } from "@/lib/account-security";
import { NextRequest, NextResponse } from "next/server";

/**
 * Auth gate for the panel.
 *
 * Signed in or not — that is the only question here. The hosted product also
 * checked a subscription claim and bounced anyone without one to a checkout
 * page; there is no subscription on a self-hosted install, so an account either
 * exists or it does not.
 *
 * `getActiveToken` additionally refuses sessions revoked from
 * Settings -> Signed-in sessions, when a panel has that enabled.
 */
export async function middleware(request: NextRequest) {
  const token = await getActiveToken(request);

  if (!token) {
    const login = new URL("/login", request.url);

    // Send them back where they were headed once they sign in.
    login.searchParams.set("callbackUrl", request.nextUrl.pathname);

    return NextResponse.redirect(login);
  }

  return NextResponse.next();
}

export const config = {
  // Only the signed-in areas. Everything else is the login and register pages.
  matcher: ["/dashboard/:path*", "/console"],
};
