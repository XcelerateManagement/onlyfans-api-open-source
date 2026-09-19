import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolCtx } from "./index.js";
import { toResult } from "./_shape.js";

export function registerIdentityTools(server: McpServer, ctx: ToolCtx): void {
  server.registerTool(
    "of_whoami",
    {
      title: "Who am I? (identity)",
      description:
        "Identify the current CRM panel. Returns crm_id, name and the mcp_unsafe_proxy flag. " +
        "Call first when starting an agent run to confirm which panel you are acting on.",
      inputSchema: {},
    },
    async () => {
      return toResult({
        crm_id: ctx.session.crmId,
        name: ctx.session.name ?? null,
        mcp_unsafe_proxy: ctx.session.mcpUnsafeProxy,
      });
    },
  );
}
