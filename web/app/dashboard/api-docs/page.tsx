"use client";

import { useState, useMemo } from "react";
import { useSession } from "next-auth/react";
import { Card, CardBody, CardHeader } from "@heroui/card";
import { Button } from "@heroui/button";
import { Input } from "@heroui/input";
import { Select, SelectItem } from "@heroui/select";
import { Chip } from "@heroui/chip";
import { Textarea } from "@heroui/input";
import { PxBookOpen, PxPlay, PxCopy, PxCheck, PxChevronDown, PxChevronUp, PxCode2, PxKey } from "@/components/ui/PixelIcons";
import Link from "next/link";
import { useApiClient } from "@/lib/hooks/use-api-client";
import { useAccounts } from "@/lib/hooks/use-selected-account";
import { useApiKey } from "@/lib/hooks/use-api-key";
import { platformLabel } from "@/lib/platform-capabilities";
import { ApiError, isPlatformNotSupported, platformUnsupportedMessage } from "@/lib/api-client";
import { reversedOfEndpoints } from "./reversedOfEndpoints";

// ── CRM API Endpoints (our backend) ────────────────────────
const crmEndpoints = [
  // ── Accounts ──
  {
    method: "GET",
    path: "/accounts",
    description: "List all connected accounts (OF + Fansly). Add ?include_session=true to get sess & auth_id cookies.",
    category: "Accounts",
    isCrm: true,
    query: "?include_session=true",
  },
  {
    method: "POST",
    path: "/accounts/login",
    description: "Login a creator account (email/password, supports 2FA). Proxy can be http:// or socks5://",
    category: "Accounts",
    isCrm: true,
    body: '{"email": "user@example.com", "password": "pass", "use_captcha": true, "proxy": "http://user:pass@host:port"}',
  },
  {
    method: "POST",
    path: "/accounts/login/cookies",
    description: "Connect using existing session cookies (sess, auth_id, fp)",
    category: "Accounts",
    isCrm: true,
    body: '{"sess": "session_cookie_value", "auth_id": "12345678", "fp": "fingerprint_cookie"}',
  },
  {
    method: "POST",
    path: "/accounts/login/verify-otp",
    description: "Verify OTP code for 2FA login",
    category: "Accounts",
    isCrm: true,
    body: '{"email": "user@example.com", "otp_code": "123456"}',
  },
  {
    method: "DELETE",
    path: "/accounts/{of_user_id}",
    description: "Disconnect/remove an account from this panel",
    category: "Accounts",
    isCrm: true,
  },
  // ── Notifications ──
  {
    method: "GET",
    path: "/accounts/{of_user_id}/notifications",
    description: "Fetch notifications for an account",
    category: "Notifications",
    isCrm: true,
    query: "?limit=20",
  },
  // ── Earnings ──
  {
    method: "GET",
    path: "/accounts/{of_user_id}/balances",
    description: "Get payout balance information",
    category: "Earnings",
    isCrm: true,
  },
  {
    method: "GET",
    path: "/accounts/{of_user_id}/earnings",
    description: "Earnings chart data for a date range",
    category: "Earnings",
    isCrm: true,
    query: "?startDate=2026-01-01%2000:00:00&endDate=2026-12-31%2023:59:59&withTotal=true",
  },
  {
    method: "GET",
    path: "/earnings/summary",
    description: "Aggregated earnings across all accounts",
    category: "Earnings",
    isCrm: true,
    query: "?period=week",
  },
  // ── Subscribers ──
  {
    method: "GET",
    path: "/accounts/{of_user_id}/subscribers",
    description: "Live subscriber list with spend data",
    category: "Subscribers",
    isCrm: true,
    query: "?limit=10&offset=0&type=all",
  },
  {
    method: "GET",
    path: "/accounts/{of_user_id}/subscribers/cached",
    description: "Local cached subscribers (no OF call)",
    category: "Subscribers",
    isCrm: true,
  },
  {
    method: "GET",
    path: "/accounts/{of_user_id}/subscribers/new",
    description: "Newest subscriptions with timestamps",
    category: "Subscribers",
    isCrm: true,
  },
  {
    method: "GET",
    path: "/accounts/{of_user_id}/subscribers/stats",
    description: "Time-bucketed subscription counts",
    category: "Subscribers",
    isCrm: true,
  },
  {
    method: "POST",
    path: "/accounts/{of_user_id}/subscribers/refresh",
    description: "Kick off async subscriber cache refresh",
    category: "Subscribers",
    isCrm: true,
  },
  {
    method: "GET",
    path: "/accounts/{of_user_id}/subscribers/refresh/status",
    description: "Subscriber refresh job status",
    category: "Subscribers",
    isCrm: true,
  },
  // ── Transactions ──
  {
    method: "GET",
    path: "/accounts/{of_user_id}/purchases",
    description: "Purchase/tip transactions with pagination",
    category: "Transactions",
    isCrm: true,
    query: "?startDate=2026-01-01%2000:00:00&limit=50",
  },
  {
    method: "GET",
    path: "/accounts/{of_user_id}/transactions/cached",
    description: "Local cached transactions (no OF call)",
    category: "Transactions",
    isCrm: true,
  },
  {
    method: "POST",
    path: "/accounts/{of_user_id}/transactions/refresh",
    description: "Kick off async transaction cache refresh",
    category: "Transactions",
    isCrm: true,
  },
  {
    method: "GET",
    path: "/accounts/{of_user_id}/transactions/refresh/status",
    description: "Transaction refresh job status",
    category: "Transactions",
    isCrm: true,
  },
  {
    method: "POST",
    path: "/accounts/{of_user_id}/backfill",
    description: "One-shot backfill of last N days of transactions + subscribers",
    category: "Transactions",
    isCrm: true,
    body: '{"days": 30}',
  },
  {
    method: "GET",
    path: "/accounts/{of_user_id}/ppv-stats",
    description: "PPV conversion rate stats",
    category: "Transactions",
    isCrm: true,
  },
  // ── Settings ──
  {
    method: "GET",
    path: "/accounts/{of_user_id}/subscription-price",
    description: "Read current subscription price",
    category: "Settings",
    isCrm: true,
  },
  {
    method: "PATCH",
    path: "/accounts/{of_user_id}/subscription-price",
    description: "Update subscription price for an account",
    category: "Settings",
    isCrm: true,
    body: '{"subscribePrice": 9.99}',
  },
  {
    method: "GET",
    path: "/accounts/{of_user_id}/proxy",
    description: "Get current proxy for an account",
    category: "Settings",
    isCrm: true,
  },
  {
    method: "PATCH",
    path: "/accounts/{of_user_id}/proxy",
    description: "Update or remove proxy (http:// or socks5:// URLs)",
    category: "Settings",
    isCrm: true,
    body: '{"proxy": "socks5://user:pass@host:port"}',
  },
  {
    method: "GET",
    path: "/accounts/{of_user_id}/polling",
    description: "Get polling config for an account",
    category: "Settings",
    isCrm: true,
  },
  {
    method: "PATCH",
    path: "/accounts/{of_user_id}/polling",
    description: "Enable/disable event polling and set interval",
    category: "Settings",
    isCrm: true,
    body: '{"polling_enabled": true, "polling_interval_seconds": 120}',
  },
  // ── Payouts ──
  {
    method: "GET",
    path: "/accounts/{of_user_id}/payout-account",
    description: "Payout account status, check-receive, and balances",
    category: "Payouts",
    isCrm: true,
  },
  {
    method: "GET",
    path: "/accounts/{of_user_id}/payout-requests",
    description: "Withdrawal request history",
    category: "Payouts",
    isCrm: true,
  },
  {
    method: "POST",
    path: "/accounts/{of_user_id}/payout-requests",
    description: "Create a withdrawal request",
    category: "Payouts",
    isCrm: true,
    body: '{"withdrawal_amount": 100.00}',
  },
  // ── Referrals (OnlyFans only — Fansly gets 501 platform_not_supported) ──
  {
    method: "GET",
    path: "/accounts/{of_user_id}/referrals",
    description: "List the users this account referred",
    category: "Referrals",
    isCrm: true,
  },
  {
    method: "GET",
    path: "/accounts/{of_user_id}/referrals/earnings",
    description: "Referral balance + chart (raw upstream bodies)",
    category: "Referrals",
    isCrm: true,
  },
  {
    method: "GET",
    path: "/accounts/{of_user_id}/referrals/payout-requests",
    description: "Referral payout history",
    category: "Referrals",
    isCrm: true,
  },
  // ── Chats ──
  {
    method: "GET",
    path: "/accounts/{of_user_id}/chats",
    description: "List conversations with pagination",
    category: "Chats",
    isCrm: true,
    query: "?limit=20&order=recent&offset=0",
  },
  {
    method: "POST",
    path: "/accounts/{of_user_id}/messages/mass",
    description: "Mass DM to audience with optional media and pricing",
    category: "Chats",
    isCrm: true,
    body: '{"text": "Hey {name}", "mediaFiles": [123], "price": 0}',
  },
  // ── Campaigns ──
  {
    method: "GET",
    path: "/accounts/{of_user_id}/campaigns",
    description: "List tracking link campaigns with stats",
    category: "Campaigns",
    isCrm: true,
    query: "?limit=10&offset=0",
  },
  {
    method: "POST",
    path: "/accounts/{of_user_id}/campaigns",
    description: "Create a new tracking link campaign",
    category: "Campaigns",
    isCrm: true,
    body: '{"name": "My Campaign"}',
  },
  {
    method: "GET",
    path: "/accounts/{of_user_id}/campaigns/{campaign_id}/claimers",
    description: "Campaign converters / subscribers who claimed",
    category: "Campaigns",
    isCrm: true,
    query: "?limit=10&offset=0",
  },
  {
    method: "GET",
    path: "/accounts/{of_user_id}/campaigns/earnings",
    description: "Per-campaign earnings breakdown",
    category: "Campaigns",
    isCrm: true,
  },
  {
    method: "POST",
    path: "/accounts/{of_user_id}/campaigns/refresh",
    description: "Async refresh of campaign claimers",
    category: "Campaigns",
    isCrm: true,
  },
  {
    method: "GET",
    path: "/accounts/{of_user_id}/campaigns/refresh/status",
    description: "Campaign refresh job status",
    category: "Campaigns",
    isCrm: true,
  },
  {
    method: "GET",
    path: "/accounts/{of_user_id}/campaign-tags",
    description: "All tags across campaigns",
    category: "Campaigns",
    isCrm: true,
  },
  {
    method: "POST",
    path: "/accounts/{of_user_id}/campaigns/{campaign_id}/tags",
    description: "Add tag to a campaign",
    category: "Campaigns",
    isCrm: true,
    body: '{"tag": "winter-promo"}',
  },
  {
    method: "DELETE",
    path: "/accounts/{of_user_id}/campaigns/{campaign_id}/tags/{tag}",
    description: "Remove tag from a campaign",
    category: "Campaigns",
    isCrm: true,
  },
  // ── Export ──
  {
    method: "POST",
    path: "/accounts/{of_user_id}/exports",
    description: "Start async data export (messages, transactions, subscribers)",
    category: "Export",
    isCrm: true,
    body: '{"types": ["messages", "transactions", "subscribers"], "startDate": "2026-01-01", "endDate": "2026-07-20"}',
  },
  {
    method: "GET",
    path: "/accounts/{of_user_id}/exports",
    description: "List export jobs",
    category: "Export",
    isCrm: true,
  },
  {
    method: "GET",
    path: "/accounts/{of_user_id}/exports/{job_id}",
    description: "Single export job status",
    category: "Export",
    isCrm: true,
  },
  {
    method: "GET",
    path: "/accounts/{of_user_id}/exports/{job_id}/download",
    description: "Download export ZIP file",
    category: "Export",
    isCrm: true,
  },
  {
    method: "DELETE",
    path: "/accounts/{of_user_id}/exports/{job_id}",
    description: "Delete an export job",
    category: "Export",
    isCrm: true,
  },
  {
    method: "POST",
    path: "/accounts/{of_user_id}/exports/{job_id}/cancel",
    description: "Cancel a running export job",
    category: "Export",
    isCrm: true,
  },
  // ── Events ──
  {
    method: "GET",
    path: "/events",
    description: "Event log with pagination",
    category: "Events",
    isCrm: true,
    query: "?limit=50&offset=0",
  },
  {
    method: "GET",
    path: "/events/stream",
    description: "Server-Sent Events stream (real-time)",
    category: "Events",
    isCrm: true,
  },
  // ── Fans ──
  {
    method: "GET",
    path: "/fans",
    description: "CRM fan list with spend and engagement data",
    category: "Fans",
    isCrm: true,
    query: "?limit=50&offset=0&sort=total_spend",
  },
  {
    method: "POST",
    path: "/fans/{fan_of_user_id}/tags",
    description: "Tag a fan",
    category: "Fans",
    isCrm: true,
    body: '{"tag": "vip"}',
  },
  {
    method: "DELETE",
    path: "/fans/{fan_of_user_id}/tags/{tag}",
    description: "Remove tag from a fan",
    category: "Fans",
    isCrm: true,
  },
  {
    method: "PUT",
    path: "/fans/{fan_of_user_id}/note",
    description: "Set fan note",
    category: "Fans",
    isCrm: true,
    body: '{"note": "High spender"}',
  },
  // ── Webhooks ──
  {
    method: "GET",
    path: "/webhooks",
    description: "List all webhooks",
    category: "Webhooks",
    isCrm: true,
  },
  {
    method: "POST",
    path: "/webhooks",
    description: "Create a new webhook",
    category: "Webhooks",
    isCrm: true,
    body: '{"url": "https://example.com/hook", "secret": "my_secret", "event_types": ["new_tip", "new_subscriber"]}',
  },
  {
    method: "GET",
    path: "/webhooks/{webhook_id}",
    description: "Get single webhook details",
    category: "Webhooks",
    isCrm: true,
  },
  {
    method: "PATCH",
    path: "/webhooks/{webhook_id}",
    description: "Update a webhook",
    category: "Webhooks",
    isCrm: true,
    body: '{"event_types": ["*"], "is_active": true}',
  },
  {
    method: "DELETE",
    path: "/webhooks/{webhook_id}",
    description: "Delete a webhook",
    category: "Webhooks",
    isCrm: true,
  },
  {
    method: "POST",
    path: "/webhooks/{webhook_id}/test",
    description: "Send test delivery to a webhook",
    category: "Webhooks",
    isCrm: true,
  },
  {
    method: "GET",
    path: "/webhooks/{webhook_id}/deliveries",
    description: "Delivery history with retry status",
    category: "Webhooks",
    isCrm: true,
  },
  // ── Automations ──
  {
    method: "GET",
    path: "/automations",
    description: "List all automations",
    category: "Automations",
    isCrm: true,
  },
  {
    method: "POST",
    path: "/automations",
    description: "Create a new automation rule",
    category: "Automations",
    isCrm: true,
    body: '{"name": "Tip thank-you", "trigger_event": "new_tip", "conditions": [{"field": "payload.amount", "op": "gte", "value": "5"}], "action_type": "send_dm", "action_params": {"text": "Thanks for the tip, {payload.fan.username}!"}}',
  },
  {
    method: "GET",
    path: "/automations/{automation_id}",
    description: "Get single automation details",
    category: "Automations",
    isCrm: true,
  },
  {
    method: "PATCH",
    path: "/automations/{automation_id}",
    description: "Update an automation",
    category: "Automations",
    isCrm: true,
  },
  {
    method: "DELETE",
    path: "/automations/{automation_id}",
    description: "Delete an automation",
    category: "Automations",
    isCrm: true,
  },
  {
    method: "POST",
    path: "/automations/{automation_id}/run-now",
    description: "Run automation with a sample event",
    category: "Automations",
    isCrm: true,
  },
  {
    method: "GET",
    path: "/automations/{automation_id}/runs",
    description: "Automation run history",
    category: "Automations",
    isCrm: true,
  },
  // ── API Keys ──
  {
    method: "GET",
    path: "/api-keys",
    description: "List all API keys (active + revoked) with usage stats",
    category: "API Keys",
    isCrm: true,
  },
  {
    method: "POST",
    path: "/api-keys",
    description: "Create a secondary API key",
    category: "API Keys",
    isCrm: true,
    body: '{"label": "MCP Server"}',
  },
  {
    method: "DELETE",
    path: "/api-keys/{key_id}",
    description: "Revoke a secondary API key",
    category: "API Keys",
    isCrm: true,
  },
  {
    method: "GET",
    path: "/api-keys/{key_id}/usage",
    description: "Per-key usage detail (30/90d series + totals)",
    category: "API Keys",
    isCrm: true,
  },
  // ── Proxy ──
  {
    method: "POST",
    path: "/proxy/test",
    description: "Test a proxy URL for connectivity",
    category: "Proxy",
    isCrm: true,
    body: '{"proxy": "socks5://user:pass@host:port"}',
  },
  {
    method: "POST",
    path: "/accounts/{of_user_id}/request",
    description: "Generic OF API proxy — send any authenticated request to the OF API",
    category: "Proxy",
    isCrm: true,
    body: '{"path": "/api2/v2/users/me", "method": "GET"}',
  },
  // ── Utility ──
  {
    method: "POST",
    path: "/rotate-key",
    description: "Regenerate primary API key",
    category: "API Keys",
    isCrm: true,
  },
  {
    method: "GET",
    path: "/usage",
    description: "Panel-wide API usage stats",
    category: "API Keys",
    isCrm: true,
  },
  {
    method: "GET",
    path: "/refresh/active",
    description: "All in-flight refresh jobs for this panel",
    category: "Subscribers",
    isCrm: true,
  },
];

// ── OF API Endpoints (via proxy) ───────────────────────────
const ofEndpoints = [
  {
    method: "GET",
    path: "/api2/v2/users/me",
    description: "Get current user profile information",
    category: "User",
  },
  {
    method: "GET",
    path: "/api2/v2/users/notifications?limit=20&skip_users=all&format=infinite",
    description: "Fetch user notifications",
    category: "Notifications",
  },
  {
    method: "GET",
    path: "/api2/v2/payouts/balances",
    description: "Get payout balance information",
    category: "Earnings",
  },
  {
    method: "GET",
    path: "/api2/v2/earnings/chart?startDate=2025-01-01%2000%3A00%3A00&withTotal=true",
    description: "Fetch earnings chart data",
    category: "Earnings",
  },
  {
    method: "GET",
    path: "/api2/v2/payouts/transactions?startDate=2025-01-01%2000%3A00%3A00&limit=50",
    description: "Fetch payout/purchase transactions",
    category: "Transactions",
  },
  {
    method: "POST",
    path: "/api2/v2/payouts/requests",
    description: "Create a payout/withdrawal request",
    category: "Payouts",
    body: '{"withdrawalAmount": 100.00}',
  },
  {
    method: "GET",
    path: "/api2/v2/subscriptions/subscribers?limit=10&offset=0&type=all&format=infinite&filter[total_spent]=1&more=true",
    description: "List subscribers with total spent data",
    category: "Subscribers",
  },
  {
    method: "GET",
    path: "/api2/v2/subscriptions/subscribers/count",
    description: "Get total subscriber count",
    category: "Subscribers",
  },
  {
    method: "GET",
    path: "/api2/v2/campaigns?limit=10&offset=0&pagination=1&stats=true",
    description: "List tracking link campaigns with statistics",
    category: "Campaigns",
  },
  {
    method: "POST",
    path: "/api2/v2/campaigns",
    description: "Create a new tracking link campaign",
    category: "Campaigns",
    body: '{"name": "My Campaign"}',
  },
  {
    method: "GET",
    path: "/api2/v2/campaigns/{campaign_id}/subscribers?limit=10&offset=0",
    description: "Get campaign claimers / conversions",
    category: "Campaigns",
  },
  {
    method: "PUT",
    path: "/api2/v2/users/me",
    description: "Update user profile (subscription price, etc.)",
    category: "User",
    body: '{"subscribe": {"subscribePrice": 9.99}}',
  },
  {
    method: "GET",
    path: "/api2/v2/chats?limit=10&offset=0&order=recent",
    description: "List recent chats",
    category: "Messaging",
  },
  {
    method: "GET",
    path: "/api2/v2/chats/{user_id}/messages?limit=20&order=desc",
    description: "Get messages from a specific chat",
    category: "Messaging",
  },
  {
    method: "POST",
    path: "/api2/v2/chats/{user_id}/messages",
    description: "Send a message to a user",
    category: "Messaging",
    body: '{"text": "Hello!"}',
  },
  {
    method: "GET",
    path: "/api2/v2/users/{user_id}",
    description: "Get a specific user's public profile",
    category: "User",
  },
  {
    method: "GET",
    path: "/api2/v2/lists?limit=10&offset=0",
    description: "Get user lists (bookmarks, fans, etc.)",
    category: "Lists",
  },
  {
    method: "GET",
    path: "/api2/v2/posts?limit=10&offset=0&format=infinite",
    description: "Get user posts / feed",
    category: "Content",
  },
  {
    method: "GET",
    path: "/api2/v2/vault/lists?view=main&limit=10&offset=0",
    description: "Get vault (media library) lists — view=main is required",
    category: "Content",
  },
  {
    method: "GET",
    path: "/api2/v2/vault/media?limit=24&offset=0&field=recent&sort=desc",
    description: "Get vault media items (filter by folder with &list={list_id})",
    category: "Content",
  },
  {
    method: "GET",
    path: "/api2/v2/posts/{post_id}?skip_users=all",
    description: "Get a specific post by ID",
    category: "Content",
  },
  {
    method: "GET",
    path: "/api2/v2/posts/{post_id}/comments?limit=10&offset=0",
    description: "Get comments on a post",
    category: "Content",
  },
  {
    method: "POST",
    path: "/api2/v2/posts/{post_id}/favorites",
    description: "Like / favorite a post",
    category: "Content",
  },
  {
    method: "GET",
    path: "/api2/v2/posts/bookmarks?limit=10&offset=0",
    description: "Get bookmarked posts",
    category: "Content",
  },
  {
    method: "GET",
    path: "/api2/v2/posts/bookmarks/categories",
    description: "Get bookmark categories / collections",
    category: "Content",
  },
  {
    method: "GET",
    path: "/api2/v2/labels?limit=10&offset=0",
    description: "Get user-created labels / categories",
    category: "Content",
  },
  // ── Subscriptions ──
  {
    method: "GET",
    path: "/api2/v2/subscriptions/subscribes?limit=10&offset=0&type=active&format=infinite",
    description: "List accounts you are subscribed to",
    category: "Subscriptions",
  },
  {
    method: "GET",
    path: "/api2/v2/subscriptions/subscribes/count",
    description: "Count of active subscriptions",
    category: "Subscriptions",
  },
  {
    method: "GET",
    path: "/api2/v2/subscriptions/subscribers/recent-expired",
    description: "List recently expired subscribers",
    category: "Subscribers",
  },
  {
    method: "GET",
    path: "/api2/v2/subscriptions/subscribers/awards?limit=10&offset=0",
    description: "List top-spending subscribers / awards",
    category: "Subscribers",
  },
  {
    method: "GET",
    path: "/api2/v2/subscriptions/subscribers/awards/count",
    description: "Count of subscriber awards",
    category: "Subscribers",
  },
  {
    method: "GET",
    path: "/api2/v2/subscriptions/{subscription_id}/history",
    description: "Get subscription payment history for a user",
    category: "Subscriptions",
  },
  {
    method: "POST",
    path: "/api2/v2/users/{user_id}/subscribe",
    description: "Subscribe to a user",
    category: "Subscriptions",
  },
  {
    method: "DELETE",
    path: "/api2/v2/users/{user_id}/unsubscribe",
    description: "Unsubscribe from a user",
    category: "Subscriptions",
  },
  // ── Messaging Advanced ──
  {
    method: "GET",
    path: "/api2/v2/chats?limit=10&offset=0&order=recent&skip_users=all",
    description: "List recent chats (lightweight, skip user objects)",
    category: "Messaging",
  },
  {
    method: "GET",
    path: "/api2/v2/chats/{user_id}/messages/search?query=hello",
    description: "Search messages within a chat",
    category: "Messaging",
  },
  {
    method: "POST",
    path: "/api2/v2/chats/{user_id}/mark-as-read",
    description: "Mark a chat as read",
    category: "Messaging",
  },
  {
    method: "GET",
    path: "/api2/v2/messages/queue?limit=10&offset=0",
    description: "Get scheduled / queued mass messages",
    category: "Messaging",
  },
  {
    method: "GET",
    path: "/api2/v2/messages/templates",
    description: "Get saved message templates",
    category: "Messaging",
  },
  // ── Stories ──
  {
    method: "GET",
    path: "/api2/v2/users/me/stories",
    description: "Get your active stories",
    category: "Stories",
  },
  {
    method: "GET",
    path: "/api2/v2/users/{user_id}/stories",
    description: "Get stories of a specific user",
    category: "Stories",
  },
  {
    method: "GET",
    path: "/api2/v2/users/{user_id}/stories/highlights",
    description: "Get story highlights for a user",
    category: "Stories",
  },
  {
    method: "GET",
    path: "/api2/v2/stories/archive",
    description: "Get archived stories",
    category: "Stories",
  },
  // ── Streams / Live ──
  {
    method: "GET",
    path: "/api2/v2/streams/active",
    description: "Get currently active / live streams",
    category: "Streams",
  },
  {
    method: "GET",
    path: "/api2/v2/streams/{stream_id}/viewers",
    description: "Get viewers of a live stream",
    category: "Streams",
  },
  {
    method: "GET",
    path: "/api2/v2/streams/{stream_id}/stats",
    description: "Get stats for a stream (views, tips, etc.)",
    category: "Streams",
  },
  {
    method: "GET",
    path: "/api2/v2/streams/feed",
    description: "Get live stream feed / discovery",
    category: "Streams",
  },
  // ── User Management ──
  {
    method: "GET",
    path: "/api2/v2/users/me/settings",
    description: "Get all account settings",
    category: "User",
  },
  {
    method: "POST",
    path: "/api2/v2/users/{user_id}/block",
    description: "Block a user",
    category: "User",
  },
  {
    method: "DELETE",
    path: "/api2/v2/users/{user_id}/block",
    description: "Unblock a user",
    category: "User",
  },
  {
    method: "POST",
    path: "/api2/v2/users/{user_id}/restrict",
    description: "Restrict a user",
    category: "User",
  },
  {
    method: "GET",
    path: "/api2/v2/users/blocked?limit=10&offset=0",
    description: "List blocked users",
    category: "User",
  },
  // ── Lists & Labels ──
  {
    method: "GET",
    path: "/api2/v2/lists/{list_id}/users?limit=10&offset=0",
    description: "Get users in a specific list",
    category: "Lists",
  },
  {
    method: "POST",
    path: "/api2/v2/lists/{list_id}/users/{user_id}",
    description: "Add a user to a list",
    category: "Lists",
  },
  {
    method: "DELETE",
    path: "/api2/v2/lists/{list_id}/users/{user_id}",
    description: "Remove a user from a list",
    category: "Lists",
  },
  {
    method: "POST",
    path: "/api2/v2/lists",
    description: "Create a new list",
    category: "Lists",
    body: '{"name": "My List"}',
  },
  // ── Promotions & Trials ──
  {
    method: "GET",
    path: "/api2/v2/promotions?limit=10&offset=0",
    description: "Get promotional campaigns / discounts",
    category: "Promotions",
  },
  {
    method: "GET",
    path: "/api2/v2/promotions/offers",
    description: "Get active promotional offers",
    category: "Promotions",
  },
  {
    method: "GET",
    path: "/api2/v2/trials?limit=10&offset=0",
    description: "Get free trial links",
    category: "Promotions",
  },
  {
    method: "POST",
    path: "/api2/v2/trials",
    description: "Create a free trial link",
    category: "Promotions",
  },
  // ── Payouts Advanced ──
  {
    method: "GET",
    path: "/api2/v2/payouts/account",
    description: "Get payout account / banking info",
    category: "Payouts",
  },
  {
    method: "GET",
    path: "/api2/v2/payouts/requests",
    description: "List payout request history",
    category: "Payouts",
  },
  {
    method: "GET",
    path: "/api2/v2/payouts/requests/referral?startDate=2025-01-01&endDate=2025-12-31",
    description: "List referral payout requests (marker-based pagination)",
    category: "Payouts",
  },
  {
    method: "GET",
    path: "/api2/v2/payouts/chargebacks?limit=10",
    description: "List chargeback / dispute transactions",
    category: "Payouts",
  },
  {
    method: "GET",
    path: "/api2/v2/payouts/chargebacks/ratio?startDate=2025-01-01&endDate=2025-12-31",
    description: "Get chargeback-to-transaction ratio",
    category: "Payouts",
  },
  {
    method: "GET",
    path: "/api2/v2/payouts/chargebacks/chart?startDate=2025-01-01&endDate=2025-12-31&withTotal=true",
    description: "Get chargebacks time-series chart data",
    category: "Payouts",
  },
  {
    method: "GET",
    path: "/api2/v2/payouts/referrals/chart?startDate=2025-01-01&endDate=2025-12-31&withTotal=1",
    description: "Get referral earnings time-series chart data",
    category: "Payouts",
  },
  {
    method: "GET",
    path: "/api2/v2/payments/all/transactions?limit=20&offset=0",
    description: "Get all payment transactions",
    category: "Payouts",
  },
  {
    method: "GET",
    path: "/api2/v2/payments/referrals/balance",
    description: "Get referral earnings balance",
    category: "Payouts",
  },
  // ── Notifications ──
  {
    method: "GET",
    path: "/api2/v2/users/notifications/count",
    description: "Get unread notification count",
    category: "Notifications",
  },
  {
    method: "POST",
    path: "/api2/v2/users/notifications/read",
    description: "Mark all notifications as read",
    category: "Notifications",
  },
  // ── Helpers / Assistants ──
  {
    method: "GET",
    path: "/api2/v2/helpers",
    description: "List account helpers / managers",
    category: "Helpers",
  },
  {
    method: "GET",
    path: "/api2/v2/helpers/permissions",
    description: "Get helper permission settings",
    category: "Helpers",
  },
  // ── Misc ──
  {
    method: "GET",
    path: "/api2/v2/init",
    description: "App initialization data (config, feature flags, user state)",
    category: "Misc",
  },
  {
    method: "GET",
    path: "/api2/v2/users/me/profile/views/qr",
    description: "Get QR code for profile link",
    category: "User",
  },
  {
    method: "GET",
    path: "/api2/v2/schedules?limit=10&offset=0",
    description: "Get scheduled posts",
    category: "Content",
  },
  {
    method: "GET",
    path: "/api2/v2/schedules/counters",
    description: "Get count of scheduled posts",
    category: "Content",
  },
  // ── Dashboard Stats (extracted from OF webapp source) ──
  {
    method: "GET",
    path: "/api2/v2/users/me/stats/overview",
    description: "Overall account statistics dashboard",
    category: "User",
  },
  {
    method: "GET",
    path: "/api2/v2/users/me/stats/today-activity",
    description: "Today's activity summary (fans, earnings, messages)",
    category: "User",
  },
  {
    method: "GET",
    path: "/api2/v2/users/me/stats/top/fan",
    description: "Top paying fans / best subscribers",
    category: "User",
  },
  {
    method: "GET",
    path: "/api2/v2/users/me/stats/top/post",
    description: "Top performing posts",
    category: "User",
  },
  {
    method: "GET",
    path: "/api2/v2/users/me/stats/top/message",
    description: "Top performing messages",
    category: "User",
  },
  {
    method: "GET",
    path: "/api2/v2/users/me/stats/top/stream",
    description: "Top performing streams",
    category: "User",
  },
  {
    method: "GET",
    path: "/api2/v2/users/me/stats/top/story",
    description: "Top performing stories",
    category: "User",
  },
  {
    method: "GET",
    path: "/api2/v2/users/me/profile/stats",
    description: "Profile view and engagement stats",
    category: "User",
  },
  {
    method: "GET",
    path: "/api2/v2/users/me/referrals",
    description: "Referral program stats and earnings",
    category: "User",
  },
  {
    method: "GET",
    path: "/api2/v2/users/performers-search?query={name}",
    description: "Search performers/creators by username",
    category: "User",
  },
  {
    method: "GET",
    path: "/api2/v2/streaks",
    description: "Get posting / activity streaks",
    category: "User",
  },
  // ── Subscribers / Fans analytics ──
  {
    method: "GET",
    path: "/api2/v2/subscriptions/subscribers/top?limit=10",
    description: "Top spenders / best subscribers",
    category: "Subscribers",
  },
  {
    method: "GET",
    path: "/api2/v2/subscriptions/subscribers/latest?limit=10",
    description: "Recently subscribed users",
    category: "Subscribers",
  },
  {
    method: "GET",
    path: "/api2/v2/subscriptions/subscribers/chart?startDate=2026-01-01&endDate=2026-12-31",
    description: "Subscriber metrics time-series",
    category: "Subscribers",
  },
  {
    method: "GET",
    path: "/api2/v2/subscriptions/bundles",
    description: "Get subscription bundles (discount packages)",
    category: "Subscribers",
  },
  {
    method: "GET",
    path: "/api2/v2/subscriptions/count/all",
    description: "Total subscription count (active + expired)",
    category: "Subscribers",
  },
  // ── Posts / Content analytics ──
  {
    method: "GET",
    path: "/api2/v2/posts/{post_id}/stats",
    description: "Post statistics (views, likes, comments, earnings)",
    category: "Content",
  },
  {
    method: "GET",
    path: "/api2/v2/posts/{post_id}/tips",
    description: "Get tips received on a post",
    category: "Content",
  },
  {
    method: "GET",
    path: "/api2/v2/posts/{post_id}/buyers",
    description: "Get users who purchased a paid post",
    category: "Content",
  },
  {
    method: "GET",
    path: "/api2/v2/posts/chart?startDate=2026-01-01&endDate=2026-12-31",
    description: "Time-series chart of post metrics",
    category: "Content",
  },
  {
    method: "GET",
    path: "/api2/v2/posts/top?limit=10",
    description: "Top-performing posts",
    category: "Content",
  },
  {
    method: "GET",
    path: "/api2/v2/posts/paid/authors?query={name}",
    description: "Search paid post co-authors",
    category: "Content",
  },
  // ── Vault (media library) ──
  {
    method: "GET",
    path: "/api2/v2/vault/media/{media_id}",
    description: "Get specific vault media item details",
    category: "Content",
  },
  {
    method: "GET",
    path: "/api2/v2/vault/media/{media_id}/posts",
    description: "Get posts that use a specific vault media item",
    category: "Content",
  },
  {
    method: "GET",
    path: "/api2/v2/vault/media/hash?hash={md5}",
    description: "Find vault media by hash (dedupe uploads)",
    category: "Content",
  },
  {
    method: "GET",
    path: "/api2/v2/vault/media/types",
    description: "Get available media types in your vault",
    category: "Content",
  },
  {
    method: "GET",
    path: "/api2/v2/vault/media/processing",
    description: "Get media currently being processed",
    category: "Content",
  },
  {
    method: "GET",
    path: "/api2/v2/schedules/later/{offset}",
    description: "Get scheduled posts (pagination via offset)",
    category: "Content",
  },
  // ── Stories analytics ──
  {
    method: "GET",
    path: "/api2/v2/stories/{story_id}",
    description: "Get specific story by ID",
    category: "Stories",
  },
  {
    method: "GET",
    path: "/api2/v2/stories/{story_id}/viewers",
    description: "Get users who viewed a story",
    category: "Stories",
  },
  {
    method: "GET",
    path: "/api2/v2/stories/{story_id}/stats",
    description: "Story statistics (views, replies)",
    category: "Stories",
  },
  {
    method: "GET",
    path: "/api2/v2/stories/{story_id}/answer",
    description: "Get story replies / answers",
    category: "Stories",
  },
  {
    method: "GET",
    path: "/api2/v2/stories/chart?startDate=2026-01-01&endDate=2026-12-31",
    description: "Time-series chart of story metrics",
    category: "Stories",
  },
  {
    method: "GET",
    path: "/api2/v2/stories/top?limit=10",
    description: "Top-performing stories",
    category: "Stories",
  },
  {
    method: "GET",
    path: "/api2/v2/stories/highlights/{highlight_id}",
    description: "Get story highlight details",
    category: "Stories",
  },
  // ── Streams analytics ──
  {
    method: "GET",
    path: "/api2/v2/streams/{stream_id}/comments?limit=10",
    description: "Get comments from a live stream",
    category: "Streams",
  },
  {
    method: "GET",
    path: "/api2/v2/streams/{stream_id}/tips",
    description: "Get tips received during a stream",
    category: "Streams",
  },
  {
    method: "GET",
    path: "/api2/v2/streams/{stream_id}/voters",
    description: "Get poll voters in a stream",
    category: "Streams",
  },
  {
    method: "GET",
    path: "/api2/v2/streams/{stream_id}/events",
    description: "Get stream events (joins, leaves, tips)",
    category: "Streams",
  },
  {
    method: "GET",
    path: "/api2/v2/streams/{stream_id}/url",
    description: "Get stream playback URL (for ongoing/past streams)",
    category: "Streams",
  },
  {
    method: "GET",
    path: "/api2/v2/streams/chart?startDate=2026-01-01&endDate=2026-12-31",
    description: "Time-series chart of stream metrics",
    category: "Streams",
  },
  {
    method: "GET",
    path: "/api2/v2/streams/top?limit=10",
    description: "Top-performing streams",
    category: "Streams",
  },
  {
    method: "GET",
    path: "/api2/v2/streams/has-active",
    description: "Check if any stream is currently live",
    category: "Streams",
  },
  {
    method: "GET",
    path: "/api2/v2/users/{user_id}/streams",
    description: "Get all streams for a specific user",
    category: "Streams",
  },
  {
    method: "GET",
    path: "/api2/v2/users/{user_id}/streams/active",
    description: "Get active/live streams for a user",
    category: "Streams",
  },
  // ── Messaging extras ──
  {
    method: "GET",
    path: "/api2/v2/chats/{user_id}/media/{media_id}",
    description: "Get specific media attachment from a chat",
    category: "Messaging",
  },
  {
    method: "GET",
    path: "/api2/v2/chats/users?limit=10",
    description: "List chat users for filtering the inbox",
    category: "Messaging",
  },
  {
    method: "GET",
    path: "/api2/v2/messages/{message_id}",
    description: "Get a specific message by ID",
    category: "Messaging",
  },
  {
    method: "GET",
    path: "/api2/v2/messages/queue/{queue_id}/buyers",
    description: "Get buyers who purchased a mass message",
    category: "Messaging",
  },
  {
    method: "GET",
    path: "/api2/v2/messages/queue/chart?startDate=2026-01-01&endDate=2026-12-31",
    description: "Chart data for queued mass messages",
    category: "Messaging",
  },
  // ── Lists extras ──
  {
    method: "GET",
    path: "/api2/v2/lists/{list_id}/posts?limit=10",
    description: "Get posts assigned to a list",
    category: "Lists",
  },
  {
    method: "GET",
    path: "/api2/v2/lists/{list_id}/users/pinned",
    description: "Get pinned users in a list",
    category: "Lists",
  },
  // ── Campaigns & promotions ──
  {
    method: "GET",
    path: "/api2/v2/campaigns/chart?startDate=2026-01-01&endDate=2026-12-31",
    description: "Campaign performance time-series",
    category: "Campaigns",
  },
  {
    method: "GET",
    path: "/api2/v2/campaigns/share-access",
    description: "Get campaign share/access links",
    category: "Campaigns",
  },
  {
    method: "GET",
    path: "/api2/v2/promotions/chart?startDate=2026-01-01&endDate=2026-12-31",
    description: "Promotion performance chart",
    category: "Promotions",
  },
  {
    method: "GET",
    path: "/api2/v2/trials/chart?startDate=2026-01-01&endDate=2026-12-31",
    description: "Trial link performance chart",
    category: "Promotions",
  },
  {
    method: "GET",
    path: "/api2/v2/trials/stats",
    description: "Trial statistics summary",
    category: "Promotions",
  },
  // ── Payouts analytics ──
  {
    method: "GET",
    path: "/api2/v2/payouts/stats?startDate=2026-01-01&endDate=2026-12-31",
    description: "Payout statistics (totals, averages, top sources)",
    category: "Payouts",
  },
  {
    method: "GET",
    path: "/api2/v2/payouts/chart?startDate=2026-01-01&endDate=2026-12-31&withTotal=true",
    description: "Earnings time-series for payout period",
    category: "Payouts",
  },
  // ── Account Settings ──
  {
    method: "GET",
    path: "/api2/v2/users/settings/chat",
    description: "Get chat/messaging settings",
    category: "User",
  },
  {
    method: "GET",
    path: "/api2/v2/users/settings/post",
    description: "Get post settings",
    category: "User",
  },
  {
    method: "GET",
    path: "/api2/v2/users/settings/story",
    description: "Get story settings",
    category: "User",
  },
  {
    method: "GET",
    path: "/api2/v2/users/settings/streams",
    description: "Get streaming settings",
    category: "User",
  },
  // ── Content (Write Operations) ──
  {
    method: "POST",
    path: "/api2/v2/posts",
    description:
      "Create a new post. Attach uploads via `mediaFiles` (whole object from /accounts/{of_user_id}/media) — `media` is silently ignored",
    category: "Content",
    // `mediaFiles` (NOT `media`) and the FULL object from POST
    // /accounts/{id}/media — OnlyFans returns 200 and attaches nothing if you
    // use `media`, or trim the object down to just processId. `postedAt` needs
    // the +00:00 offset; a "Z" suffix published immediately in testing.
    body: '{"text": "Post text", "mediaFiles": [123], "price": 0, "postedAt": "2026-08-20T12:00:00+00:00"}',
  },
  // `POST /api2/v2/media` was listed here as the vault upload endpoint until
  // 2026-08-06. It does not exist — OnlyFans 404s it, and neither reverse pass
  // over the OF web client found it. Media upload is the CRM route below,
  // which drives OF's real signed-S3 pipeline server-side.
  {
    method: "POST",
    path: "/accounts/{of_user_id}/media",
    description:
      "Upload media — multipart `file`, or JSON {source_url} we fetch for you. Returns a `media` object to put in a post/message `mediaFiles` array (not `media`)",
    category: "Content",
    body: '{"source_url": "https://example.com/photo.jpg"}',
  },
  {
    method: "PUT",
    path: "/api2/v2/vault/media/{media_id}/attach",
    description: "Attach vault media to post/message",
    category: "Content",
  },
  {
    method: "POST",
    path: "/api2/v2/vault/lists/{list_id}/media",
    description: "Add media to vault list",
    category: "Content",
    body: '{"mediaIds": [123, 456]}',
  },
  {
    method: "POST",
    path: "/api2/v2/posts/{post_id}/vote",
    description: "Vote on a post poll",
    category: "Content",
    body: '{"optionId": 1}',
  },
  {
    method: "POST",
    path: "/api2/v2/posts/pinned/sort",
    description: "Reorder pinned posts",
    category: "Content",
    body: '{"postIds": [123, 456, 789]}',
  },
  {
    method: "POST",
    path: "/api2/v2/posts/stats-collect",
    description: "Report post view/interaction stats",
    category: "Content",
  },
  // ── Messaging (Write Operations) ──
  {
    method: "POST",
    path: "/api2/v2/messages/queue",
    description: "Create a mass message",
    category: "Messaging",
    body: '{"text": "Message text", "mediaFiles": [123], "price": 0, "isCouplePeopleMedia": false}',
  },
  {
    method: "POST",
    path: "/api2/v2/messages/queue/size",
    description: "Calculate mass message audience size",
    category: "Messaging",
    body: '{"excludeIds": [], "groups": ["all"]}',
  },
  {
    method: "POST",
    path: "/api2/v2/messages/{message_id}/like",
    description: "Like / react to a message",
    category: "Messaging",
  },
  // ── Subscriptions (Write Operations) ──
  {
    method: "PUT",
    path: "/api2/v2/subscriptions/{subscription_id}/discount",
    description: "Apply subscription discount",
    category: "Subscribers",
    body: '{"discount": 50, "months": 1}',
  },
  // ── User (Write Operations) ──
  {
    method: "PATCH",
    path: "/api2/v2/users/me",
    description: "Update user profile",
    category: "User",
    body: '{"displayName": "New Name", "about": "Bio text", "tipsEnabled": true, "tipsMin": 5}',
  },
  // ── Stories (Write Operations) ──
  {
    method: "POST",
    path: "/api2/v2/users/me/stories",
    description: "Create a new story",
    category: "Stories",
    body: '{"mediaFiles": [123], "text": "Story text"}',
  },
  {
    method: "POST",
    path: "/api2/v2/stories/highlights",
    description: "Create a story highlight",
    category: "Stories",
    body: '{"title": "Highlight Name", "storyIds": [123, 456]}',
  },
  // ── Streams (Write/Action Operations) ──
  {
    method: "POST",
    path: "/api2/v2/streams",
    description: "Create / start a live stream",
    category: "Streams",
    body: '{"title": "Stream Title", "isScheduled": false}',
  },
  {
    method: "POST",
    path: "/api2/v2/streams/{stream_id}/vote",
    description: "Vote on a stream poll",
    category: "Streams",
    body: '{"optionId": 1}',
  },
  {
    method: "POST",
    path: "/api2/v2/streams/{stream_id}/kick",
    description: "Kick a user from stream",
    category: "Streams",
    body: '{"userId": 12345}',
  },
  // Reverse-engineered OF /api2/v2 endpoints (auto-generated from the OF web client).
  ...reversedOfEndpoints,
];

const methodColors: Record<string, "success" | "primary" | "warning" | "danger"> = {
  GET: "success",
  POST: "primary",
  PUT: "warning",
  PATCH: "warning",
  DELETE: "danger",
};

type EndpointItem = {
  method: string;
  path: string;
  description: string;
  category: string;
  isCrm?: boolean;
  body?: string;
  query?: string;
};

export default function ApiDocsPage() {
  const { data: session } = useSession();
  const api = useApiClient();
  const { selectedAccount } = useAccounts();
  const { apiKey: liveApiKey } = useApiKey();

  const [tab, setTab] = useState<"crm" | "of">("crm");
  const endpoints = tab === "crm" ? crmEndpoints : ofEndpoints;
  const [selectedEndpoint, setSelectedEndpoint] = useState<EndpointItem>(crmEndpoints[0]);
  const [customPath, setCustomPath] = useState(crmEndpoints[0].path);
  const [customMethod, setCustomMethod] = useState(crmEndpoints[0].method);
  const [customBody, setCustomBody] = useState("");
  const [response, setResponse] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [copiedResponse, setCopiedResponse] = useState(false);
  const [copiedAi, setCopiedAi] = useState(false);
  const [copiedAllDocs, setCopiedAllDocs] = useState(false);
  const [showPython, setShowPython] = useState(false);
  const [copiedPython, setCopiedPython] = useState<string | null>(null);
  const [showCredentials, setShowCredentials] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [collapsedCategories, setCollapsedCategories] = useState<Set<string>>(new Set());

  const selectEndpoint = (ep: EndpointItem) => {
    setSelectedEndpoint(ep);
    const fullPath = ep.query ? `${ep.path}${ep.query}` : ep.path;
    setCustomPath(fullPath);
    setCustomMethod(ep.method);
    setCustomBody(ep.body || "");
    setResponse(null);
  };

  const switchTab = (newTab: "crm" | "of") => {
    setTab(newTab);
    setSearchQuery("");
    setCollapsedCategories(new Set());
    const list = newTab === "crm" ? crmEndpoints : ofEndpoints;
    selectEndpoint(list[0]);
  };

  // Filtered endpoints based on search
  const filteredEndpoints = useMemo(() => {
    if (!searchQuery.trim()) return endpoints;
    const q = searchQuery.toLowerCase();
    return endpoints.filter(
      (ep) =>
        ep.path.toLowerCase().includes(q) ||
        ep.description.toLowerCase().includes(q) ||
        ep.method.toLowerCase().includes(q) ||
        ep.category.toLowerCase().includes(q)
    );
  }, [endpoints, searchQuery]);

  // Categories from filtered results
  const categories = useMemo(
    () => [...new Set(filteredEndpoints.map((e) => e.category))],
    [filteredEndpoints]
  );

  const toggleCategory = (cat: string) => {
    setCollapsedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  };

  // The raw OF-API passthrough (POST /accounts/{id}/request + the /api2/v2
  // proxy) is OnlyFans-only — no platform_features capability key maps to it,
  // so gate on the account's platform directly (matches the backend, which
  // 501s `platform_not_supported` for non-OF accounts on these routes).
  const passthroughBlocked =
    selectedAccount?.platform === "fansly" &&
    (tab === "of" || selectedEndpoint.path === "/accounts/{of_user_id}/request");

  // Show the backend's canonical 501 `platform_not_supported` payload with
  // friendly copy instead of echoing the raw backend string.
  const presentResponse = (res: Response, data: any) => {
    if (!res.ok && isPlatformNotSupported(new ApiError(res.status, data))) {
      setResponse({ ...data, error: platformUnsupportedMessage(data?.feature, data?.platform) });
    } else {
      setResponse(data);
    }
  };

  const executeRequest = async () => {
    if (!api || !selectedAccount || passthroughBlocked) return;
    setLoading(true);
    setResponse(null);

    try {
      // Both CRM and OF-proxy requests go through the same-origin proxy at
      // /api/crm/<crm_id>/... — the proxy attaches X-API-Key server-side from
      // the JWT so the browser never holds the key.
      const crmId = session?.user?.crmId || "";

      if (tab === "crm" && selectedEndpoint.isCrm) {
        const ofUserId = selectedAccount.of_user_id;
        let resolvedPath = customPath.replace("{of_user_id}", ofUserId);
        const url = `/api/crm/${crmId}${resolvedPath}`;

        const fetchOptions: RequestInit = {
          method: customMethod,
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
        };
        if (customBody && (customMethod === "POST" || customMethod === "PUT" || customMethod === "PATCH")) {
          fetchOptions.body = customBody;
        }

        const res = await fetch(url, fetchOptions);
        const data = await res.json();
        presentResponse(res, data);
      } else {
        const url = `/api/crm/${crmId}${customPath}`;

        const fetchOptions: RequestInit = {
          method: customMethod,
          credentials: "same-origin",
          headers: {
            "user-id": selectedAccount.of_user_id,
            ...(customBody && customMethod !== "GET" ? { "Content-Type": "application/json" } : {}),
          },
        };
        if (customBody && customMethod !== "GET") {
          fetchOptions.body = customBody;
        }

        const res = await fetch(url, fetchOptions);
        const data = await res.json();
        presentResponse(res, data);
      }
    } catch (err: any) {
      setResponse({ error: err.message });
    } finally {
      setLoading(false);
    }
  };

  const generateCurl = () => {
    const baseUrl = process.env.NEXT_PUBLIC_API_URL || process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:5000";
    const crmId = session?.user?.crmId || "<crm_id>";
    const apiKey = liveApiKey || "<api_key>";
    const ofUserId = selectedAccount?.of_user_id || "<of_user_id>";

    if (tab === "crm") {
      const resolvedPath = customPath.replace("{of_user_id}", ofUserId);
      const url = `${baseUrl}/api/crm/${crmId}${resolvedPath}`;
      let cmd = `curl -X ${customMethod} "${url}" \\\n  -H "Content-Type: application/json" \\\n  -H "X-API-Key: ${apiKey}"`;
      if (customBody && customMethod !== "GET") {
        cmd += ` \\\n  -d '${customBody}'`;
      }
      return cmd;
    }

    const url = `${baseUrl}/api/crm/${crmId}${customPath}`;
    let cmd = `curl -X ${customMethod} "${url}" \\\n  -H "X-API-Key: ${apiKey}" \\\n  -H "user-id: ${ofUserId}"`;
    if (customBody && customMethod !== "GET") {
      cmd += ` \\\n  -H "Content-Type: application/json" \\\n  -d '${customBody}'`;
    }
    return cmd;
  };

  const generateFullAiDocs = () => {
    const base = process.env.NEXT_PUBLIC_API_URL || process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:5000";
    const crmId = session?.user?.crmId || "<crm_id>";
    const apiKey = liveApiKey || "<api_key>";
    const uid = selectedAccount?.of_user_id || "<of_user_id>";

    const section = (list: EndpointItem[]) => {
      const byCat: Record<string, EndpointItem[]> = {};
      list.forEach((ep) => {
        (byCat[ep.category] = byCat[ep.category] || []).push(ep);
      });
      let out = "";
      Object.keys(byCat).forEach((cat) => {
        out += "\n### " + cat + "\n";
        byCat[cat].forEach((ep) => {
          out += "\n- `" + ep.method + " " + ep.path.split("?")[0] + "` — " + ep.description;
          if (ep.query) out += "\n  - Query: `" + ep.query + "`";
          if (ep.body) out += "\n  - Body: `" + ep.body + "`";
        });
        out += "\n";
      });
      return out;
    };

    const L: string[] = [];
    L.push("# The Only API — Complete Reference (for AI assistants)");
    L.push("");
    L.push("Third-party REST API for OnlyFans and Fansly. Paste this entire document into Claude Code, Cursor, ChatGPT, or any AI assistant and ask it to build your integration against it.");
    L.push("");
    L.push("## Base URL");
    L.push("`" + base + "/api/crm/{crm_id}`");
    L.push("");
    L.push("Your values (filled in from your account):");
    L.push("- crm_id: `" + crmId + "`");
    L.push("- api_key: `" + apiKey + "`  (send as a header, never in the URL)");
    L.push("- of_user_id: `" + uid + "`  (the connected account to act as)");
    L.push("");
    L.push("## Authentication");
    L.push("- Every request needs header: `X-API-Key: " + apiKey + "`");
    L.push("- OnlyFans passthrough requests also need header: `user-id: " + uid + "`");
    L.push("- The key is scoped to your CRM panel. Rotate it from the dashboard if it leaks.");
    L.push("");
    L.push("## Two ways to call");
    L.push("1. First-class CRM routes — `/api/crm/{crm_id}/...` — cleaned, paginated JSON. Prefer these when they exist.");
    L.push("2. OnlyFans passthrough — `/api/crm/{crm_id}/api2/v2/<of_path>` plus header `user-id` — returns the raw OnlyFans response; signed headers + session are injected server-side. OnlyFans accounts only.");
    L.push("");
    L.push("## CRM API endpoints (" + crmEndpoints.length + ")");
    L.push(section(crmEndpoints));
    L.push("## OnlyFans passthrough endpoints (" + ofEndpoints.length + ")");
    L.push(section(ofEndpoints));
    L.push("## Working example — curl");
    L.push("```bash");
    L.push("curl -X GET \"" + base + "/api/crm/" + crmId + "/accounts?include_session=true\" \\");
    L.push("  -H \"X-API-Key: " + apiKey + "\"");
    L.push("```");
    L.push("");
    L.push("## Working example — Python");
    L.push("```python");
    L.push("import requests");
    L.push("BASE = \"" + base + "\"");
    L.push("CRM_ID = \"" + crmId + "\"");
    L.push("API_KEY = \"" + apiKey + "\"");
    L.push("USER_ID = \"" + uid + "\"");
    L.push("H = {\"X-API-Key\": API_KEY, \"Content-Type\": \"application/json\"}");
    L.push("");
    L.push("# List connected accounts");
    L.push("accounts = requests.get(f\"{BASE}/api/crm/{CRM_ID}/accounts\", headers=H).json()");
    L.push("");
    L.push("# Send a DM via the OnlyFans passthrough");
    L.push("requests.post(");
    L.push("    f\"{BASE}/api/crm/{CRM_ID}/accounts/{USER_ID}/request\",");
    L.push("    headers=H,");
    L.push("    json={\"path\": \"/api2/v2/chats/<fan_id>/messages\", \"method\": \"POST\", \"body\": {\"text\": \"hi\"}},");
    L.push(")");
    L.push("```");
    L.push("");
    L.push("## MCP server (Claude Desktop / ChatGPT / Cursor)");
    L.push("- URL: `" + base + "/mcp`");
    L.push("- Auth: header `Authorization: Bearer " + apiKey + "`");
    L.push("- Exposes the whole API as tools. Read tools work immediately; non-GET OnlyFans proxy writes are off by default and enabled per panel.");
    L.push("");
    L.push("## Rate limits & plans");
    L.push("- Free: 1,000 API calls/month, 1 account.");
    L.push("- Paid slots: unlimited calls ($20/slot/mo, drops to $15 at 15+ slots).");
    L.push("- Per-minute caps: 100 default, 10 writes, 5 login.");
    L.push("");
    L.push("## Conventions");
    L.push("- Responses are JSON. Errors: `{ \"error\": \"...\" }` with a 4xx/5xx status.");
    L.push("- Dates: `YYYY-MM-DD HH:MM:SS` (URL-encode the space as %20 in query strings).");
    L.push("- Pagination: `limit` + `offset`, or a `marker`/`nextMarker` cursor on transaction endpoints.");
    return L.join("\n");
  };

  const generateAiMarkdown = () => {
    const ep = selectedEndpoint;
    const base = process.env.NEXT_PUBLIC_API_URL || process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:5000";
    const auth = tab === "crm"
      ? "header X-API-Key: <your_api_key>"
      : "headers X-API-Key: <your_api_key> and user-id: <of_user_id>";
    let md = "## " + ep.method + " " + ep.path.split("?")[0] + "\n\n";
    md += ep.description + "\n\n";
    md += "- Base URL: " + base + "/api/crm/{crm_id}\n";
    md += "- Auth: " + auth + "\n";
    if (ep.query) md += "- Query: " + ep.query + "\n";
    if (ep.body) md += "- Body (JSON): " + ep.body + "\n";
    md += "\nExample:\n```bash\n" + generateCurl() + "\n```\n";
    return md;
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const methodBadgeClass: Record<string, string> = {
    GET: "bg-emerald-500/15 text-emerald-400 border-emerald-500/20",
    POST: "bg-blue-500/15 text-blue-400 border-blue-500/20",
    PUT: "bg-amber-500/15 text-amber-400 border-amber-500/20",
    PATCH: "bg-amber-500/15 text-amber-400 border-amber-500/20",
    DELETE: "bg-red-500/15 text-red-400 border-red-500/20",
  };

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="heading-2">API Documentation</h2>
          <p className="text-sm text-default-500 mt-1">
            Explore endpoints, test requests, and copy any endpoint as AI-ready markdown to paste into ChatGPT or Claude.
          </p>
        </div>
        <div className="flex gap-2 shrink-0">
          <Link href="/dashboard/console">
            <Button
              size="sm"
              variant="bordered"
              className="bg-transparent border border-[color:rgba(var(--theme-accent-rgb,245,73,0),0.3)] rounded-none hover:border-[color:rgba(var(--theme-accent-rgb,245,73,0),0.5)] text-xs text-[color:var(--theme-accent,#f54900)]"
              startContent={<PxKey className="h-3 w-3" />}
            >
              Open Console
            </Button>
          </Link>
          <Button
            size="sm"
            variant="bordered"
            className="bg-transparent border border-white/[0.08] rounded-none hover:border-[color:rgba(var(--theme-accent-rgb,245,73,0),0.3)] text-xs"
            startContent={showCredentials ? <PxChevronUp className="h-3 w-3" /> : <PxChevronDown className="h-3 w-3" />}
            onPress={() => setShowCredentials(!showCredentials)}
          >
            Credentials
          </Button>
        </div>
      </div>

      {/* Global "copy everything for AI" banner */}
      <div
        className="flex flex-col sm:flex-row sm:items-center gap-3 justify-between p-4 border"
        style={{
          borderColor: "rgba(var(--theme-accent-rgb,245,73,0),0.3)",
          backgroundColor: "rgba(var(--theme-accent-rgb,245,73,0),0.05)",
        }}
      >
        <div className="flex items-start gap-3 min-w-0">
          <PxCode2 className="h-5 w-5 shrink-0 mt-0.5 text-[color:var(--theme-accent,#f54900)]" />
          <div className="min-w-0">
            <p className="text-sm font-semibold text-foreground">
              Building with AI? Copy the entire API reference in one click.
            </p>
            <p className="text-xs text-default-400 mt-0.5">
              One markdown document — every CRM &amp; OnlyFans endpoint, your keys pre-filled, auth, working examples, and MCP setup. Paste it into Claude Code, Cursor, or ChatGPT and it can build your integration.
            </p>
          </div>
        </div>
        <Button
          className="dashboard-btn-primary text-white rounded-none uppercase tracking-wider font-bold shrink-0"
          size="sm"
          startContent={copiedAllDocs ? <PxCheck className="h-4 w-4" /> : <PxCopy className="h-4 w-4" />}
          onPress={() => {
            navigator.clipboard.writeText(generateFullAiDocs());
            setCopiedAllDocs(true);
            setTimeout(() => setCopiedAllDocs(false), 2500);
          }}
        >
          {copiedAllDocs ? "Copied full docs!" : "Copy full docs for AI"}
        </Button>
      </div>

      {/* Credentials — collapsible */}
      {showCredentials && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 p-4 bg-[#0d0d0d] border border-white/[0.06]">
          <div>
            <p className="text-[10px] text-default-400 uppercase tracking-wider mb-1">CRM ID</p>
            <code className="text-xs bg-white/[0.06] px-2 py-1 block truncate">
              {session?.user?.crmId || "—"}
            </code>
          </div>
          <div>
            <p className="text-[10px] text-default-400 uppercase tracking-wider mb-1">API Key</p>
            <code className="text-xs bg-white/[0.06] px-2 py-1 block truncate">
              {liveApiKey
                ? `${liveApiKey.slice(0, 12)}...`
                : "—"}
            </code>
          </div>
          <div>
            <p className="text-[10px] text-default-400 uppercase tracking-wider mb-1">Base URL</p>
            <code className="text-xs bg-white/[0.06] px-2 py-1 block truncate">
              {process.env.NEXT_PUBLIC_API_URL || process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:5000"}
            </code>
          </div>
        </div>
      )}

      {/* OF Proxy info banner */}
      {tab === "of" && (
        <div className="bg-[#0d0d0d] border border-white/[0.06] p-4 text-xs space-y-2.5">
          <p className="font-bold uppercase tracking-wider text-[color:var(--theme-accent,#f54900)] text-[10px]">How the OF Proxy works</p>
          <p className="text-default-400 leading-relaxed">
            Every OF API request is forwarded to OnlyFans on your behalf. The server automatically injects the required
            signed headers (<code className="bg-white/[0.06] px-1">sign</code>, <code className="bg-white/[0.06] px-1">time</code>, <code className="bg-white/[0.06] px-1">app-token</code>) and session cookies — you only need to provide:
          </p>
          <ul className="space-y-1 text-default-400">
            <li><code className="bg-white/[0.06] px-1 text-foreground">X-API-Key</code> — your CRM API key (sent automatically by the playground)</li>
            <li><code className="bg-white/[0.06] px-1 text-foreground">user-id</code> — the OF user ID of the account to use (set by the account selector above)</li>
            <li><code className="bg-white/[0.06] px-1 text-foreground">X-Proxy</code> — optional; falls back to the proxy saved at login time</li>
          </ul>
          <div className="border-t border-white/[0.06] pt-2.5">
            <p className="text-default-500 font-semibold mb-1">First-time session setup</p>
            <p className="text-default-500 leading-relaxed mb-2">
              If the account has no saved session yet, pass OnlyFans cookies on the first request using <code className="bg-white/[0.06] px-1">-b</code> (curl) or a <code className="bg-white/[0.06] px-1">Cookie</code> header. The server saves the session — subsequent requests need no cookies.
            </p>
            <ul className="space-y-1 text-default-400">
              <li><code className="bg-white/[0.06] px-1 text-foreground">sess</code> — <span className="text-red-400">required</span> — main session token</li>
              <li><code className="bg-white/[0.06] px-1 text-foreground">auth_id</code> — <span className="text-red-400">required</span> — your OnlyFans user ID</li>
              <li><code className="bg-white/[0.06] px-1 text-foreground">fp</code> — optional — fingerprint cookie</li>
            </ul>
            <p className="text-default-600 mt-2 text-[10px]">Find these in browser DevTools → Application → Cookies → onlyfans.com</p>
          </div>
        </div>
      )}

      {/* Python Examples */}
      <Card className="bg-[#0d0d0d] border border-white/[0.06] rounded-none shadow-none">
        <CardBody className="p-0">
          <button
            onClick={() => setShowPython(!showPython)}
            className="w-full flex items-center justify-between p-4 text-left"
          >
            <div className="flex items-center gap-2">
              <PxCode2 className="h-4 w-4 text-[color:var(--theme-accent,#f54900)]" />
              <h3 className="text-sm font-semibold">Python Examples</h3>
              <Chip size="sm" variant="flat" color="warning" className="text-xs">
                requests
              </Chip>
            </div>
            {showPython ? (
              <PxChevronUp className="h-4 w-4 text-default-400" />
            ) : (
              <PxChevronDown className="h-4 w-4 text-default-400" />
            )}
          </button>

          {showPython && (
            <div className="px-4 pb-4 space-y-4">
              {[
                {
                  title: "Setup — Config & helpers",
                  id: "setup",
                  code: `import requests, json

# ── Your credentials (auto-filled from your account) ──
BASE_URL = "${process.env.NEXT_PUBLIC_API_URL || process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:5000"}"
CRM_ID   = "${session?.user?.crmId || "<crm_id>"}"
API_KEY  = "${liveApiKey || "<api_key>"}"
USER_ID  = "${selectedAccount?.of_user_id || "<of_user_id>"}"

HEADERS = {"X-API-Key": API_KEY, "Content-Type": "application/json"}

def crm_get(path, params=None):
    """Call a CRM API endpoint (accounts, subscribers, earnings, etc.)"""
    r = requests.get(f"{BASE_URL}/api/crm/{CRM_ID}{path}", headers=HEADERS, params=params)
    return r.json()

def crm_post(path, body=None):
    """POST to a CRM API endpoint."""
    r = requests.post(f"{BASE_URL}/api/crm/{CRM_ID}{path}", headers=HEADERS, json=body)
    return r.json()

def of_proxy(of_path, method="GET", body=None):
    """Forward any request to OnlyFans API. Headers are signed automatically."""
    payload = {"path": of_path, "method": method}
    if body: payload["body"] = body
    r = requests.post(f"{BASE_URL}/api/crm/{CRM_ID}/accounts/{USER_ID}/request", headers=HEADERS, json=payload)
    return r.json()`,
                },
                {
                  title: "List accounts (with session info)",
                  id: "list-accounts",
                  code: `# Get all connected accounts — add ?include_session=true for sess/auth_id
accounts = crm_get("/accounts", params={"include_session": "true"})

for acc in accounts["accounts"]:
    print(f"@{acc['username']} (ID: {acc['of_user_id']})")
    print(f"  Email: {acc['email']}")
    print(f"  Proxy: {acc.get('proxy', 'none')}")
    if acc.get("session"):
        s = acc["session"]
        print(f"  sess: {s['sess']}")
        print(f"  auth_id: {s['auth_id']}")`,
                },
                {
                  title: "Profile & balance",
                  id: "profile-balance",
                  code: `# Profile via OF proxy (headers signed automatically)
me = of_proxy("/api2/v2/users/me")
if me.get("success"):
    u = me["data"]
    print(f"@{u['username']} — {u['subscribersCount']} subs, {u['postsCount']} posts")

# Balance via dedicated CRM endpoint
bal = crm_get(f"/accounts/{USER_ID}/balances")
b = bal.get("balances", {})
print(f"Available: $" + str(b.get('payoutAvailable', 0)) + f", Pending: $" + str(b.get('payoutPending', 0)))`,
                },
                {
                  title: "Subscribers",
                  id: "get-subs",
                  code: `# Via dedicated CRM endpoint (cleaner response)
subs = crm_get(f"/accounts/{USER_ID}/subscribers", params={"limit": 10, "type": "all"})
print(f"Total: {subs.get('count', 0)} subscribers")
for s in subs.get("list", []):
    total = s.get("subscribedOnData", {}).get("totalSumm", 0)
    print(f"  @{s.get('username')} — $" + str(total))

# Or via OF proxy (raw OF API response)
raw = of_proxy("/api2/v2/subscriptions/subscribers/count")
print(f"\\nOF reports: {raw['data']['count']} total subscribers")`,
                },
                {
                  title: "Earnings & transactions",
                  id: "get-earnings",
                  code: `# Earnings chart (last 7 days)
from datetime import datetime, timedelta
start = (datetime.now() - timedelta(days=7)).strftime("%Y-%m-%d")

earnings = crm_get(f"/accounts/{USER_ID}/earnings", params={"startDate": start})
chart = earnings.get("earnings", {}).get("chartAmount", [])
total = sum(d.get("count", 0) for d in chart)
print(f"Last 7 days: $" + f"{total:.2f}")

# Recent transactions
txns = crm_get(f"/accounts/{USER_ID}/purchases", params={"startDate": start, "limit": 5})
for t in txns.get("purchases", []):
    print(f"  $" + str(t.get('amount', 0)) + f" — {t.get('description', '')[:50]}")`,
                },
                {
                  title: "OF Proxy — chats, lists, custom requests",
                  id: "proxy-advanced",
                  code: `# Get recent chats
chats = of_proxy("/api2/v2/chats?limit=5&offset=0&order=recent")
if chats.get("success"):
    for c in (chats["data"] if isinstance(chats["data"], list) else []):
        print(f"Chat with @{c.get('withUser',{}).get('username','?')}")

# Get user lists
lists = of_proxy("/api2/v2/lists?limit=10&skip_users=all")
if lists.get("success"):
    for l in (lists["data"] if isinstance(lists["data"], list) else []):
        print(f"  {l.get('name')} ({l.get('usersCount',0)} users)")

# Send a message (POST example)
# result = of_proxy("/api2/v2/chats/123456789/messages", method="POST", body={"text": "Hey!"})`,
                },
                {
                  title: "Notifications",
                  id: "notifications",
                  code: `notifs = crm_get(f"/accounts/{USER_ID}/notifications", params={"limit": 10})
print(f"Notifications: {notifs.get('count', 0)}")
for n in notifs.get("notifications", []):
    print(f"  - {n.get('text', '?')}")`,
                },
              ].map((example) => (
                <div key={example.id}>
                  <div className="flex items-center justify-between mb-1">
                    <p className="text-xs font-semibold text-default-500">{example.title}</p>
                    <Button
                      size="sm"
                      variant="light"
                      startContent={copiedPython === example.id ? <PxCheck className="h-3 w-3" /> : <PxCopy className="h-3 w-3" />}
                      onPress={() => {
                        navigator.clipboard.writeText(example.code);
                        setCopiedPython(example.id);
                        setTimeout(() => setCopiedPython(null), 2000);
                      }}
                      className="text-xs h-6"
                    >
                      {copiedPython === example.id ? "Copied" : "Copy"}
                    </Button>
                  </div>
                  <pre className="overflow-auto dashboard-code-block p-3 text-xs font-mono max-h-64 styled-scrollbar">
                    {example.code}
                  </pre>
                </div>
              ))}
            </div>
          )}
        </CardBody>
      </Card>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
        {/* Endpoint list — boxed aside */}
        <div className="lg:col-span-4 xl:col-span-3" data-tour="api-docs-list">
          <div className="bg-[#0d0d0d] border border-white/[0.06] flex flex-col max-h-[80vh]">
            {/* Aside header */}
            <div className="p-3 border-b border-white/[0.06]">
              <div className="flex items-center gap-2 mb-3">
                <PxBookOpen className="h-4 w-4 text-[color:var(--theme-accent,#f54900)]" />
                <span className="text-xs font-bold uppercase tracking-wider text-foreground">Endpoints</span>
                <span className="text-[10px] text-default-500 ml-auto tabular-nums">{filteredEndpoints.length} total</span>
              </div>

              {/* Tabs inside aside */}
              <div className="flex gap-1 mb-2.5">
                <button
                  onClick={() => switchTab("crm")}
                  className={`flex-1 text-[10px] font-bold uppercase tracking-wider py-1.5 px-2 text-center transition-colors ${
                    tab === "crm"
                      ? "text-white"
                      : "bg-white/[0.04] text-default-500 hover:text-foreground hover:bg-white/[0.06]"
                  }`}
                  style={tab === "crm" ? { backgroundColor: "var(--theme-accent, #f54900)" } : undefined}
                >
                  CRM API ({crmEndpoints.length})
                </button>
                <button
                  onClick={() => switchTab("of")}
                  className={`flex-1 text-[10px] font-bold uppercase tracking-wider py-1.5 px-2 text-center transition-colors ${
                    tab === "of"
                      ? "text-white"
                      : "bg-white/[0.04] text-default-500 hover:text-foreground hover:bg-white/[0.06]"
                  }`}
                  style={tab === "of" ? { backgroundColor: "var(--theme-accent, #f54900)" } : undefined}
                >
                  OF Proxy ({ofEndpoints.length})
                </button>
              </div>

              {/* Search inside aside */}
              <div className="relative">
                <input
                  type="text"
                  placeholder="Search..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full bg-white/[0.04] border border-white/[0.06] px-2.5 py-1.5 text-xs font-mono text-foreground placeholder:text-default-500 focus:outline-none focus:border-[color:rgba(var(--theme-accent-rgb,245,73,0),0.4)] transition-colors"
                />
                {searchQuery && (
                  <button
                    onClick={() => setSearchQuery("")}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-default-500 hover:text-foreground text-xs"
                  >
                    ✕
                  </button>
                )}
              </div>
            </div>

            {/* Scrollable endpoint list */}
            <div className="flex-1 overflow-y-auto styled-scrollbar p-1.5">
              {categories.length === 0 && (
                <p className="text-xs text-default-500 py-8 text-center">No endpoints found.</p>
              )}
              {categories.map((cat) => {
                const catEndpoints = filteredEndpoints.filter((ep) => ep.category === cat);
                const isCollapsed = collapsedCategories.has(cat);

                return (
                  <div key={cat} className="mb-1">
                    {/* Category header */}
                    <button
                      onClick={() => toggleCategory(cat)}
                      className="w-full flex items-center justify-between py-1.5 px-2 group hover:bg-white/[0.02] transition-colors"
                    >
                      <div className="flex items-center gap-2">
                        <div className="w-1 h-1" style={{ backgroundColor: "var(--theme-accent, #f54900)" }} />
                        <span className="text-[10px] font-bold text-[color:var(--theme-accent,#f54900)] uppercase tracking-wider">
                          {cat}
                        </span>
                        <span className="text-[10px] text-default-600 bg-white/[0.04] px-1.5 py-0 tabular-nums">
                          {catEndpoints.length}
                        </span>
                      </div>
                      {isCollapsed ? (
                        <PxChevronDown className="h-3 w-3 text-default-500 opacity-0 group-hover:opacity-100 transition-opacity" />
                      ) : (
                        <PxChevronUp className="h-3 w-3 text-default-500 opacity-0 group-hover:opacity-100 transition-opacity" />
                      )}
                    </button>

                    {/* Endpoints */}
                    {!isCollapsed && (
                      <div className="space-y-0.5 mb-1">
                        {catEndpoints.map((ep, i) => {
                          const isSelected = selectedEndpoint === ep;
                          return (
                            <button
                              key={`${ep.method}-${ep.path}-${i}`}
                              onClick={() => selectEndpoint(ep)}
                              className={`w-full text-left px-2.5 py-1.5 transition-all group/item ${
                                isSelected
                                  ? "border-l-2"
                                  : "hover:bg-white/[0.03] border-l-2 border-l-transparent"
                              }`}
                              style={isSelected ? { backgroundColor: "rgba(var(--theme-accent-rgb, 245, 73, 0), 0.1)", borderLeftColor: "var(--theme-accent, #f54900)" } : undefined}
                            >
                              <div className="flex items-center gap-2 min-w-0">
                                <span className={`text-[10px] font-bold px-1.5 py-0.5 border shrink-0 leading-none ${methodBadgeClass[ep.method] || "bg-white/10 text-white/60 border-white/10"}`}>
                                  {ep.method}
                                </span>
                                <span className={`text-[11px] font-mono truncate ${isSelected ? "text-foreground" : "text-default-500 group-hover/item:text-default-300"}`}>
                                  {ep.path.split("?")[0]}
                                </span>
                              </div>
                              <p className={`text-[10px] mt-0.5 pl-0.5 truncate ${isSelected ? "text-default-400" : "text-default-600"}`}>
                                {ep.description}
                              </p>
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Aside footer */}
            <div className="px-3 py-2 border-t border-white/[0.06] flex items-center gap-1.5">
              <PxCode2 className="h-3 w-3 text-default-500" />
              <span className="text-[10px] text-default-500">
                {tab === "crm" ? "CRM REST API" : "OF API via Proxy"}
              </span>
            </div>
          </div>
        </div>

        {/* Playground — sticky on desktop */}
        <div className="lg:col-span-8 xl:col-span-9" data-tour="api-docs-tryit">
          <div className="lg:sticky lg:top-4 space-y-4">
            {/* Request card — with endpoint header inside */}
            <div className="bg-[#0d0d0d] border border-white/[0.06]">
              {/* Endpoint header */}
              <div className="flex items-center gap-3 px-4 py-3 border-b border-white/[0.06]">
                <PxPlay className="h-4 w-4 text-[color:var(--theme-accent,#f54900)] shrink-0" />
                <span className={`text-[10px] font-bold px-2 py-0.5 border shrink-0 ${methodBadgeClass[selectedEndpoint.method] || ""}`}>
                  {selectedEndpoint.method}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-mono text-foreground truncate">{selectedEndpoint.path.split("?")[0]}</p>
                </div>
              </div>
              <div className="px-4 py-2 border-b border-white/[0.06] bg-white/[0.01]">
                <p className="text-xs text-default-400">{selectedEndpoint.description}</p>
              </div>

              {/* Request body */}
              <div className="p-4 space-y-3">
                {/* Full URL preview */}
                <div className="flex items-center gap-1.5 text-[11px] text-default-500 font-mono bg-white/[0.03] border border-white/[0.04] px-3 py-1.5 overflow-x-auto styled-scrollbar">
                  <span className="text-default-600 shrink-0">{customMethod}</span>
                  <span className="text-default-400">/api/crm/{session?.user?.crmId || "{crm_id}"}</span>
                  <span className="text-foreground">{customPath.split("?")[0]}</span>
                  {customPath.includes("?") && (
                    <span className="text-default-500">?{customPath.split("?")[1]}</span>
                  )}
                </div>

                <div className="flex gap-2">
                  <Select
                    size="sm"
                    variant="bordered"
                    selectedKeys={[customMethod]}
                    onChange={(e) => setCustomMethod(e.target.value)}
                    className="w-28"
                    aria-label="HTTP Method"
                    classNames={{ trigger: "rounded-none" }}
                  >
                    <SelectItem key="GET">GET</SelectItem>
                    <SelectItem key="POST">POST</SelectItem>
                    <SelectItem key="PUT">PUT</SelectItem>
                    <SelectItem key="PATCH">PATCH</SelectItem>
                    <SelectItem key="DELETE">DELETE</SelectItem>
                  </Select>
                  <Input
                    size="sm"
                    variant="bordered"
                    value={customPath}
                    onValueChange={setCustomPath}
                    className="flex-1 font-mono"
                    classNames={{ inputWrapper: "rounded-none" }}
                  />
                </div>

                {(customMethod === "POST" ||
                  customMethod === "PUT" ||
                  customMethod === "PATCH") && (
                  <Textarea
                    label="Request Body (JSON)"
                    value={customBody}
                    onValueChange={setCustomBody}
                    variant="bordered"
                    className="font-mono"
                    minRows={3}
                    classNames={{ inputWrapper: "rounded-none" }}
                  />
                )}

                <div className="flex gap-2 flex-wrap">
                  <Button
                    className="dashboard-btn-primary text-white rounded-none uppercase tracking-wider font-bold"
                    size="sm"
                    startContent={<PxPlay className="h-4 w-4" />}
                    isLoading={loading}
                    isDisabled={!selectedAccount || passthroughBlocked}
                    onPress={executeRequest}
                  >
                    Send Request
                  </Button>
                  <Button
                    size="sm"
                    variant="bordered"
                    className="bg-transparent border border-white/[0.08] rounded-none hover:border-[color:rgba(var(--theme-accent-rgb,245,73,0),0.3)]"
                    startContent={
                      copied ? (
                        <PxCheck className="h-4 w-4" />
                      ) : (
                        <PxCopy className="h-4 w-4" />
                      )
                    }
                    onPress={() => copyToClipboard(generateCurl())}
                  >
                    {copied ? "Copied!" : "Copy cURL"}
                  </Button>
                  <Button
                    size="sm"
                    variant="bordered"
                    className="bg-transparent border border-white/[0.08] rounded-none hover:border-[color:rgba(var(--theme-accent-rgb,245,73,0),0.3)]"
                    startContent={copiedAi ? <PxCheck className="h-4 w-4" /> : <PxCopy className="h-4 w-4" />}
                    onPress={() => {
                      navigator.clipboard.writeText(generateAiMarkdown());
                      setCopiedAi(true);
                      setTimeout(() => setCopiedAi(false), 2000);
                    }}
                  >
                    {copiedAi ? "Copied!" : "Copy for AI"}
                  </Button>
                </div>

                {passthroughBlocked && selectedAccount && (
                  <div className="bg-[#0d0d0d] border border-white/[0.08] px-3 py-2.5">
                    <p className="text-xs text-default-400">
                      {`The OnlyFans API passthrough isn't available for ${platformLabel(selectedAccount.platform)} accounts. Use the CRM API endpoints instead.`}
                    </p>
                  </div>
                )}

                {!selectedAccount && (
                  <p className="text-xs text-warning">
                    Select an account from the header to send requests.
                  </p>
                )}
              </div>
            </div>

            {/* Response */}
            {response && (
              <div className="bg-[#0d0d0d] border border-white/[0.06]">
                  <div className="flex items-center justify-between px-4 py-2.5 border-b border-white/[0.06]">
                    <div className="flex items-center gap-2">
                      <h3 className="text-xs font-semibold uppercase tracking-wider">Response</h3>
                      {response.error ? (
                        <span className="text-[10px] px-1.5 py-0.5 bg-red-500/15 text-red-400 border border-red-500/20 font-mono">ERROR</span>
                      ) : (
                        <span className="text-[10px] px-1.5 py-0.5 bg-emerald-500/15 text-emerald-400 border border-emerald-500/20 font-mono">OK</span>
                      )}
                    </div>
                    <Button
                      size="sm"
                      variant="light"
                      className="text-xs h-6"
                      startContent={copiedResponse ? <PxCheck className="h-3 w-3" /> : <PxCopy className="h-3 w-3" />}
                      onPress={() => {
                        navigator.clipboard.writeText(JSON.stringify(response, null, 2));
                        setCopiedResponse(true);
                        setTimeout(() => setCopiedResponse(false), 2000);
                      }}
                    >
                      {copiedResponse ? "Copied" : "Copy"}
                    </Button>
                  </div>
                  <pre className="overflow-auto p-4 text-xs font-mono max-h-[400px] bg-[#0a0a0a] styled-scrollbar">
                    {JSON.stringify(response, null, 2)}
                  </pre>
                </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
