"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { signOut, useSession } from "next-auth/react";
import { cn } from "@/lib/utils";
import {
  PxLayoutDashboard,
  PxUsers,
  PxUser,
  PxDollarSign,
  PxMegaphone,
  PxBell,
  PxMail,
  PxBookOpen,
  PxSettings,
  PxLogOut,
  PxCrown,
  PxUserCheck,
  PxReceipt,
  PxFileText,
  PxActivity,
  PxZap,
  PxLink,
  PxPlay,
  PxKey,
  PxPlus,
  PxShield,
} from "@/components/ui/PixelIcons";
import { usePendingTwoFactor } from "@/lib/hooks/use-pending-2fa";
import { AppearancePopover } from "@/components/dashboard/AppearancePopover";
import { useAdmin } from "@/lib/hooks/use-admin";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarRail,
  useSidebar,
} from "@/components/ui/sidebar";

const navItems: {
  href: string;
  label: string;
  icon: typeof PxLayoutDashboard;
  external?: boolean;
}[] = [
  { href: "/dashboard", label: "Overview", icon: PxLayoutDashboard },
  { href: "/dashboard/tutorial", label: "Tutorial", icon: PxPlay },
  { href: "/dashboard/accounts", label: "Accounts", icon: PxUsers },
  // Bulk Import is deliberately NOT a top-level nav item. It is an action you
  // take *on* your accounts, so it lives behind the Accounts page (see the
  // "Bulk import" button there). The route stays real and deep-linkable; the
  // parked-2FA count still surfaces globally via Pending2FABanner.
  { href: "/dashboard/fans", label: "Fans", icon: PxUser },
  { href: "/dashboard/inbox", label: "Inbox", icon: PxMail },
  { href: "/dashboard/subscribers", label: "Subscribers", icon: PxUserCheck },
  { href: "/dashboard/earnings", label: "Earnings", icon: PxDollarSign },
  { href: "/dashboard/purchases", label: "Transactions", icon: PxReceipt },
  { href: "/dashboard/export", label: "Export Data", icon: PxFileText },
  { href: "/dashboard/campaigns", label: "Campaigns", icon: PxMegaphone },
  { href: "/dashboard/trial-links", label: "Trial Links", icon: PxLink },
  { href: "/dashboard/notifications", label: "Notifications", icon: PxBell },
  { href: "/dashboard/activity", label: "Activity", icon: PxActivity },
  { href: "/dashboard/automations", label: "Automations", icon: PxZap },
  { href: "/dashboard/webhooks", label: "Webhooks", icon: PxLink },
  { href: "/dashboard/mcp", label: "MCP Server", icon: PxZap },
  { href: "/dashboard/api-keys", label: "API Keys", icon: PxKey },
  { href: "/dashboard/api-docs", label: "API Docs", icon: PxBookOpen },
];

/**
 * Profile avatar with a hard fallback to the initial.
 *
 * The session already carries `user.avatar` (auth-options puts it there and
 * refreshes it on the 30s cadence) — the sidebar simply never rendered it, so
 * uploading a picture appeared to do nothing. `onError` matters as much as the
 * happy path: an avatar URL can outlive its file, and a broken-image glyph in
 * the corner of every page is worse than the letter it replaced.
 */
function ProfileAvatar({
  src,
  initial,
  size,
}: {
  src?: string | null;
  initial: string;
  size: string;
}) {
  const [broken, setBroken] = useState(false);
  const showImage = !!src && !broken;
  return (
    <div
      className={cn(
        "shrink-0 flex items-center justify-center text-white font-bold text-sm overflow-hidden",
        size,
      )}
      style={{ backgroundColor: showImage ? undefined : "var(--theme-accent, #f54900)" }}
    >
      {showImage ? (
        // eslint-disable-next-line @next/next/no-img-element -- user-supplied
        // origin; next/image would need the host allowlisted and buys nothing
        // for a 256x256 already-optimised webp.
        <img
          src={src as string}
          alt=""
          className="h-full w-full object-cover"
          onError={() => setBroken(true)}
        />
      ) : (
        initial
      )}
    </div>
  );
}

function SidebarProfile() {
  const { data: session } = useSession();
  const { state } = useSidebar();
  const router = useRouter();
  const pathname = usePathname();
  const expanded = state === "expanded";
  const user = session?.user;
  const isSettingsActive = pathname === "/dashboard/settings";

  const initial = (user?.name || user?.email || "U").charAt(0).toUpperCase();
  const avatarUrl = (user as any)?.avatar as string | undefined;

  if (!expanded) {
    return (
      <div className="flex items-center justify-center mb-3 w-full">
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={() => router.push("/dashboard/settings")}
              className={cn(
                "flex h-10 w-10 shrink-0 items-center justify-center text-white font-bold text-sm transition-all focus:outline-none",
                isSettingsActive
                  ? "ring-2 ring-offset-2 ring-offset-[#0a0a0a]"
                  : "hover:ring-1 hover:ring-white/20 hover:ring-offset-1 hover:ring-offset-[#0a0a0a]"
              )}
              style={
                isSettingsActive
                  ? { ["--tw-ring-color" as string]: "var(--theme-accent, #f54900)" }
                  : undefined
              }
            >
              <ProfileAvatar src={avatarUrl} initial={initial} size="h-10 w-10" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="right">
            Settings
          </TooltipContent>
        </Tooltip>
      </div>
    );
  }

  return (
    <div className="mb-4 w-full">
      <button
        onClick={() => router.push("/dashboard/settings")}
        className={cn(
          "flex items-center gap-3 w-full px-3 py-2.5 transition-colors focus:outline-none",
          isSettingsActive
            ? "border-l-2"
            : "hover:bg-white/[0.03]"
        )}
        style={isSettingsActive ? {
          backgroundColor: "rgba(var(--theme-accent-rgb, 245, 73, 0), 0.1)",
          borderLeftColor: "var(--theme-accent, #f54900)",
        } : undefined}
      >
        <ProfileAvatar src={avatarUrl} initial={initial} size="h-9 w-9" />
        <div className="flex-1 min-w-0 text-left">
          <p className="font-semibold text-sm text-foreground truncate leading-tight">
            {user?.name || "User"}
          </p>
          <p className="text-xs text-muted-foreground truncate leading-tight mt-0.5">
            {user?.email || ""}
          </p>
        </div>
        <PxSettings className="h-4 w-4 text-muted-foreground shrink-0" />
      </button>
    </div>
  );
}

/** Admin-only subsection — only rendered if /api/admin/me succeeds.
 *
 *  Order: dashboard summary, then drill-downs (panels → users → oauth),
 *  then operational/observability (webhooks → audit → system). */
const adminItems = [
  { href: "/dashboard/admin/overview", label: "Overview", icon: PxLayoutDashboard },
  { href: "/dashboard/admin/panels", label: "Panels", icon: PxUsers },
  { href: "/dashboard/admin/users", label: "Users", icon: PxUser },
  { href: "/dashboard/admin/oauth", label: "OAuth Clients", icon: PxKey },
  { href: "/dashboard/admin/webhooks", label: "Webhook Approvals", icon: PxLink },
  { href: "/dashboard/admin/audit", label: "Audit Log", icon: PxFileText },
  { href: "/dashboard/admin/login-attempts", label: "Login Attempts", icon: PxShield },
  { href: "/dashboard/admin/system", label: "System Health", icon: PxActivity },
];

function AdminNavSection({
  expanded,
  pathname,
}: {
  expanded: boolean;
  pathname: string | null;
}) {
  const { isAdmin } = useAdmin();
  if (!isAdmin) return null;
  return (
    <>
      {expanded && (
        <p className="px-2 pt-3 pb-1 text-[10px] uppercase tracking-wider text-default-500 font-semibold">
          Admin
        </p>
      )}
      {adminItems.map((item) => {
        // /overview gets exact-match so /panels doesn't visually light it up
        const isActive =
          pathname === item.href ||
          (item.href !== "/dashboard/admin/overview" &&
            (pathname?.startsWith(item.href) ?? false));
        return (
          <SidebarNavItem
            key={item.href}
            item={item}
            isActive={isActive}
            expanded={expanded}
          />
        );
      })}
    </>
  );
}

function SidebarNavItem({
  item,
  isActive,
  expanded,
  dataTour,
  badge,
}: {
  item: (typeof navItems)[0];
  isActive: boolean;
  expanded: boolean;
  dataTour?: string;
  /** Count of things waiting on the operator behind this link. Rendered as an
   *  amber pill, or as a dot when the sidebar is collapsed. */
  badge?: number;
}) {
  const Icon = item.icon;
  const showBadge = typeof badge === "number" && badge > 0;
  const linkProps = item.external
    ? { target: "_blank" as const, rel: "noopener noreferrer" }
    : {};
  const tourAttr = dataTour ? { "data-tour": dataTour } : {};

  if (!expanded) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <Link
            href={item.href}
            {...linkProps}
            {...tourAttr}
            className={cn(
              "relative flex items-center justify-center h-10 w-10 text-muted-foreground transition-colors hover:text-foreground hover:bg-white/[0.03]",
              isActive && "border-l-2"
            )}
            style={isActive ? {
              backgroundColor: "rgba(var(--theme-accent-rgb, 245, 73, 0), 0.1)",
              borderLeftColor: "var(--theme-accent, #f54900)",
              color: "var(--theme-accent, #f54900)",
            } : undefined}
          >
            <Icon className="h-5 w-5 shrink-0" />
            {showBadge && (
              <span className="absolute top-1.5 right-1.5 h-1.5 w-1.5 bg-amber-400" />
            )}
          </Link>
        </TooltipTrigger>
        <TooltipContent side="right">
          {item.label}
          {showBadge ? ` — ${badge} awaiting a code` : ""}
        </TooltipContent>
      </Tooltip>
    );
  }

  return (
    <Link
      href={item.href}
      {...linkProps}
      {...tourAttr}
      className={cn(
        "flex items-center gap-3 px-3 py-2 text-muted-foreground transition-colors hover:text-foreground hover:bg-white/[0.03] w-full",
        isActive && "border-l-2"
      )}
      style={isActive ? {
        backgroundColor: "rgba(var(--theme-accent-rgb, 245, 73, 0), 0.1)",
        borderLeftColor: "var(--theme-accent, #f54900)",
        color: "var(--theme-accent, #f54900)",
      } : undefined}
    >
      <Icon className="h-5 w-5 shrink-0" />
      <span className="truncate text-sm">{item.label}</span>
      {showBadge && (
        <span
          title={`${badge} login${badge === 1 ? "" : "s"} waiting for a 2FA code`}
          className="ml-auto shrink-0 border border-amber-500/30 bg-amber-500/10 px-1.5 text-[10px] tabular-nums text-amber-400"
        >
          {badge}
        </span>
      )}
    </Link>
  );
}


// Pixel ASCII animation rows for the banner
const PIXEL_ROWS = [
  "■ · ■ · · ■ · ■ · ■",
  "· ■ · ■ ■ · ■ · ■ ·",
  "■ · ■ · · ■ · ■ · ■",
];

function SidebarBanner() {
  const [activeCol, setActiveCol] = useState(0);
  const [gridOffset, setGridOffset] = useState(0);
  const hostedPricingUrl = process.env.NEXT_PUBLIC_HOSTED_PRICING_URL;
  const totalCols = 10;

  useEffect(() => {
    const interval = setInterval(() => {
      setActiveCol((prev) => (prev + 1) % totalCols);
    }, 120);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const gridInterval = setInterval(() => {
      setGridOffset((prev) => (prev + 1) % 20);
    }, 80);
    return () => clearInterval(gridInterval);
  }, []);

  return (
    <div className="w-full mb-2 relative overflow-hidden border border-white/[0.06]">
      {/* Animated grid pattern background */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          backgroundImage: `
            linear-gradient(rgba(var(--theme-accent-rgb, 245, 73, 0),0.06) 1px, transparent 1px),
            linear-gradient(90deg, rgba(var(--theme-accent-rgb, 245, 73, 0),0.06) 1px, transparent 1px)
          `,
          backgroundSize: "10px 10px",
          backgroundPosition: `${gridOffset * 0.5}px ${gridOffset * 0.5}px`,
        }}
      />

      {/* Orange gradient glow — animated pulse */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background: `
            radial-gradient(ellipse at 50% 0%, rgba(var(--theme-accent-rgb, 245, 73, 0),0.15) 0%, transparent 60%),
            radial-gradient(ellipse at 50% 100%, rgba(var(--theme-accent-rgb, 245, 73, 0),0.08) 0%, transparent 50%)
          `,
          animation: "bannerPulse 3s ease-in-out infinite",
        }}
      />

      {/* Animated top border gradient */}
      <div
        className="absolute top-0 left-0 right-0 h-[2px]"
        style={{
          background: "linear-gradient(90deg, transparent, var(--theme-accent, #f54900), var(--theme-accent-hover, #ff7a30), var(--theme-accent, #f54900), transparent)",
          backgroundSize: "200% 100%",
          animation: "bannerShimmer 2.5s linear infinite",
        }}
      />

      <div className="relative z-10 p-3 bg-[#0d0d0d]/80">
        {/* ASCII pixel animation */}
        <div className="mb-2.5 font-mono text-[10px] leading-[14px] select-none overflow-hidden">
          {PIXEL_ROWS.map((row, rowIdx) => (
            <div key={rowIdx} className="flex justify-center gap-[2px]">
              {row.split(" ").map((char, colIdx) => {
                const distance = Math.abs(colIdx - activeCol);
                const isLit = distance <= 1 && char === "■";
                return (
                  <span
                    key={colIdx}
                    className="transition-all duration-150"
                    style={{
                      color: isLit
                        ? "var(--theme-accent, #f54900)"
                        : char === "■"
                          ? "rgba(255,255,255,0.12)"
                          : "rgba(255,255,255,0.04)",
                      textShadow: isLit ? `0 0 6px rgba(var(--theme-accent-rgb, 245, 73, 0),0.5)` : "none",
                    }}
                  >
                    {char}
                  </span>
                );
              })}
            </div>
          ))}
        </div>

        {/* Title */}
        <p className="text-xs font-bold tracking-wider uppercase text-center" style={{
          background: "linear-gradient(90deg, var(--theme-accent, #f54900), var(--theme-accent-hover, #ff7a30), var(--theme-accent, #f54900))",
          backgroundSize: "200% 100%",
          animation: "bannerShimmer 3s linear infinite",
          WebkitBackgroundClip: "text",
          WebkitTextFillColor: "transparent",
          backgroundClip: "text",
        }}>
          Open Source
        </p>
        <p className="text-[10px] text-neutral-500 text-center mb-3">
          OnlyFans + Fansly API · self-hosted
        </p>

        {/* Buttons */}
        <div className="flex flex-col gap-1.5">
          <a
            href="/dashboard/api-docs"
            className="flex items-center justify-center w-full py-1.5 text-white text-xs font-bold uppercase tracking-wider transition-colors"
            style={{ backgroundColor: "var(--theme-accent, #f54900)" }}
            onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = "var(--theme-accent-hover, #ff7a30)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "var(--theme-accent, #f54900)"; }}
          >
            API Docs
          </a>
          {hostedPricingUrl && (
            <a
              href={hostedPricingUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-center w-full py-1.5 border border-[color:var(--theme-accent,#f54900)] text-[color:var(--theme-accent,#f54900)] text-xs font-bold uppercase tracking-wider hover:text-white transition-colors"
              style={{ backgroundColor: "rgba(var(--theme-accent-rgb, 245, 73, 0), 0.08)" }}
            >
              Need hosting for scale?
            </a>
          )}
          <a
            href="https://github.com/XceleratorCRM/onlyfans-api"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-center w-full py-1.5 border border-white/[0.12] text-neutral-400 text-xs font-bold uppercase tracking-wider hover:text-white hover:border-white/20 transition-colors"
          >
            GitHub Repository
          </a>
        </div>
      </div>

      {/* Keyframe styles */}
      <style jsx>{`
        @keyframes bannerShimmer {
          0% { background-position: -200% 0; }
          100% { background-position: 200% 0; }
        }
        @keyframes bannerPulse {
          0%, 100% { opacity: 0.6; }
          50% { opacity: 1; }
        }
      `}</style>
    </div>
  );
}

export function DashboardSidebar() {
  const pathname = usePathname();
  const { state } = useSidebar();
  const expanded = state === "expanded";
  // Shared with the dashboard-wide banner: one poll, two surfaces.
  const { count: pending2faCount } = usePendingTwoFactor();

  return (
    <Sidebar collapsible="icon" variant="sidebar">
      <TooltipProvider delayDuration={0}>
        <nav
          className={cn(
            "flex h-full flex-col py-4 sm:py-5 transition-all duration-300 relative",
            expanded ? "items-start px-4" : "items-center pl-[0.9375rem] pr-4"
          )}
        >
          {/* Top Section - Profile and Navigation (scrollable) */}
          <div
            className={cn(
              "flex flex-col gap-1.5 flex-1 w-full overflow-y-auto styled-scrollbar",
              !expanded && "items-center justify-start pt-1"
            )}
          >
            {/* Profile Section */}
            <SidebarProfile />

            {/* Navigation Items */}
            <div
              data-tour="sidebar-nav"
              className={cn(
                "w-full space-y-1",
                !expanded && "flex flex-col items-center space-y-1"
              )}
            >
              {navItems.map((item) => {
                const isActive =
                  item.href === "/dashboard"
                    ? pathname === "/dashboard"
                    : pathname?.startsWith(item.href) ?? false;

                // Slug-derived tour selector: /dashboard → "overview",
                // /dashboard/accounts → "accounts", etc.
                const slug =
                  item.href === "/dashboard"
                    ? "overview"
                    : item.href.replace(/^\/dashboard\//, "");
                const dataTour = `sidebar-${slug}`;

                return (
                  <SidebarNavItem
                    key={item.href}
                    item={item}
                    isActive={isActive}
                    expanded={expanded}
                    dataTour={dataTour}
                    // Read off the dashboard-wide provider — no extra request.
                    // Parked 2FA codes hang off Accounts now that Bulk Import
                    // lives behind that page; without this the count would have
                    // no home in the nav and a logged-out-and-back operator
                    // would lose the only hint that logins are waiting.
                    badge={
                      item.href === "/dashboard/accounts"
                        ? pending2faCount
                        : undefined
                    }
                  />
                );
              })}
              <AdminNavSection expanded={expanded} pathname={pathname} />
            </div>
          </div>

          {/* Bottom Section - Sticky */}
          <div
            className={cn(
              "sticky bottom-0 bg-[#0a0a0a] border-t border-white/[0.06] pt-2 mt-2",
              expanded ? "w-full" : "w-full flex flex-col items-center"
            )}
          >
            {/* Xcelerator Banner - expanded only */}
            {expanded && <SidebarBanner />}

            {/* Bottom Icons */}
            <div
              className={cn(
                "flex gap-1.5",
                expanded
                  ? "flex-col w-full"
                  : "flex-col items-center w-full"
              )}
            >
              {/* Appearance Popover */}
              <AppearancePopover />

              {/* Logout Button */}
              {expanded ? (
                <Button
                  variant="ghost"
                  onClick={() => signOut({ callbackUrl: "/login" })}
                  className="w-full justify-start gap-3 px-3 py-2 text-muted-foreground hover:text-foreground hover:bg-white/[0.03] rounded-none"
                >
                  <PxLogOut className="h-5 w-5 shrink-0" />
                  <span>Logout</span>
                </Button>
              ) : (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => signOut({ callbackUrl: "/login" })}
                      className="h-10 w-10 text-muted-foreground hover:text-foreground hover:bg-white/[0.03] rounded-none"
                    >
                      <PxLogOut className="h-5 w-5" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="right">Logout</TooltipContent>
                </Tooltip>
              )}
            </div>
          </div>
        </nav>
      </TooltipProvider>
    </Sidebar>
  );
}
