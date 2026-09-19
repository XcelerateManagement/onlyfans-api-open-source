import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolCtx } from "./index.js";
import { toResult } from "./_shape.js";

export function registerIntegrationTools(server: McpServer, ctx: ToolCtx): void {
  server.registerTool(
    "of_list_telegram_groups",
    {
      title: "List Telegram groups for a bot token",
      description: "Resolve a Telegram bot token + chat id to the groups the bot has access to. Used when wiring up a Telegram automation.",
      inputSchema: {
        bot_token: z.string().min(20).max(256),
        chat_id: z.string().min(1).max(64).optional(),
      },
    },
    async ({ bot_token, chat_id }) => {
      const data = await ctx.flask.post(
        `/api/crm/${ctx.flask.crmId}/integrations/telegram/groups`,
        { body: { bot_token, chat_id } },
      );
      return toResult(data);
    },
  );
}
