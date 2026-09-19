"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession } from "next-auth/react";
import { Avatar } from "@heroui/avatar";
import PlatformBadge from "./PlatformBadge";
import {
  PxLayoutDashboard,
  PxUsers,
  PxDollarSign,
  PxMegaphone,
  PxBell,
  PxBookOpen,
  PxSettings,
  PxUserCheck,
  PxReceipt,
} from "@/components/ui/PixelIcons";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Separator } from "@/components/ui/separator";
import { ConnectionStatus } from "./ConnectionStatus";
import { useAccounts } from "@/lib/hooks/use-selected-account";
import { AccountPicker } from "@/components/dashboard/AccountPicker";
import { useTour } from "@/lib/tour-context";
import { TOUR_ACCOUNTS } from "@/lib/tour-fake-data";

const pageTitles: Record<string, { title: string; icon: any }> = {
  "/dashboard": { title: "Overview", icon: PxLayoutDashboard },
  "/dashboard/accounts": { title: "Accounts", icon: PxUsers },
  "/dashboard/subscribers": { title: "Subscribers", icon: PxUserCheck },
  "/dashboard/earnings": { title: "Earnings", icon: PxDollarSign },
  "/dashboard/purchases": { title: "Transactions", icon: PxReceipt },
  "/dashboard/campaigns": { title: "Campaigns", icon: PxMegaphone },
  "/dashboard/notifications": { title: "Notifications", icon: PxBell },
  "/dashboard/api-docs": { title: "API Documentation", icon: PxBookOpen },
  "/dashboard/settings": { title: "Settings", icon: PxSettings },
};

export function DashboardHeader() {
  const pathname = usePathname();
  const { data: session } = useSession();
  const { accounts: realAccounts, selectedAccount, setSelectedAccount } = useAccounts();
  const { isActive: isTourActive } = useTour();
  // During the tour, surface fake accounts in the dropdown so the
  // header-account tour step has something concrete to highlight.
  const accounts = isTourActive ? TOUR_ACCOUNTS : realAccounts;

  const page = pageTitles[pathname || ""] || {
    title: "Dashboard",
    icon: PxLayoutDashboard,
  };
  const PageIcon = page.icon;

  return (
    <header
      className="flex h-16 shrink-0 items-center justify-between gap-4 border-b border-white/[0.06]
        bg-[#0a0a0a] px-4 lg:px-6"
    >
      {/* Left: sidebar trigger + page title */}
      <div className="flex items-center gap-3">
        <SidebarTrigger className="-ml-1" />
        <Separator orientation="vertical" className="mr-2 !h-4" />

        <div className="flex items-center gap-2">
          <PageIcon className="h-5 w-5" style={{ color: "var(--theme-accent, #f54900)" }} />
          <h1 className="text-lg font-medium tracking-[-0.02em]">{page.title}</h1>
        </div>
      </div>

      {/* Right: account selector + user avatar */}
      <div className="flex items-center gap-3" data-tour="header-account">
        {!isTourActive && <ConnectionStatus />}
        {isTourActive && (
          <span
            className="bg-orange-500/10 text-orange-300 border border-orange-500/30 px-2 py-0.5 rounded text-[10px] uppercase tracking-wider font-semibold"
            title="The dashboard is showing sample data while the tour is active. Your real account is untouched."
          >
            Demo data
          </span>
        )}
        {accounts.length > 0 && (
          <div className="hidden sm:block">
            <AccountPicker
              accounts={accounts}
              selected={
                selectedAccount ?? (isTourActive ? accounts[0] : null)
              }
              // Selection is decorative while the tour is running.
              onSelect={(a) => {
                if (!isTourActive) setSelectedAccount(a);
              }}
            />
          </div>
        )}

        {/* User profile avatar — links to settings. The avatar URL comes from
            the NextAuth session, refreshed every 30s from the dashboard. */}
        {session?.user && (
          <Link
            href="/dashboard/settings"
            className="flex items-center"
            title={`${session.user.name || ""} — open settings`}
          >
            <Avatar
              src={(session.user as any).avatar || undefined}
              name={session.user.name || session.user.email || "?"}
              size="sm"
              radius="full"
              className="w-8 h-8 text-tiny"
            />
          </Link>
        )}

      </div>
    </header>
  );
}
