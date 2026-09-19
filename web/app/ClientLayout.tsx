"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { SessionProvider, getSession, useSession } from "next-auth/react";
import { ProvidersProps, Providers } from "./providers";
import { ChunkErrorReloader } from "@/components/ui/ChunkErrorReloader";

// A session signed out from Settings (here or on another device) turns
// "unauthenticated" on the next session refresh. Leave the dashboard then,
// after a second look so a one-off network error doesn't bounce anyone.
function DashboardSessionGuard() {
  const { status } = useSession();
  useEffect(() => {
    if (status !== "unauthenticated") return;
    const timer = setTimeout(async () => {
      if (!(await getSession())) window.location.href = "/login";
    }, 1500);
    return () => clearTimeout(timer);
  }, [status]);
  return null;
}

export function ClientLayout({ children }: ProvidersProps) {
  const pathname = usePathname();
  const isDashboard = pathname?.startsWith("/dashboard") ?? false;
  // Pages that require a signed-in session (see middleware.ts).
  const isSignedInArea = isDashboard;

  useEffect(() => {
    document.body.classList.toggle("dashboard-cursor", !!isDashboard);
  }, [isDashboard]);

  return (
    <SessionProvider>
      <Providers>
        <ChunkErrorReloader />
        {isSignedInArea && <DashboardSessionGuard />}
        {isDashboard ? (
          children
        ) : (
          // Everything outside the dashboard is an auth screen or the OAuth
          // consent page. They render bare — there is no marketing chrome in a
          // self-hosted install.
          <div className="relative flex flex-col min-h-screen">
            <main className="flex-grow">{children}</main>
          </div>
        )}
      </Providers>
    </SessionProvider>
  );
}
