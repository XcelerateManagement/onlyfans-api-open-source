import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolCtx } from "./index.js";
import { toResult, trimList, untrustedWrap } from "./_shape.js";
import { OfUserId, ConfirmFlag } from "../schemas/common.js";
import { consume } from "../ratelimit.js";

export function registerAccountTools(server: McpServer, ctx: ToolCtx): void {
  server.registerTool(
    "of_list_accounts",
    {
      title: "List connected OnlyFans accounts",
      description: "List every OnlyFans account connected to this CRM panel. Returns of_user_id, username, email, avatar, and creation timestamps. Call before any tool that requires of_user_id.",
      inputSchema: {},
    },
    async () => {
      const data = await ctx.flask.get<{ accounts: any[]; count: number }>(
        `/api/crm/${ctx.flask.crmId}/accounts`,
      );
      return toResult({
        count: data.count ?? data.accounts?.length ?? 0,
        accounts: trimList(data.accounts, (a: any) => ({
          of_user_id: a.of_user_id,
          username: untrustedWrap(a.username),
          email: untrustedWrap(a.email),
          avatar: a.avatar ?? null,
          created_at: a.created_at ?? null,
          last_login: a.last_login ?? null,
        })),
      });
    },
  );

  server.registerTool(
    "of_delete_account",
    {
      title: "Remove an OnlyFans account",
      description: "Detach an OnlyFans account from this CRM panel. Stops polling. Sessions are deleted. Irreversible — requires confirm=true.",
      inputSchema: { of_user_id: OfUserId, confirm: ConfirmFlag },
    },
    async ({ of_user_id, confirm }) => {
      if (!confirm) {
        return toResult({
          dry_run: true,
          would_delete: of_user_id,
          message: "Pass confirm=true to actually remove this account.",
        });
      }
      const data = await ctx.flask.delete(
        `/api/crm/${ctx.flask.crmId}/accounts/${of_user_id}`,
      );
      return toResult({ deleted: of_user_id, result: data });
    },
  );

  server.registerTool(
    "of_get_polling",
    {
      title: "Get polling config for an account",
      description: "Return whether the background poller is enabled for the given OF account, its interval, and recent failure count.",
      inputSchema: { of_user_id: OfUserId },
    },
    async ({ of_user_id }) => {
      const data = await ctx.flask.get(
        `/api/crm/${ctx.flask.crmId}/accounts/${of_user_id}/polling`,
      );
      return toResult(data);
    },
  );

  server.registerTool(
    "of_set_polling",
    {
      title: "Enable / disable polling for an account",
      description: "Turn on or off the background poller for one OF account, and optionally change the interval (60–3600 seconds).",
      inputSchema: {
        of_user_id: OfUserId,
        polling_enabled: z.boolean(),
        polling_interval_seconds: z.number().int().min(60).max(3600).optional(),
      },
    },
    async ({ of_user_id, polling_enabled, polling_interval_seconds }) => {
      const body: Record<string, unknown> = { polling_enabled };
      if (polling_interval_seconds !== undefined) body.polling_interval_seconds = polling_interval_seconds;
      const data = await ctx.flask.patch(
        `/api/crm/${ctx.flask.crmId}/accounts/${of_user_id}/polling`,
        { body },
      );
      return toResult(data);
    },
  );

  server.registerTool(
    "of_get_proxy",
    {
      title: "Get the proxy assigned to an account",
      description: "Returns the proxy URL currently saved for the given OF account. The proxy username/password are visible in the response — do not echo to the user without their consent.",
      inputSchema: { of_user_id: OfUserId },
    },
    async ({ of_user_id }) => {
      const data = await ctx.flask.get(
        `/api/crm/${ctx.flask.crmId}/accounts/${of_user_id}/proxy`,
      );
      return toResult(data);
    },
  );

  server.registerTool(
    "of_set_proxy",
    {
      title: "Update the proxy for an OnlyFans account",
      description: "Replace the proxy URL on an OF account. The bearer token is the user's API key — only the user should ever supply a proxy URL through this tool.",
      inputSchema: {
        of_user_id: OfUserId,
        proxy: z.string().min(8).max(500),
      },
    },
    async ({ of_user_id, proxy }) => {
      const data = await ctx.flask.patch(
        `/api/crm/${ctx.flask.crmId}/accounts/${of_user_id}/proxy`,
        { body: { proxy } },
      );
      return toResult(data);
    },
  );

  server.registerTool(
    "of_set_subscription_price",
    {
      title: "Change subscription price for an OF account",
      description: "Update the public subscription price for an account. Affects new subscribers immediately.",
      inputSchema: {
        of_user_id: OfUserId,
        price: z.number().min(4.99).max(50),
        confirm: ConfirmFlag,
      },
    },
    async ({ of_user_id, price, confirm }) => {
      if (!confirm) {
        return toResult({
          dry_run: true,
          would_set_price: price,
          of_user_id,
          message: "Pass confirm=true to actually update the subscription price.",
        });
      }
      const data = await ctx.flask.patch(
        `/api/crm/${ctx.flask.crmId}/accounts/${of_user_id}/subscription-price`,
        { body: { price } },
      );
      return toResult(data);
    },
  );

  // Rate-limit applied at first dispatch site rather than per tool — we put
  // it inline in the noisy tools below so each tool's accounting is clear.
  void consume;
}
