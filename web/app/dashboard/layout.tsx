"use client";

import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar";
import { AccountProvider } from "@/lib/hooks/use-selected-account";
import { DashboardSidebar } from "@/components/dashboard/Sidebar";
import { DashboardHeader } from "@/components/dashboard/Header";
import { motion, MotionConfig } from "framer-motion";
import { AsciiBackground } from "@/components/dashboard/AsciiBackground";
import { useAppearance } from "@/lib/hooks/use-appearance";
import { AppearanceTransition } from "@/components/dashboard/AppearanceTransition";
import { Toaster } from "react-hot-toast";
import { TourProvider } from "@/lib/tour-context";
import { ProxyFixProvider } from "@/lib/hooks/use-proxy-fix";
import { ConfirmProvider } from "@/lib/hooks/use-confirm";
import { TourOverlay } from "@/components/dashboard/TourOverlay";
import { RateLimitBanner } from "@/components/dashboard/RateLimitBanner";
import { Pending2FABanner } from "@/components/dashboard/Pending2FABanner";
import { WritesDisabledWatcher } from "@/components/dashboard/WritesDisabledWatcher";
import { TwoFactorWatcher } from "@/components/dashboard/TwoFactorWatcher";
import { PendingTwoFactorProvider } from "@/lib/hooks/use-pending-2fa";
import { usePathname } from "next/navigation";
import { useEffect } from "react";

function DashboardBackground() {
  const { backgroundMode } = useAppearance();
  return <AsciiBackground mode={backgroundMode} />;
}

const PAGE_TITLES: Record<string, string> = {
  "/dashboard": "Overview",
  "/dashboard/accounts": "Accounts",
  "/dashboard/fans": "Fans",
  "/dashboard/inbox": "Inbox",
  "/dashboard/subscribers": "Subscribers",
  "/dashboard/earnings": "Earnings",
  "/dashboard/purchases": "Transactions",
  "/dashboard/campaigns": "Campaigns",
  "/dashboard/trial-links": "Trial Links",
  "/dashboard/notifications": "Notifications",
  "/dashboard/activity": "Activity",
  "/dashboard/automations": "Automations",
  "/dashboard/webhooks": "Webhooks",
  "/dashboard/import": "Bulk Import",
  "/dashboard/mcp": "MCP Server",
  "/dashboard/settings": "Settings",
  "/dashboard/api-keys": "API Keys",
  "/dashboard/console": "API Console",
  "/dashboard/api-docs": "API Docs",
  "/dashboard/tutorial": "Tutorial",
  "/dashboard/admin/overview": "Admin · Overview",
  "/dashboard/admin/panels": "Admin · Panels",
  "/dashboard/admin/users": "Admin · Users",
  "/dashboard/admin/oauth": "Admin · OAuth Clients",
  "/dashboard/admin/webhooks": "Admin · Webhooks",
  "/dashboard/admin/audit": "Admin · Audit Log",
  "/dashboard/admin/system": "Admin · System Health",
};

function PageTitle() {
  const pathname = usePathname();
  useEffect(() => {
    if (typeof document === "undefined") return;
    const currentPath = pathname || "";
    const exact = PAGE_TITLES[currentPath];
    const matched =
      exact ||
      (currentPath.startsWith("/dashboard/accounts/") ? "Account · Detail" : null);
    document.title = matched ? `${matched} — The Only API` : "The Only API";
  }, [pathname]);
  return null;
}

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <MotionConfig reducedMotion="user">
      <SidebarProvider className="h-screen min-h-0 overflow-hidden">
        <AccountProvider>
          <TourProvider>
            <ProxyFixProvider>
            <ConfirmProvider>
            {/* One poll for the whole dashboard, so any page can say that a
                bulk import has logins parked waiting on a 2FA code. */}
            <PendingTwoFactorProvider>
            <PageTitle />
            <div className="dashboard-context bg-black h-screen overflow-hidden w-full flex relative">
              <DashboardBackground />
              <AppearanceTransition />
              <Toaster
                position="top-right"
                toastOptions={{
                  style: { background: "#1a1a1a", color: "#fff", border: "1px solid rgba(255,255,255,0.08)" },
                  error: { style: { background: "#1a1a1a", borderColor: "rgba(239,68,68,0.3)" } },
                  success: { style: { background: "#1a1a1a", borderColor: "rgba(34,197,94,0.3)" } },
                }}
              />
              {/* Dashboard-wide "Enable writes" prompt for any 403
                  WRITES_DISABLED — see WritesDisabledWatcher. Renders nothing. */}
              <WritesDisabledWatcher />
              {/* Toasts when any account is flagged for 2FA / verification
                  (SSE verification.required) — see TwoFactorWatcher. */}
              <TwoFactorWatcher />
              <DashboardSidebar />
              <SidebarInset className="bg-transparent min-w-0">
                <DashboardHeader />
                <main className="flex-1 min-h-0 overflow-auto p-4 lg:p-6 relative z-[1] styled-scrollbar">
                  {/* One subscriber for every page's 429s — see api-client's
                      rate-limit broadcast. */}
                  <RateLimitBanner />
                  {/* Survives navigating away from the importer — 2FA work is
                      time-limited and must not be lost by closing a tab. */}
                  <Pending2FABanner />
                  <motion.div
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.3, ease: "easeOut" }}
                  >
                    {children}
                  </motion.div>
                </main>
              </SidebarInset>
              <TourOverlay />
            </div>
            </PendingTwoFactorProvider>
            </ConfirmProvider>
            </ProxyFixProvider>
          </TourProvider>
        </AccountProvider>
      </SidebarProvider>
    </MotionConfig>
  );
}
