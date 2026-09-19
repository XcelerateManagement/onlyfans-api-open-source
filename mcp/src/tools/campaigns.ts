import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolCtx } from "./index.js";
import { toResult, untrustedWrap } from "./_shape.js";
import { Limit, Offset, OfUserId } from "../schemas/common.js";
import { consume } from "../ratelimit.js";

export function registerCampaignTools(server: McpServer, ctx: ToolCtx): void {
  server.registerTool(
    "of_list_campaigns",
    {
      title: "List tracking-link campaigns",
      description:
        "List campaigns (= **tracking links** / **referral codes** / **promo links**) for one OF account. " +
        "Each row has: id, name, campaignCode (the slug appended to the public URL: onlyfans.com/<username>/c<code>), shortLink, " +
        "countClicks (link hits), countSubscribers (people who actually subscribed via the link). " +
        "LIVE OF call — hits OnlyFans directly and is rate-limited upstream. For revenue per campaign, pair with `of_get_campaign_earnings` (local DB read, free). " +
        "For a per-claimer drill-down, use `of_list_campaign_claimers(cached=true)`.",
      inputSchema: {
        of_user_id: OfUserId,
        limit: Limit.default(10),
        offset: Offset.default(0),
        with_stats: z.boolean().default(true),
        with_deleted: z.boolean().default(false),
      },
    },
    async ({ of_user_id, limit, offset, with_stats, with_deleted }) => {
      const data = await ctx.flask.get(
        `/api/crm/${ctx.flask.crmId}/accounts/${of_user_id}/campaigns`,
        {
          query: {
            limit,
            offset,
            stats: with_stats ? "true" : "false",
            with_deleted: with_deleted ? 1 : 0,
          },
        },
      );
      return toResult(data);
    },
  );

  server.registerTool(
    "of_create_campaign",
    {
      title: "Create a tracking-link campaign",
      description: "Create a new tracking-link campaign on OnlyFans. The response includes the campaignCode you append to your OF profile URL (e.g. onlyfans.com/<username>/c<code>).",
      inputSchema: {
        of_user_id: OfUserId,
        name: z.string().min(1).max(120),
      },
    },
    async ({ of_user_id, name }) => {
      const data = await ctx.flask.post(
        `/api/crm/${ctx.flask.crmId}/accounts/${of_user_id}/campaigns`,
        { body: { name } },
      );
      return toResult(data);
    },
  );

  server.registerTool(
    "of_list_campaign_claimers",
    {
      title: "Fans who subscribed via a tracking link (with their lifetime spend)",
      description:
        "List fans who subscribed via a given tracking-link campaign. **This is the per-fan attribution.** " +
        "Per-row fields: fan_of_user_id, fan_username (untrusted), claimed_at (when they subscribed via the link), " +
        "**total_spent** (the fan's LIFETIME total — OnlyFans' subscribedOnData.totalSumm — including tips, PPV, posts, subscriptions, streams), " +
        "**mapped_spent** (same number from local transactions_cache; should equal total_spent when sync is fresh). " +
        "**Date range** (cached path only): since='YYYY-MM-DD' / until='YYYY-MM-DD' filter on claimed_at " +
        "— answers 'who claimed this campaign last week?'. " +
        "Use this to answer 'who are the top fans from campaign X' or 'which fan brought the most revenue through this link'. " +
        "cached=true reads the local DB (use by default). cached=false hits OF live — use only for fresh-data requests. The live path is OnlyFans only: Fansly has no per-link claimer enumeration, so cached=false is rejected for Fansly accounts.",
      inputSchema: {
        of_user_id: OfUserId,
        campaign_id: z.string().min(1).max(64),
        cached: z.boolean().default(true),
        since: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}( \d{2}:\d{2}:\d{2})?$/)
          .optional()
          .describe("Inclusive lower bound on claimed_at (cached path only)."),
        until: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}( \d{2}:\d{2}:\d{2})?$/)
          .optional()
          .describe("Inclusive upper bound on claimed_at (cached path only)."),
        limit: Limit.default(100),
        offset: Offset.default(0),
      },
    },
    async ({ of_user_id, campaign_id, cached, since, until, limit, offset }) => {
      const path = cached
        ? `/api/crm/${ctx.flask.crmId}/accounts/${of_user_id}/campaigns/${campaign_id}/claimers/cached`
        : `/api/crm/${ctx.flask.crmId}/accounts/${of_user_id}/campaigns/${campaign_id}/claimers`;
      const data = await ctx.flask.get<{ list?: any[]; claimers?: any[] }>(path, {
        query: cached ? { since, until, limit, offset } : { limit, offset },
      });
      const list = data.list ?? data.claimers ?? [];
      const trimmed = (list as any[]).map((c) => ({
        fan_of_user_id: c.fan_of_user_id ?? c.id,
        fan_username: untrustedWrap(c.fan_username ?? c.username),
        claimed_at: c.claimed_at ?? null,
        total_spent: c.total_spent ?? null,
        mapped_spent: c.mapped_spent ?? null,
      }));
      return toResult({ claimers: trimmed, total: list.length });
    },
  );

  server.registerTool(
    "of_get_campaign_earnings",
    {
      title: "Revenue per tracking link (campaign ROI)",
      description:
        "Per-tracking-link revenue summary for ONE OF account. **This is the canonical 'how much did each tracking link make' answer.** " +
        "Returns an `earnings` array, one row per campaign: " +
        "  - campaign_id (pair with `of_list_campaigns` to get the name + shortLink) " +
        "  - claimers_count: how many fans joined via this link " +
        "  - mapped_claimers_count: how many of those have spending data we've synced " +
        "  - **total_spent**: sum of those mapped claimers' LIFETIME spend (tips + PPV + posts + subscriptions). This is the revenue attributable to the link. " +
        "  - coverage_pct: mapped/claimers × 100. If < 100, run `of_refresh_subscribers` to fill in the missing rows. " +
        "Free (DB only — no OF call). Sort `earnings` client-side by total_spent for 'best tracking link'. " +
        "For cross-account 'best tracking link overall', loop accounts and merge — there's no panel-wide aggregate today.",
      inputSchema: { of_user_id: OfUserId },
    },
    async ({ of_user_id }) => {
      const data = await ctx.flask.get(
        `/api/crm/${ctx.flask.crmId}/accounts/${of_user_id}/campaigns/earnings`,
      );
      return toResult(data);
    },
  );

  server.registerTool(
    "of_refresh_campaigns",
    {
      title: "Refresh campaign claimers cache",
      description: "Kick off a background sync of every campaign's claimers list. Returns a refresh_id; poll with of_get_refresh_status(kind=\"campaigns\"). Expensive — once per minute per account at most.",
      inputSchema: { of_user_id: OfUserId },
    },
    async ({ of_user_id }) => {
      consume(ctx.flask.crmId, "of_refresh_campaigns");
      const data = await ctx.flask.post(
        `/api/crm/${ctx.flask.crmId}/accounts/${of_user_id}/campaigns/refresh`,
        { body: {} },
      );
      return toResult(data);
    },
  );
}
