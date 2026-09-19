import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolCtx } from "./index.js";
import { toResult } from "./_shape.js";
import { ConfirmFlag, IdempotencyKey, Limit, Offset, OfUserId, Period } from "../schemas/common.js";
import { consume } from "../ratelimit.js";

const DateString = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}( \d{2}:\d{2}:\d{2})?$/)
  .describe("YYYY-MM-DD or 'YYYY-MM-DD HH:MM:SS' UTC.");

export function registerEarningsTools(server: McpServer, ctx: ToolCtx): void {
  server.registerTool(
    "of_get_balances",
    {
      title: "Get payout balances",
      description: "Fetch current payoutAvailable / payoutPending balances for one OF account.",
      inputSchema: { of_user_id: OfUserId },
    },
    async ({ of_user_id }) => {
      const data = await ctx.flask.get(
        `/api/crm/${ctx.flask.crmId}/accounts/${of_user_id}/balances`,
      );
      return toResult(data);
    },
  );

  server.registerTool(
    "of_get_earnings_chart",
    {
      title: "Earnings chart for a date range",
      description: "Fetch the earnings chart data from OF for a date range. startDate must be YYYY-MM-DD or 'YYYY-MM-DD HH:MM:SS'.",
      inputSchema: {
        of_user_id: OfUserId,
        startDate: DateString,
        endDate: DateString.optional(),
        withTotal: z.boolean().default(true),
      },
    },
    async ({ of_user_id, startDate, endDate, withTotal }) => {
      const data = await ctx.flask.get(
        `/api/crm/${ctx.flask.crmId}/accounts/${of_user_id}/earnings`,
        {
          query: {
            startDate,
            endDate,
            withTotal: withTotal ? "true" : "false",
          },
        },
      );
      return toResult(data);
    },
  );

  server.registerTool(
    "of_get_earnings_summary",
    {
      title: "Total earnings (this period or any custom date range)",
      description:
        "Aggregated earnings across every connected OF account in the CRM panel. " +
        "**Default answer for vague questions** like 'what did I make', 'how much did I earn' — " +
        "call with period='month' and you'll get this month's total. " +
        "**For 'what about April 8 to 15?' or 'earnings on May 1st' pass startDate + endDate** " +
        "(YYYY-MM-DD). Both inclusive. " +
        "Returns: total (number, USD, net of fees), prev_total (whole previous period; " +
        "same-length window for custom ranges), prev_total_to_date (previous period up to the same " +
        "elapsed point — use this for 'am I up or down'), " +
        "by_category {tips, messages, posts, streams, subscriptions, referrals}, " +
        "by_category_platform (OnlyFans vs Fansly split), " +
        "new_subs {count, renewals, prev_count, by_platform} (new subscribers in the period, renewals excluded), " +
        "fansly_balance {current, available, pending} (Fansly wallet snapshot, not period earnings), " +
        "chart (per-day series), accounts_count, transactions_counted, period. " +
        "Live OF call — slower than the cached tools and rate-limited upstream.",
      inputSchema: {
        period: Period.default("month").describe("Used only if startDate/endDate not given."),
        startDate: DateString.optional().describe("Inclusive lower bound (overrides period)."),
        endDate: DateString.optional().describe("Inclusive upper bound (required with startDate)."),
      },
    },
    async ({ period, startDate, endDate }) => {
      const data = await ctx.flask.get(
        `/api/crm/${ctx.flask.crmId}/earnings/summary`,
        { query: { period, startDate, endDate } },
      );
      return toResult(data);
    },
  );

  server.registerTool(
    "of_get_payout_account",
    {
      title: "Get payout account details",
      description: "Fetch the bank/payout-method info OF has on file for one account. Sensitive — do not print account numbers to the user without their consent.",
      inputSchema: { of_user_id: OfUserId },
    },
    async ({ of_user_id }) => {
      const data = await ctx.flask.get(
        `/api/crm/${ctx.flask.crmId}/accounts/${of_user_id}/payout-account`,
      );
      return toResult(data);
    },
  );

  server.registerTool(
    "of_list_payout_requests",
    {
      title: "List payout requests (withdrawal history)",
      description:
        "Return prior payout/withdrawal requests for one OF account. " +
        "Each entry has status (pending / processing / completed / rejected), " +
        "requested_at, amount, etc. " +
        "**Use this to answer 'is my withdrawal still pending?', 'when did the last " +
        "payout clear?', 'what payouts happened in April?'**. " +
        "Date range: startDate='YYYY-MM-DD' and endDate='YYYY-MM-DD' are inclusive bounds, " +
        "forwarded directly to OF.",
      inputSchema: {
        of_user_id: OfUserId,
        startDate: DateString.optional().describe("Inclusive lower bound on request date."),
        endDate: DateString.optional().describe("Inclusive upper bound on request date."),
        limit: Limit.default(10),
        offset: Offset.default(0),
      },
    },
    async ({ of_user_id, startDate, endDate, limit, offset }) => {
      const data = await ctx.flask.get(
        `/api/crm/${ctx.flask.crmId}/accounts/${of_user_id}/payout-requests`,
        { query: { startDate, endDate, limit, offset } },
      );
      return toResult(data);
    },
  );

  server.registerTool(
    "of_create_payout_request",
    {
      title: "Create a payout request (write action)",
      description: "Submit a payout request for one OnlyFans account. OnlyFans only — Fansly accounts are rejected (payout READS work on both platforms). WRITE ACTION — requires confirm=true. The amount is determined by OF, not by this tool.",
      inputSchema: {
        of_user_id: OfUserId,
        confirm: ConfirmFlag,
        idempotency_key: IdempotencyKey,
      },
    },
    async ({ of_user_id, confirm, idempotency_key }) => {
      if (!confirm) {
        return toResult({
          dry_run: true,
          of_user_id,
          message: "Pass confirm=true to actually request a payout. OF determines the amount automatically.",
        });
      }
      consume(ctx.flask.crmId, "of_create_payout_request");
      const data = await ctx.flask.post(
        `/api/crm/${ctx.flask.crmId}/accounts/${of_user_id}/payout-requests`,
        {
          body: {},
          extraHeaders: idempotency_key ? { "Idempotency-Key": idempotency_key } : undefined,
        },
      );
      return toResult(data);
    },
  );
}
