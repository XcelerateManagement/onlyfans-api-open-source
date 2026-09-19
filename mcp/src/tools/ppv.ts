import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolCtx } from "./index.js";
import { toResult } from "./_shape.js";
import { OfUserId } from "../schemas/common.js";
import { consume } from "../ratelimit.js";

const DateString = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}( \d{2}:\d{2}:\d{2})?$/)
  .describe("YYYY-MM-DD or 'YYYY-MM-DD HH:MM:SS' UTC.");

export function registerPpvTools(server: McpServer, ctx: ToolCtx): void {
  server.registerTool(
    "of_get_ppv_stats",
    {
      title: "PPV conversion stats for an OF account",
      description:
        "Compute PPV (pay-per-view) conversion rate for one OF account in a date range. " +
        "conversion_rate = paid PPVs (from transactions_cache) ÷ PPV messages sent (counted by walking recent chats). " +
        "Expensive: walks up to max_chats chats × max_messages_per_chat messages — keep max_chats ≤ 25 for fast results. " +
        "Cached for 1 hour per (account, period). " +
        "Limitation: when max_chats is small, ppv_sent under-counts (some fans' chats may be outside the recent window) — treat conversion_rate as a lower bound. " +
        "Returns ppv_sent, ppv_paid, ppv_revenue, conversion_rate, chats_sampled, per_fan breakdown.",
      inputSchema: {
        of_user_id: OfUserId,
        since: DateString.optional(),
        until: DateString.optional(),
        max_chats: z.number().int().min(1).max(50).default(25),
        max_messages_per_chat: z.number().int().min(1).max(500).default(200),
      },
    },
    async ({ of_user_id, since, until, max_chats, max_messages_per_chat }) => {
      consume(ctx.flask.crmId, "of_get_ppv_stats");
      const data = await ctx.flask.get(
        `/api/crm/${ctx.flask.crmId}/accounts/${of_user_id}/ppv-stats`,
        {
          query: {
            since,
            until,
            max_chats,
            max_messages_per_chat,
          },
        },
      );
      return toResult(data);
    },
  );
}
