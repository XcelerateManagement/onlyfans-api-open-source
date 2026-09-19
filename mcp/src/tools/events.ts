import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolCtx } from "./index.js";
import { toResult, untrustedWrap } from "./_shape.js";
import { Limit, OfUserId } from "../schemas/common.js";

const EventType = z.enum([
  "new_subscriber",
  "renewed_subscriber",
  "expired_subscriber",
  "new_tip",
  "new_message",
  "new_purchase",
  "balance_increased",
  "payout_completed",
  "polling_paused",
]);

export function registerEventTools(server: McpServer, ctx: ToolCtx): void {
  server.registerTool(
    "of_list_events",
    {
      title: "List recent activity events (cursor-paginated)",
      description:
        "List activity events emitted by the background poller — local DB read, no live OF call. " +
        "Pass since=<event id from the prior response's next_since> to fetch newer events, OR since=<ISO-8601 timestamp> for a date bound. " +
        "Filter by types: new_subscriber, renewed_subscriber, expired_subscriber, new_tip, new_message, new_purchase, balance_increased, payout_completed, polling_paused. " +
        "Returns events[] + next_since. Re-call with the new next_since to tail.",
      inputSchema: {
        since: z.string().min(1).max(64).optional(),
        types: z.array(EventType).optional(),
        of_user_id: OfUserId.optional(),
        limit: Limit.default(100),
      },
    },
    async ({ since, types, of_user_id, limit }) => {
      const data = await ctx.flask.get<{ events?: any[] }>(
        `/api/crm/${ctx.flask.crmId}/events`,
        {
          query: {
            since,
            type: types?.join(","),
            of_user_id,
            limit,
          },
        },
      );
      const raw = data.events ?? [];
      // Trim payloads — wrap any user-controlled string (fan username, message
      // text, description) so the model treats it as data, not instructions.
      const events = raw.map((e: any) => {
        const p = (e?.payload ?? {}) as Record<string, unknown>;
        const safePayload: Record<string, unknown> = { ...p };
        if (p.fan && typeof p.fan === "object") {
          const f = p.fan as Record<string, unknown>;
          safePayload.fan = {
            ...f,
            username: f.username !== undefined ? untrustedWrap(f.username) : undefined,
            display_name: f.display_name !== undefined ? untrustedWrap(f.display_name) : undefined,
            name: f.name !== undefined ? untrustedWrap(f.name) : undefined,
          };
        }
        for (const k of ["text", "message", "description", "note"]) {
          if (typeof (p as Record<string, unknown>)[k] === "string") {
            safePayload[k] = untrustedWrap(p[k]);
          }
        }
        return {
          id: e.id,
          event_type: e.event_type,
          occurred_at: e.occurred_at,
          of_user_id: e.of_user_id,
          payload: safePayload,
        };
      });
      const newestId = events.length > 0 ? (events[0] as any).id ?? null : null;
      return toResult({
        events,
        count: events.length,
        next_since: newestId,
      });
    },
  );
}
