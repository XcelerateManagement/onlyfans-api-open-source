import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolCtx } from "./index.js";
import { toResult } from "./_shape.js";
import { FanId, Limit, Offset, OfUserId } from "../schemas/common.js";
import { consume } from "../ratelimit.js";

const TxType = z.enum([
  "tip",
  "message",
  "post",
  "subscription",
  "renewal",
  "stream",
  "chargeback",
]);

const DateString = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}( \d{2}:\d{2}:\d{2})?$/)
  .describe("YYYY-MM-DD or 'YYYY-MM-DD HH:MM:SS' UTC.");

export function registerTransactionTools(server: McpServer, ctx: ToolCtx): void {
  server.registerTool(
    "of_list_purchases",
    {
      title: "List purchases (live)",
      description:
        "Fetch recent purchases from OF — LIVE call, rate-limited upstream. " +
        "Pass since='YYYY-MM-DD' to bound the start date. Use the response's `marker` to fetch the next page. " +
        "For repeated reads + tx-type filtering use `of_list_transactions_cached` instead — same data, no live OF call.",
      inputSchema: {
        of_user_id: OfUserId,
        limit: Limit.default(50),
        since: DateString.optional().describe("startDate forwarded to OF."),
        marker: z.string().max(128).optional().describe("Pagination marker from a previous response."),
      },
    },
    async ({ of_user_id, limit, since, marker }) => {
      const data = await ctx.flask.get(
        `/api/crm/${ctx.flask.crmId}/accounts/${of_user_id}/purchases`,
        { query: { limit, startDate: since, marker } },
      );
      return toResult(data);
    },
  );

  server.registerTool(
    "of_list_transactions_cached",
    {
      title: "List cached transactions",
      description:
        "Cached transactions ledger for one OF account — local DB read, no live OF call. " +
        "Filter by type ('tip' / 'message' / 'post' / 'subscription' / 'renewal' / 'stream' / 'chargeback'). " +
        "Date range: since='YYYY-MM-DD' is inclusive lower bound, until='YYYY-MM-DD' is inclusive upper bound. " +
        "For a single day pass since='2026-04-15' until='2026-04-15'. " +
        "Filter by fan_of_user_id for one fan. " +
        "Each row has amount, net, fee, vat_amount, tx_type, fan_of_user_id, created_at. " +
        "Amount filtering must be done client-side after fetch. Limit max 500.",
      inputSchema: {
        of_user_id: OfUserId,
        type: TxType.optional(),
        since: DateString.optional().describe("Inclusive lower bound on created_at."),
        until: DateString.optional().describe("Inclusive upper bound on created_at."),
        fan_of_user_id: FanId.optional(),
        limit: Limit.default(100),
        offset: Offset.default(0),
      },
    },
    async ({ of_user_id, type, since, until, fan_of_user_id, limit, offset }) => {
      const data = await ctx.flask.get(
        `/api/crm/${ctx.flask.crmId}/accounts/${of_user_id}/transactions/cached`,
        {
          query: {
            type,
            since,
            until,
            fan_id: fan_of_user_id,
            limit,
            offset,
          },
        },
      );
      return toResult(data);
    },
  );

  server.registerTool(
    "of_refresh_transactions",
    {
      title: "Refresh transactions cache from OF",
      description: "Kick off a background refresh of the transactions ledger. Returns a refresh_id. Poll of_get_refresh_status. Expensive.",
      inputSchema: { of_user_id: OfUserId },
    },
    async ({ of_user_id }) => {
      consume(ctx.flask.crmId, "of_refresh_transactions");
      const data = await ctx.flask.post(
        `/api/crm/${ctx.flask.crmId}/accounts/${of_user_id}/transactions/refresh`,
        { body: {} },
      );
      return toResult(data);
    },
  );

  server.registerTool(
    "of_get_refresh_status",
    {
      title: "Poll an async refresh job",
      description:
        "Check the status of a background refresh kicked off by `of_refresh_subscribers` / `of_refresh_transactions` / `of_refresh_campaigns`. " +
        "Pass kind to match the refresh you started. Poll every 5–10 seconds until status='completed' or 'error'. " +
        "Returns progress %, started_at, completed_at, error_snippet if any.",
      inputSchema: {
        of_user_id: OfUserId,
        kind: z.enum(["subscribers", "transactions", "campaigns"]),
      },
    },
    async ({ of_user_id, kind }) => {
      const path =
        kind === "subscribers"
          ? `/api/crm/${ctx.flask.crmId}/accounts/${of_user_id}/subscribers/refresh/status`
          : kind === "transactions"
            ? `/api/crm/${ctx.flask.crmId}/accounts/${of_user_id}/transactions/refresh/status`
            : `/api/crm/${ctx.flask.crmId}/accounts/${of_user_id}/campaigns/refresh/status`;
      const data = await ctx.flask.get(path);
      return toResult(data);
    },
  );

  server.registerTool(
    "of_list_active_refreshes",
    {
      title: "List in-progress refresh jobs",
      description: "List every refresh job in flight for this CRM panel.",
      inputSchema: {},
    },
    async () => {
      const data = await ctx.flask.get(`/api/crm/${ctx.flask.crmId}/refresh/active`);
      return toResult(data);
    },
  );
}
