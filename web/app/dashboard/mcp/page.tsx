"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { Button } from "@heroui/button";
import { Tabs, Tab } from "@heroui/tabs";
import { Tooltip } from "@heroui/tooltip";
import { Switch } from "@heroui/switch";
import { Accordion, AccordionItem } from "@heroui/accordion";
import { Chip } from "@heroui/chip";
import toast from "react-hot-toast";

import {
  GlassCard,
  GlassCardHeader,
  GlassCardBody,
} from "@/components/dashboard/GlassCard";
import { SecretField } from "@/components/dashboard/SecretField";
import {
  PxZap,
  PxShield,
  PxCopy,
  PxCheck,
  PxBookOpen,
  PxPlay,
  PxCode2,
} from "@/components/ui/PixelIcons";
import { useApiClient } from "@/lib/hooks/use-api-client";
import { useApiKey } from "@/lib/hooks/use-api-key";

const DEFAULT_MCP_URL =
  process.env.NEXT_PUBLIC_MCP_URL || "http://localhost:5000/mcp";

interface ToolEntry {
  name: string;
  description: string;
}
interface ToolGroup {
  domain: string;
  tools: ToolEntry[];
}

// Starter prompts. Realistic, copy-paste-ready, no placeholder ids that
// require the user to look something up first. Each one resolves to one or
// two tool calls so the user sees a result fast.
const STARTER_WALKTHROUGH: string[] = [
  "What's my plan and remaining API quota?",
  "Which OF accounts are connected, and which one earned the most this week?",
  "List my top 10 spenders across all accounts.",
  "For anyone in the top 10 who hasn't messaged in 7 days, draft a friendly re-engagement message. Don't send it.",
];

const EXAMPLE_PROMPTS: { title: string; prompts: string[] }[] = [
  {
    title: "Revenue & reporting",
    prompts: [
      "What's my total earnings this week and how does it compare to last week?",
      "Build a daily briefing for Slack: this week's earnings, top 5 spenders, unread chat count.",
      "Show me earnings broken down by tips, subscriptions, and PPV this month.",
      "Project my revenue for the rest of this month based on current pace.",
    ],
  },
  {
    title: "Fans & retention",
    prompts: [
      "Who's my biggest spender across all my accounts?",
      "List my top 20 spenders and their last activity date — who's gone silent?",
      "How many unique fans do I have across all accounts?",
      "Find fans who spent over $100 but haven't messaged in 14 days. Draft a re-engagement DM (no send).",
    ],
  },
  {
    title: "Inbox & messaging",
    prompts: [
      "Show me my unread chat backlog across all accounts.",
      "Draft a custom-content response template for fans who asked. Don't send anything.",
      "Which conversations have an unanswered PPV message?",
      "Send a quick 'how are you enjoying the page?' to my top spender. Ask me to confirm first.",
    ],
  },
  {
    title: "Finances & audits",
    prompts: [
      "How much have I lost to chargebacks in the last 90 days? Which fans were involved?",
      "Export every transaction over $100 from Q1 as a CSV for my accountant.",
      "What's my net revenue this month after chargebacks and platform fees?",
      "Surface any suspicious activity: repeated failed tips, unusual chargeback patterns.",
    ],
  },
  {
    title: "Tracking links & growth",
    prompts: [
      "Which of my tracking links made the most money?",
      "Show me the top spenders that came through my best tracking link.",
      "List my tracking links and show the share URL for each.",
      "Do I have any tracking links with low conversion coverage?",
    ],
  },
  {
    title: "Operations & automation",
    prompts: [
      "What's my current plan and remaining API quota?",
      "Set up a webhook that posts every new $50+ tip to my Discord.",
      "Create an automation: when I send a PPV, wait 2 days and send a follow-up reminder.",
      "Show me failed webhook deliveries in the last 24 hours and help me debug.",
    ],
  },
];

function PromptRow({ text, step }: { text: string; step?: number }) {
  const [copied, setCopied] = useState(false);
  return (
    <li className="group flex items-start gap-2 border border-white/[0.04] hover:border-white/[0.1] bg-black/30 px-2.5 py-2 transition-colors">
      {step ? (
        <span className="mt-0.5 select-none text-[10px] font-mono text-[color:var(--theme-accent,#f54900)] w-4">
          {step}.
        </span>
      ) : (
        <span className="text-[color:var(--theme-accent,#f54900)] mt-0.5 select-none text-xs">›</span>
      )}
      <span className="flex-1 text-xs text-white/85 leading-relaxed">{text}</span>
      <button
        type="button"
        onClick={() => {
          navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
        className="opacity-50 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity border border-white/[0.08] hover:border-white/[0.2] px-1.5 py-0.5"
        aria-label="Copy prompt"
        title={copied ? "Copied" : "Copy"}
      >
        {copied ? (
          <PxCheck className="h-3 w-3 text-green-400" />
        ) : (
          <PxCopy className="h-3 w-3" />
        )}
      </button>
    </li>
  );
}

// Static catalog — kept in sync with mcp-server/src/tools/*.ts.
const TOOL_CATALOG: ToolGroup[] = [
  {
    domain: "Identity & accounts",
    tools: [
      { name: "of_whoami", description: "Current CRM, plan, MCP flags." },
      { name: "of_list_accounts", description: "List connected OF accounts." },
      { name: "of_delete_account", description: "Detach an OF account (confirm required)." },
      { name: "of_get_polling", description: "Polling status for one account." },
      { name: "of_set_polling", description: "Enable/disable polling + interval." },
      { name: "of_get_proxy", description: "Get the proxy for one account." },
      { name: "of_set_proxy", description: "Update the proxy for one account." },
      { name: "of_set_subscription_price", description: "Change subscription price (confirm)." },
    ],
  },
  {
    domain: "Login",
    tools: [
      { name: "of_login_account", description: "Add an OF account by email/password (handles 2FA)." },
      { name: "of_login_with_cookies", description: "Add an account via sess/auth_id cookies." },
      { name: "of_verify_login_otp", description: "Complete a 2FA-gated login." },
    ],
  },
  {
    domain: "Fans",
    tools: [
      { name: "of_list_fans", description: "List fans with lifetime spend / tags. dedupe_by_fan=true collapses same-person-multi-creator; with_total=true returns the full count." },
      { name: "of_refresh_fan_profile", description: "Force-refresh one fan from OF." },
      { name: "of_add_fan_tag", description: "Tag a fan." },
      { name: "of_remove_fan_tag", description: "Remove a tag from a fan." },
      { name: "of_list_fan_transactions", description: "Cached tx ledger for one fan." },
    ],
  },
  {
    domain: "Subscribers",
    tools: [
      { name: "of_list_subscribers", description: "Live subscriber list (active/expired/all)." },
      { name: "of_list_subscribers_cached", description: "Cached subscriber list." },
      { name: "of_refresh_subscribers", description: "Kick off async subscriber refresh." },
    ],
  },
  {
    domain: "Inbox",
    tools: [
      { name: "of_list_chats", description: "List active chats for an account." },
      { name: "of_list_messages", description: "Message history with one fan." },
      { name: "of_send_message", description: "Send a DM (write action, confirm required)." },
    ],
  },
  {
    domain: "Earnings & payouts",
    tools: [
      { name: "of_get_balances", description: "Current payout balances." },
      { name: "of_get_earnings_chart", description: "Earnings chart for a date range." },
      { name: "of_get_earnings_summary", description: "Aggregated summary by period." },
      { name: "of_get_payout_account", description: "Bank/payment method details." },
      { name: "of_list_payout_requests", description: "Prior payout requests." },
      { name: "of_create_payout_request", description: "Submit a payout (confirm)." },
    ],
  },
  {
    domain: "Tracking links (Campaigns)",
    tools: [
      { name: "of_list_campaigns", description: "Live: list tracking links with name + shortLink. Costs 1 OF call per account." },
      { name: "of_create_campaign", description: "Create a new tracking-link campaign." },
      { name: "of_list_campaign_claimers", description: "Per-fan attribution: who joined via campaign X + their lifetime spend." },
      { name: "of_get_campaign_earnings", description: "Free, DB-only: total_spent per campaign (lifetime tips+PPV+subs) + coverage_pct. Use to answer 'which tracking link made the most money'." },
      { name: "of_refresh_campaigns", description: "Background sync of all claimer lists." },
    ],
  },
  {
    domain: "Transactions",
    tools: [
      { name: "of_list_purchases", description: "Recent purchases (live)." },
      { name: "of_list_transactions_cached", description: "Cached transactions ledger." },
      { name: "of_refresh_transactions", description: "Async transactions refresh." },
      { name: "of_get_refresh_status", description: "Poll status of refresh jobs." },
      { name: "of_list_active_refreshes", description: "List in-progress refreshes." },
    ],
  },
  {
    domain: "Notifications & events",
    tools: [
      { name: "of_list_notifications", description: "OF notifications feed for one account." },
      { name: "of_list_events", description: "Activity events (use `since` cursor)." },
    ],
  },
  {
    domain: "Webhooks",
    tools: [
      { name: "of_list_webhooks", description: "List webhooks (secrets masked)." },
      { name: "of_get_webhook", description: "Get one webhook by id." },
      { name: "of_create_webhook", description: "Create a new webhook." },
      { name: "of_update_webhook", description: "Patch a webhook." },
      { name: "of_delete_webhook", description: "Delete a webhook (confirm)." },
      { name: "of_test_webhook", description: "Send a test delivery." },
      { name: "of_list_webhook_deliveries", description: "Recent delivery attempts." },
    ],
  },
  {
    domain: "Automations",
    tools: [
      { name: "of_list_automations", description: "List automation rules." },
      { name: "of_get_automation", description: "Get one automation by id." },
      { name: "of_create_automation", description: "Create a new automation rule." },
      { name: "of_update_automation", description: "Patch an automation." },
      { name: "of_delete_automation", description: "Delete an automation (confirm)." },
      { name: "of_run_automation_now", description: "Manual run against a sample event." },
      { name: "of_list_automation_runs", description: "History of automation runs." },
    ],
  },
  {
    domain: "Usage & integrations",
    tools: [
      { name: "of_get_usage", description: "Monthly API-call usage + plan limits (cost tracking)." },
      { name: "of_list_telegram_groups", description: "Resolve groups for a Telegram bot token." },
    ],
  },
  {
    domain: "Escape hatches",
    tools: [
      { name: "of_crm_request", description: "Generic CRM call. Admin paths blocked." },
      { name: "of_proxy_request", description: "Generic OF API call via proxy. Non-GET gated." },
    ],
  },
];

function CopyButton({ value, label = "Copy" }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      size="sm"
      variant="bordered"
      radius="none"
      className="border-white/[0.08] text-[10px] uppercase tracking-wider"
      startContent={
        copied ? (
          <PxCheck className="h-3 w-3 text-green-400" />
        ) : (
          <PxCopy className="h-3 w-3" />
        )
      }
      onPress={() => {
        navigator.clipboard.writeText(value);
        setCopied(true);
        setTimeout(() => setCopied(false), 1800);
      }}
    >
      {copied ? "Copied" : label}
    </Button>
  );
}

function CodeBlock({ children, copyValue }: { children: string; copyValue?: string }) {
  return (
    // max-w-full + min-w-0 stop the block from inflating its parent.
    // overflow-x-auto keeps the long JSON lines scrollable WITHIN the box
    // instead of pushing the page width out.
    <div className="dashboard-code-block relative border border-white/[0.06] bg-black/40 max-w-full min-w-0">
      {copyValue !== undefined && (
        <div className="absolute right-2 top-2 z-10">
          <CopyButton value={copyValue} />
        </div>
      )}
      <pre className="text-xs font-mono overflow-x-auto whitespace-pre p-3 pt-8 styled-scrollbar max-w-full">
        {children}
      </pre>
    </div>
  );
}

export default function McpServerPage() {
  const { data: session } = useSession();
  const api = useApiClient();
  const { apiKey: liveApiKey } = useApiKey();

  const apiKey = liveApiKey || "";
  const crmId = session?.user?.crmId || "";

  const mcpUrl = DEFAULT_MCP_URL;

  // Use a placeholder token for the visible code snippets — we only paste the
  // real one to the clipboard via the copy buttons.
  const placeholderToken = "YOUR_API_KEY";

  const claudeDesktopJson = useMemo(
    () =>
      JSON.stringify(
        {
          mcpServers: {
            "the-only-api": {
              url: mcpUrl,
              headers: { Authorization: `Bearer ${placeholderToken}` },
            },
          },
        },
        null,
        2,
      ),
    [mcpUrl],
  );
  const claudeDesktopJsonReal = useMemo(
    () =>
      JSON.stringify(
        {
          mcpServers: {
            "the-only-api": {
              url: mcpUrl,
              headers: { Authorization: `Bearer ${apiKey}` },
            },
          },
        },
        null,
        2,
      ),
    [mcpUrl, apiKey],
  );

  const cursorJson = useMemo(
    () =>
      JSON.stringify(
        {
          mcpServers: {
            "the-only-api": {
              url: mcpUrl,
              type: "http",
              headers: { Authorization: `Bearer ${placeholderToken}` },
            },
          },
        },
        null,
        2,
      ),
    [mcpUrl],
  );
  const cursorJsonReal = useMemo(
    () =>
      JSON.stringify(
        {
          mcpServers: {
            "the-only-api": {
              url: mcpUrl,
              type: "http",
              headers: { Authorization: `Bearer ${apiKey}` },
            },
          },
        },
        null,
        2,
      ),
    [mcpUrl, apiKey],
  );

  const curlSnippet = `curl -i -X POST ${mcpUrl} \\
  -H "Authorization: Bearer ${placeholderToken}" \\
  -H "Content-Type: application/json" \\
  -H "Accept: application/json, text/event-stream" \\
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"smoke","version":"0"}}}'`;
  const curlSnippetReal = curlSnippet.replace(placeholderToken, apiKey || placeholderToken);

  // ChatGPT Desktop reads a JSON config very similar to Claude Desktop's.
  const chatgptDesktopJson = useMemo(
    () =>
      JSON.stringify(
        {
          mcpServers: {
            "the-only-api": {
              url: mcpUrl,
              transport: "http",
              headers: { Authorization: `Bearer ${placeholderToken}` },
            },
          },
        },
        null,
        2,
      ),
    [mcpUrl],
  );
  const chatgptDesktopJsonReal = useMemo(
    () =>
      JSON.stringify(
        {
          mcpServers: {
            "the-only-api": {
              url: mcpUrl,
              transport: "http",
              headers: { Authorization: `Bearer ${apiKey}` },
            },
          },
        },
        null,
        2,
      ),
    [mcpUrl, apiKey],
  );

  // ── Test connection ───────────────────────────────────────
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<
    | { ok: true; tool_count: number | null; server: { name?: string; version?: string } | null }
    | { ok: false; error: string }
    | null
  >(null);

  const runTest = useCallback(async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch("/api/mcp/test", { method: "POST" });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setTestResult({
          ok: false,
          error:
            (typeof data.detail === "string" && data.detail) ||
            data.error ||
            `MCP returned HTTP ${res.status}`,
        });
      } else {
        setTestResult({ ok: true, tool_count: data.tool_count, server: data.server });
      }
    } catch (e) {
      setTestResult({ ok: false, error: (e as Error).message });
    } finally {
      setTesting(false);
    }
  }, []);

  // ── Unsafe-proxy toggle ───────────────────────────────────
  const [unsafeProxy, setUnsafeProxy] = useState(false);
  const [unsafeProxyLoading, setUnsafeProxyLoading] = useState(false);
  const [unsafeProxyInitial, setUnsafeProxyInitial] = useState<boolean | null>(null);

  // Best-effort — pull current value once on mount via /api/whoami. If that
  // call fails (e.g. backend down) the toggle still works but starts at false.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/mcp/whoami");
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled) return;
        const val = !!data?.mcp_unsafe_proxy;
        setUnsafeProxy(val);
        setUnsafeProxyInitial(val);
      } catch {/* ignore */}
    })();
    return () => { cancelled = true; };
  }, []);

  const toggleUnsafeProxy = useCallback(
    async (next: boolean) => {
      if (!api) return;
      setUnsafeProxyLoading(true);
      try {
        await api.setMcpUnsafeProxy(next);
        setUnsafeProxy(next);
        setUnsafeProxyInitial(next);
        toast.success(
          next
            ? "Write proxy enabled — MCP can now make non-GET OF calls"
            : "Write proxy disabled — MCP can only make GET OF calls",
        );
      } catch (e) {
        toast.error((e as Error).message || "Failed to update flag");
      } finally {
        setUnsafeProxyLoading(false);
      }
    },
    [api],
  );

  return (
    // overflow-x-hidden on the root so an unbreakable string anywhere
    // (long token, JSON snippet, tool name) can't push the page wider than
    // the viewport. Each scroll-worthy child is given its own bounded
    // overflow-x-auto.
    <div className="space-y-6 overflow-x-hidden">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="heading-2 flex items-center gap-2">
            <PxZap className="h-5 w-5 text-[color:var(--theme-accent,#f54900)] shrink-0" />
            MCP Server
          </h1>
          <p className="text-sm text-default-500 mt-1 max-w-2xl">
            Connect Claude / Cursor / any MCP client to your CRM. The
            connector exposes every CRM endpoint as a tool the model can call
            — accounts, fans, inbox, earnings, tracking-link campaigns,
            usage, automations, webhooks. Authenticated with your existing
            API key.
          </p>
        </div>
        <Chip
          color="success"
          variant="flat"
          radius="none"
          className="font-mono text-[10px] uppercase tracking-wider shrink-0"
        >
          Hosted · v0.1
        </Chip>
      </div>

      {/* Credentials */}
      <GlassCard delay={0.05}>
        <GlassCardHeader className="!px-4 !py-3">
          <div className="flex items-center gap-2">
            <PxShield className="h-4 w-4 text-[color:var(--theme-accent,#f54900)]" />
            <h3 className="text-xs font-semibold uppercase tracking-wider">
              Connection
            </h3>
          </div>
        </GlassCardHeader>
        <GlassCardBody className="!p-4 space-y-4">
          {/* MCP URL */}
          <div>
            <div className="flex items-center gap-1.5 mb-1.5 text-default-500">
              <PxZap className="h-3 w-3" />
              <span className="text-[10px] uppercase tracking-wider">Server URL</span>
            </div>
            <div className="flex items-stretch gap-1.5">
              <div className="flex-1 min-w-0 bg-black/40 border border-white/[0.08] px-2.5 py-2 font-mono text-xs text-white/90 truncate">
                {mcpUrl}
              </div>
              <CopyButton value={mcpUrl} />
            </div>
          </div>

          {/* Bearer (same SecretField the Overview page uses) */}
          <SecretField label="API key (bearer)" value={apiKey} />

          {/* Test button */}
          <div className="flex flex-wrap items-center gap-3 pt-2 border-t border-white/[0.06]">
            <Tooltip
              content={apiKey ? "Probes the MCP server (no client setup needed yet)" : "Add your API key first — see /dashboard/api-keys"}
              placement="top"
              delay={300}
              classNames={{ content: "!rounded-none bg-[#0d0d0d] border border-white/[0.08] text-xs" }}
            >
              <span>
                <Button
                  size="sm"
                  variant="bordered"
                  radius="none"
                  className="border-white/[0.08] text-[10px] uppercase tracking-wider"
                  isLoading={testing}
                  isDisabled={!apiKey}
                  onPress={runTest}
                >
                  Test connection
                </Button>
              </span>
            </Tooltip>
            {testResult && testResult.ok && (
              <span className="text-[11px] text-green-400 font-mono break-words min-w-0">
                ✓ connected · {testResult.server?.name ?? "unknown"} v
                {testResult.server?.version ?? "?"} ·{" "}
                {testResult.tool_count ?? "?"} tools
              </span>
            )}
            {testResult && !testResult.ok && (
              <span className="text-[11px] text-red-400 font-mono break-words min-w-0">
                ✗ {testResult.error}
              </span>
            )}
          </div>
        </GlassCardBody>
      </GlassCard>

      {/* Setup snippets */}
      <GlassCard delay={0.1}>
        <GlassCardHeader className="!px-4 !py-3">
          <div className="flex items-center gap-2">
            <PxBookOpen className="h-4 w-4 text-[color:var(--theme-accent,#f54900)]" />
            <h3 className="text-xs font-semibold uppercase tracking-wider">
              Setup
            </h3>
          </div>
        </GlassCardHeader>
        <GlassCardBody className="!p-4">
          <Tabs
            aria-label="MCP setup snippets"
            variant="bordered"
            radius="none"
            classNames={{
              tabList: "bg-transparent border-white/[0.08]",
              cursor: "bg-[color:var(--theme-accent,#f54900)]/15",
              tab: "text-[11px] uppercase tracking-wider",
            }}
          >
            <Tab key="claude-desktop" title="Claude Desktop">
              <div className="space-y-3 pt-3">
                <p className="text-xs text-default-500">
                  Edit{" "}
                  <code className="bg-white/[0.06] px-1.5 py-0.5 text-[11px]">
                    claude_desktop_config.json
                  </code>
                  , add the block below, then restart Claude Desktop.
                </p>
                <ul className="text-[11px] text-default-500 space-y-0.5 pl-3 list-disc">
                  <li>
                    macOS:{" "}
                    <code className="bg-white/[0.06] px-1 py-0.5 text-[10px]">
                      ~/Library/Application Support/Claude/claude_desktop_config.json
                    </code>
                  </li>
                  <li>
                    Windows:{" "}
                    <code className="bg-white/[0.06] px-1 py-0.5 text-[10px]">
                      %APPDATA%\Claude\claude_desktop_config.json
                    </code>
                  </li>
                  <li>
                    Linux:{" "}
                    <code className="bg-white/[0.06] px-1 py-0.5 text-[10px]">
                      ~/.config/Claude/claude_desktop_config.json
                    </code>
                  </li>
                </ul>
                <CodeBlock copyValue={claudeDesktopJsonReal}>
                  {claudeDesktopJson}
                </CodeBlock>
                <p className="text-[11px] text-default-500">
                  The copy button copies the JSON with your real API key
                  inserted; the displayed text shows{" "}
                  <code className="text-[10px]">YOUR_API_KEY</code> for safety.
                </p>
              </div>
            </Tab>
            <Tab key="claude-ai" title="Claude.ai">
              <div className="space-y-3 pt-3 text-sm text-default-500">
                <p>
                  In Claude.ai, open <strong>Settings → Connectors → Add custom
                  connector</strong>. Paste:
                </p>
                <ul className="text-xs space-y-1 pl-4 list-disc">
                  <li>
                    <strong>Name:</strong> the-only-api
                  </li>
                  <li>
                    <strong>URL:</strong>{" "}
                    <code className="bg-white/[0.06] px-1 py-0.5">{mcpUrl}</code>
                  </li>
                  <li>
                    <strong>Auth:</strong> Bearer — paste your token
                  </li>
                </ul>
                <p className="text-xs">
                  Claude.ai will exchange a few requests to validate the
                  server, then list every tool in the connector picker.
                </p>
              </div>
            </Tab>
            <Tab key="cursor" title="Cursor">
              <div className="space-y-3 pt-3">
                <p className="text-xs text-default-500">
                  Add to{" "}
                  <code className="bg-white/[0.06] px-1.5 py-0.5 text-[11px]">
                    ~/.cursor/mcp.json
                  </code>{" "}
                  (create if missing), then restart Cursor.
                </p>
                <CodeBlock copyValue={cursorJsonReal}>{cursorJson}</CodeBlock>
              </div>
            </Tab>
            <Tab key="chatgpt" title="ChatGPT">
              <div className="space-y-4 pt-3">
                <div className="border border-amber-500/30 bg-amber-500/[0.04] px-2.5 py-2 text-[11px] text-amber-300/90">
                  ChatGPT's MCP support is newer than Claude's. Pick the
                  path that matches your account type.
                </div>

                {/* Path 1: ChatGPT.com custom connector — Business/Enterprise/Edu */}
                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-[10px] uppercase tracking-wider text-default-500">
                    <span className="text-white font-semibold">A.</span>
                    <span>ChatGPT.com — Business / Enterprise / Edu (recommended)</span>
                  </div>
                  <ol className="text-xs space-y-1 pl-4 list-decimal text-white/85">
                    <li>
                      Open <strong>Settings → Connectors</strong> in ChatGPT.com.
                    </li>
                    <li>
                      Click <strong>Add custom connector</strong>.
                    </li>
                    <li>
                      Paste:
                      <ul className="pl-4 list-disc text-default-500 mt-1 space-y-0.5">
                        <li>
                          <strong>Name:</strong> the-only-api
                        </li>
                        <li>
                          <strong>Server URL:</strong>{" "}
                          <code className="bg-white/[0.06] px-1 py-0.5 text-[10px]">{mcpUrl}</code>
                        </li>
                        <li>
                          <strong>Auth:</strong> Bearer — paste your API key
                        </li>
                      </ul>
                    </li>
                    <li>
                      Enable the connector. The 59 tools appear in the model
                      picker after the first message.
                    </li>
                  </ol>
                  <p className="text-[11px] text-default-500">
                    Custom Connectors are gated to Business / Enterprise /
                    Edu plans. Plus and Free users — use option B or C.
                  </p>
                </div>

                {/* Path 2: ChatGPT Desktop config */}
                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-[10px] uppercase tracking-wider text-default-500">
                    <span className="text-white font-semibold">B.</span>
                    <span>ChatGPT Desktop app</span>
                  </div>
                  <p className="text-xs text-default-500">
                    The desktop app reads a JSON config similar to Claude
                    Desktop's. Open <strong>Settings → MCP servers → Edit
                    config</strong> and add:
                  </p>
                  <CodeBlock copyValue={chatgptDesktopJsonReal}>
                    {chatgptDesktopJson}
                  </CodeBlock>
                  <p className="text-[11px] text-default-500">
                    Restart ChatGPT Desktop. If the MCP toggle doesn't appear,
                    your build is older than the rollout — update from the
                    app's update channel and retry.
                  </p>
                </div>

                {/* Path 3: Devs using the OpenAI Agents SDK / Responses API */}
                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-[10px] uppercase tracking-wider text-default-500">
                    <span className="text-white font-semibold">C.</span>
                    <span>Developers — OpenAI Agents SDK / Responses API</span>
                  </div>
                  <p className="text-xs text-default-500">
                    For code, pass this MCP server as a tool source. The
                    Responses API and Agents SDK accept remote MCP servers
                    via the same Streamable HTTP URL + bearer.
                  </p>
                  <CodeBlock copyValue={`tools=[{"type":"mcp","server_url":"${mcpUrl}","server_label":"the-only-api","authorization":"Bearer ${apiKey || "YOUR_API_KEY"}"}]`}>
{`# Python — openai SDK
from openai import OpenAI
client = OpenAI()

resp = client.responses.create(
    model="gpt-5",
    input="List my top 10 spenders.",
    tools=[{
        "type": "mcp",
        "server_url": "${mcpUrl}",
        "server_label": "the-only-api",
        "authorization": "Bearer YOUR_API_KEY",
    }],
)
print(resp.output_text)`}
                  </CodeBlock>
                  <p className="text-[11px] text-default-500">
                    Custom GPTs with Actions are not recommended — MCP's
                    JSON-RPC over Streamable HTTP doesn't map cleanly to
                    OpenAPI without a wrapper, and tool latency suffers.
                  </p>
                </div>
              </div>
            </Tab>
            <Tab key="curl" title="Generic / curl">
              <div className="space-y-3 pt-3">
                <p className="text-xs text-default-500">
                  Smoke-test the connection from any terminal. Replace{" "}
                  <code>YOUR_API_KEY</code> before running, or use the copy
                  button (it substitutes your real token):
                </p>
                <CodeBlock copyValue={curlSnippetReal}>{curlSnippet}</CodeBlock>
                <p className="text-[11px] text-default-500">
                  A 200 response with a{" "}
                  <code className="text-[10px]">Mcp-Session-Id</code> header
                  means the handshake succeeded.
                </p>
              </div>
            </Tab>
          </Tabs>
        </GlassCardBody>
      </GlassCard>

      {/* Example prompts — what you can ask once connected */}
      <GlassCard delay={0.13}>
        <GlassCardHeader className="!px-4 !py-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <PxPlay className="h-4 w-4 text-[color:var(--theme-accent,#f54900)]" />
              <h3 className="text-xs font-semibold uppercase tracking-wider">
                What you can ask
              </h3>
            </div>
            <span className="text-[10px] text-default-500 uppercase tracking-wider">
              Copy → paste into Claude / Cursor
            </span>
          </div>
        </GlassCardHeader>
        <GlassCardBody className="!p-4 space-y-4">
          <p className="text-xs text-default-500">
            Concrete starter prompts. Each one drives a real workflow — the
            model picks the right tools on its own and asks before doing any
            writes.
          </p>

          {/* 4-step starter walkthrough — for first-time connections */}
          <div className="border border-[color:var(--theme-accent,#f54900)]/30 bg-[color:var(--theme-accent,#f54900)]/[0.04] p-3 space-y-2">
            <div className="flex items-center justify-between">
              <div className="text-[10px] uppercase tracking-wider text-[color:var(--theme-accent,#f54900)] font-semibold">
                First time? Run these in order
              </div>
              <span className="text-[9px] uppercase tracking-wider text-default-500">
                ≈ 5 min
              </span>
            </div>
            <ol className="space-y-1.5 text-xs text-white/85 [&>li]:!list-none">
              {STARTER_WALKTHROUGH.map((p, i) => (
                <PromptRow key={p} text={p} step={i + 1} />
              ))}
            </ol>
          </div>

          {EXAMPLE_PROMPTS.map((group) => (
            <div key={group.title} className="space-y-2">
              <div className="flex items-center gap-2 text-[10px] uppercase tracking-wider text-default-500">
                <span>{group.title}</span>
                <span className="h-px flex-1 bg-white/[0.06]" />
              </div>
              <ul className="space-y-1.5">
                {group.prompts.map((p) => (
                  <PromptRow key={p} text={p} />
                ))}
              </ul>
            </div>
          ))}
          <p className="text-[11px] text-default-500 pt-2 border-t border-white/[0.06]">
            <strong className="text-white">Write actions stay gated.</strong>{" "}
            Tools that send DMs, create webhooks, request payouts, or delete
            anything require an explicit <code>confirm=true</code> from the
            model — you'll always see what it's about to do before it does.
          </p>
          <div className="text-[11px] text-default-500 pt-2 border-t border-white/[0.06] space-y-1">
            <div className="text-white font-semibold text-[10px] uppercase tracking-wider">
              Known limitations
            </div>
            <ul className="space-y-0.5 list-disc list-inside">
              <li>
                "<em>Delete a tracking-link campaign</em>" — OnlyFans doesn't
                expose a delete endpoint, so there's no MCP path either.
              </li>
              <li>
                "<em>Average price of PPVs I send</em>" — paid PPVs are
                tracked exactly; sent PPVs are sampled by{" "}
                <code>of_get_ppv_stats</code>. Treat the sent count as a
                lower bound.
              </li>
            </ul>
          </div>
        </GlassCardBody>
      </GlassCard>

      {/* Build your own agent — distilled from test/simulations/README.md */}
      <GlassCard delay={0.14}>
        <GlassCardHeader className="!px-4 !py-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <PxCode2 className="h-4 w-4 text-[color:var(--theme-accent,#f54900)]" />
              <h3 className="text-xs font-semibold uppercase tracking-wider">
                Build your own agent on this MCP
              </h3>
            </div>
            <span className="text-[10px] text-default-500 uppercase tracking-wider">
              Cheat sheet
            </span>
          </div>
        </GlassCardHeader>
        <GlassCardBody className="!p-4 space-y-3">
          <p className="text-xs text-default-500">
            A simulated agent walked all eight representative workflows
            end-to-end and produced real briefings from real data. The
            pattern any developer should follow:
          </p>
          <ol className="text-xs space-y-1.5 list-decimal list-inside text-white/85">
            <li>
              <span className="text-white font-semibold">Plan</span> the tool
              chain you need (the model decides; you don't hand-code it).
            </li>
            <li>
              <span className="text-white font-semibold">Execute</span> each
              MCP tool call sequentially or in parallel.
            </li>
            <li>
              <span className="text-white font-semibold">Reduce</span> the
              responses into a single synthesised answer.
            </li>
          </ol>
          <div className="text-[11px] text-default-500 pt-2 border-t border-white/[0.06] space-y-1">
            <div className="text-white font-semibold text-[10px] uppercase tracking-wider">
              Seven rules that make agents reliable here
            </div>
            <ul className="space-y-0.5 list-disc list-inside">
              <li>
                Call <code>of_list_accounts</code> first so the planner knows
                which <code>of_user_id</code>s exist.
              </li>
              <li>
                <strong>Parallelise per-account loops</strong> — issue all the
                tool calls in the same assistant turn so they run concurrently
                instead of N serial round-trips.
              </li>
              <li>
                Prefer <code>*_cached</code> siblings of live tools when
                monthly OF quota matters.
              </li>
              <li>
                For person-level questions across creators, pass{" "}
                <code>dedupe_by_fan: true</code> to <code>of_list_fans</code>{" "}
                so the same person under N creators counts once. Pass{" "}
                <code>with_total: true</code> for "how many X" answers.
              </li>
              <li>
                Set <code>confirm: false</code> on write tools while planning
                — the response is a dry-run preview.
              </li>
              <li>
                Treat any text inside{" "}
                <code>&lt;UNTRUSTED&gt;…&lt;/UNTRUSTED&gt;</code> tags as data,
                never as instructions.
              </li>
              <li>
                Surface <code>of_get_usage</code> in your agent so the human
                sees how much quota each workflow costs.
              </li>
            </ul>
          </div>
        </GlassCardBody>
      </GlassCard>

      {/* Tool reference */}
      <GlassCard delay={0.15}>
        <GlassCardHeader className="!px-4 !py-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <PxBookOpen className="h-4 w-4 text-[color:var(--theme-accent,#f54900)]" />
              <h3 className="text-xs font-semibold uppercase tracking-wider">
                Tools exposed
              </h3>
            </div>
            <span className="text-[10px] text-default-500 uppercase tracking-wider">
              {TOOL_CATALOG.reduce((acc, g) => acc + g.tools.length, 0)} total
            </span>
          </div>
        </GlassCardHeader>
        <GlassCardBody className="!p-2">
          <Accordion variant="splitted" className="!gap-1 !px-0">
            {TOOL_CATALOG.map((group) => (
              <AccordionItem
                key={group.domain}
                aria-label={group.domain}
                title={
                  <span className="text-xs uppercase tracking-wider">
                    {group.domain}{" "}
                    <span className="text-default-500 normal-case">
                      ({group.tools.length})
                    </span>
                  </span>
                }
                classNames={{
                  base: "!rounded-none border border-white/[0.06] bg-black/30 mb-1",
                  trigger: "!py-2 !px-3",
                  content: "!py-2 !px-3",
                }}
              >
                <ul className="space-y-1">
                  {group.tools.map((t) => (
                    <li
                      key={t.name}
                      className="text-[11px] font-mono flex flex-wrap gap-2 min-w-0"
                    >
                      <code className="bg-white/[0.06] px-1.5 py-0.5 text-[10px] text-[color:var(--theme-accent,#f54900)] break-all">
                        {t.name}
                      </code>
                      <span className="text-default-500 break-words min-w-0 flex-1">
                        {t.description}
                      </span>
                    </li>
                  ))}
                </ul>
              </AccordionItem>
            ))}
          </Accordion>
        </GlassCardBody>
      </GlassCard>

      {/* Advanced — danger zone */}
      <GlassCard delay={0.2}>
        <GlassCardHeader className="!px-4 !py-3">
          <div className="flex items-center gap-2">
            <PxShield className="h-4 w-4 text-red-400" />
            <h3 className="text-xs font-semibold uppercase tracking-wider text-red-400">
              Advanced — danger zone
            </h3>
          </div>
        </GlassCardHeader>
        <GlassCardBody className="!p-4 space-y-3">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex-1 min-w-0">
              <h4 className="text-sm font-semibold">
                Allow MCP write proxy (non-GET OnlyFans calls)
              </h4>
              <p className="text-xs text-default-500 mt-1">
                By default <code>of_proxy_request</code> is GET-only. Enabling
                this lets the model issue arbitrary <strong className="text-red-400">POST / PATCH /
                DELETE</strong> calls to <code>/api2/v2</code> on your behalf —
                including ones that can <strong>send mass DMs, modify your
                profile, or delete subscribers</strong>. The setting is global
                (every MCP conversation can write) and the change is logged in
                <code> mcp_audit</code>. Disable immediately if you notice
                unexpected activity, and audit recent calls.
              </p>
            </div>
            <Switch
              isSelected={unsafeProxy}
              isDisabled={unsafeProxyLoading || unsafeProxyInitial === null && !apiKey}
              onValueChange={toggleUnsafeProxy}
              size="sm"
              color="warning"
            />
          </div>
        </GlassCardBody>
      </GlassCard>

      {/* Security note */}
      <GlassCard delay={0.25}>
        <GlassCardBody className="!p-4 space-y-2 text-xs text-default-500">
          <p>
            <strong className="text-white">Your bearer token is your API key.</strong>{" "}
            Anyone with it has full CRM access. Rotate it from{" "}
            <Link
              href="/dashboard/api-keys"
              className="text-[color:var(--theme-accent,#f54900)] hover:underline"
            >
              API Keys
            </Link>{" "}
            if it ever leaks — the MCP server's auth cache invalidates within
            5 minutes worst case.
          </p>
          <p>
            Every tool call is rate-limited and audit-logged. Admin endpoints
            (<code>/api/admin/*</code>, <code>/internal/*</code>) are never
            reachable through MCP. Write tools (
            <code>of_send_message</code>, payouts, deletes) require an
            explicit <code>confirm=true</code> argument.
          </p>
          <p>
            Tool outputs that contain user-controlled strings (usernames, bios,
            message text) are wrapped in <code>&lt;UNTRUSTED&gt;…&lt;/UNTRUSTED&gt;</code>{" "}
            markers so the model treats them as data, not as instructions.
          </p>
          <div className="hidden">{crmId /* satisfy unused warning */}</div>
        </GlassCardBody>
      </GlassCard>
    </div>
  );
}
