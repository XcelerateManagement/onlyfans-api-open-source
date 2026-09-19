import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolCtx } from "./index.js";
import { toResult } from "./_shape.js";
import { ConfirmFlag, IdempotencyKey, Limit, Offset } from "../schemas/common.js";
import { consume } from "../ratelimit.js";

function maskSecret(webhook: any, reveal: boolean) {
  if (!webhook) return webhook;
  const out = { ...webhook };
  if (out.secret && !reveal) out.secret = "wh_***";
  return out;
}

export function registerWebhookTools(server: McpServer, ctx: ToolCtx): void {
  server.registerTool(
    "of_list_webhooks",
    {
      title: "List webhooks",
      description: "List every webhook subscription for this CRM panel. Secrets are masked unless reveal_secret=true.",
      inputSchema: { reveal_secret: z.boolean().default(false) },
    },
    async ({ reveal_secret }) => {
      const data = await ctx.flask.get<{ webhooks?: any[] }>(`/api/crm/${ctx.flask.crmId}/webhooks`);
      return toResult({
        webhooks: (data.webhooks ?? []).map((w) => maskSecret(w, reveal_secret)),
      });
    },
  );

  server.registerTool(
    "of_get_webhook",
    {
      title: "Get one webhook",
      description: "Fetch a single webhook subscription. Secret masked unless reveal_secret=true.",
      inputSchema: {
        webhook_id: z.number().int().positive(),
        reveal_secret: z.boolean().default(false),
      },
    },
    async ({ webhook_id, reveal_secret }) => {
      const data = await ctx.flask.get<{ webhook?: any }>(`/api/crm/${ctx.flask.crmId}/webhooks/${webhook_id}`);
      return toResult({ webhook: maskSecret(data.webhook ?? data, reveal_secret) });
    },
  );

  server.registerTool(
    "of_create_webhook",
    {
      title: "Create a webhook subscription",
      description: "Create a new webhook. Starts in pending state until an admin approves the destination domain. event_types is an array; '*' means all events.",
      inputSchema: {
        url: z.string().url(),
        event_types: z.array(z.string().min(1).max(64)).min(1).max(32),
        description: z.string().max(500).optional(),
        idempotency_key: IdempotencyKey,
      },
    },
    async ({ url, event_types, description, idempotency_key }) => {
      const data = await ctx.flask.post(
        `/api/crm/${ctx.flask.crmId}/webhooks`,
        {
          body: { url, event_types, description },
          extraHeaders: idempotency_key ? { "Idempotency-Key": idempotency_key } : undefined,
        },
      );
      return toResult(data);
    },
  );

  server.registerTool(
    "of_update_webhook",
    {
      title: "Update a webhook",
      description: "Patch url / event_types / description / is_active on an existing webhook.",
      inputSchema: {
        webhook_id: z.number().int().positive(),
        url: z.string().url().optional(),
        event_types: z.array(z.string().min(1).max(64)).min(1).max(32).optional(),
        description: z.string().max(500).optional(),
        is_active: z.boolean().optional(),
      },
    },
    async ({ webhook_id, ...rest }) => {
      const data = await ctx.flask.patch(
        `/api/crm/${ctx.flask.crmId}/webhooks/${webhook_id}`,
        { body: rest },
      );
      return toResult(data);
    },
  );

  server.registerTool(
    "of_delete_webhook",
    {
      title: "Delete a webhook",
      description: "Permanently delete a webhook subscription. Irreversible — requires confirm=true.",
      inputSchema: {
        webhook_id: z.number().int().positive(),
        confirm: ConfirmFlag,
      },
    },
    async ({ webhook_id, confirm }) => {
      if (!confirm) {
        return toResult({ dry_run: true, would_delete: webhook_id });
      }
      const data = await ctx.flask.delete(`/api/crm/${ctx.flask.crmId}/webhooks/${webhook_id}`);
      return toResult(data);
    },
  );

  server.registerTool(
    "of_test_webhook",
    {
      title: "Send a test webhook delivery",
      description: "Fire one test event at a webhook (must be approved). Useful to verify HMAC signing on the receiving end.",
      inputSchema: { webhook_id: z.number().int().positive() },
    },
    async ({ webhook_id }) => {
      consume(ctx.flask.crmId, "of_test_webhook");
      const data = await ctx.flask.post(
        `/api/crm/${ctx.flask.crmId}/webhooks/${webhook_id}/test`,
        { body: {} },
      );
      return toResult(data);
    },
  );

  server.registerTool(
    "of_list_webhook_deliveries",
    {
      title: "List webhook deliveries",
      description: "Recent delivery attempts for one webhook, with status, response_code, response_snippet, and next_retry_at.",
      inputSchema: {
        webhook_id: z.number().int().positive(),
        limit: Limit.default(50),
        offset: Offset.default(0),
      },
    },
    async ({ webhook_id, limit, offset }) => {
      const data = await ctx.flask.get(
        `/api/crm/${ctx.flask.crmId}/webhooks/${webhook_id}/deliveries`,
        { query: { limit, offset } },
      );
      return toResult(data);
    },
  );
}
