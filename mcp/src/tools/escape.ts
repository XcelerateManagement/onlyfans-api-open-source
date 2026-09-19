import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolCtx } from "./index.js";
import { toResult, toError } from "./_shape.js";
import { ConfirmFlag, OfUserId } from "../schemas/common.js";
import { consume } from "../ratelimit.js";
import type { HttpMethod } from "../flask/client.js";

const HttpMethodEnum = z.enum(["GET", "POST", "PATCH", "PUT", "DELETE"]);

export function registerEscapeTools(server: McpServer, ctx: ToolCtx): void {
  server.registerTool(
    "of_crm_request",
    {
      title: "Generic CRM API call (escape hatch)",
      description: "Call any CRM endpoint by (method, path, body). The crm_id segment is injected automatically — provide the path *after* /api/crm/<crm_id>. Admin and internal paths are blocked. Non-GET methods require confirm=true. Prefer a domain tool when one exists.",
      inputSchema: {
        method: HttpMethodEnum.default("GET"),
        path: z
          .string()
          .min(1)
          .max(512)
          .regex(/^\//, "Path must start with /")
          .describe("Path under /api/crm/<crm_id>/. Pass the leading slash (e.g. '/accounts')."),
        body: z.record(z.unknown()).optional(),
        query: z.record(z.union([z.string(), z.number(), z.boolean()])).optional(),
        confirm: z.boolean().default(false),
      },
    },
    async ({ method, path, body, query, confirm }) => {
      consume(ctx.flask.crmId, "of_crm_request");
      const fullPath = `/api/crm/${ctx.flask.crmId}${path}`;
      const isMutation = method !== "GET";
      if (isMutation && !confirm) {
        return toResult({
          dry_run: true,
          would_call: `${method} ${fullPath}`,
          message: "Pass confirm=true to perform this mutation.",
        });
      }
      try {
        const data = await ctx.flask.call(
          method as HttpMethod,
          fullPath,
          { body, query: query as any, allowMutation: isMutation },
        );
        return toResult({ method, path: fullPath, response: data });
      } catch (e) {
        return toError((e as Error).message);
      }
    },
  );

  server.registerTool(
    "of_proxy_request",
    {
      title: "Generic OnlyFans API call via proxy (escape hatch)",
      description: "Proxy an arbitrary call to the OnlyFans /api2/v2 surface for one connected account. GET is always allowed. Non-GET methods require both confirm=true AND the per-CRM mcp_unsafe_proxy flag to be enabled — toggle that on the dashboard MCP page. Use only when no dedicated tool fits.",
      inputSchema: {
        of_user_id: OfUserId,
        method: HttpMethodEnum.default("GET"),
        of_path: z
          .string()
          .min(1)
          .max(512)
          .regex(/^\//, "of_path must start with /"),
        body: z.record(z.unknown()).optional(),
        query: z.record(z.union([z.string(), z.number(), z.boolean()])).optional(),
        confirm: ConfirmFlag.default(false),
      },
    },
    async ({ of_user_id, method, of_path, body, query, confirm }) => {
      consume(ctx.flask.crmId, "of_proxy_request");
      const isMutation = method !== "GET";
      if (isMutation) {
        if (!ctx.flask.unsafeProxyEnabled) {
          return toError(
            "Non-GET proxy calls are disabled for this CRM. Toggle 'Advanced — allow MCP write proxy' on /dashboard/mcp first.",
          );
        }
        if (!confirm) {
          return toResult({
            dry_run: true,
            would_call: `${method} ${of_path}`,
            of_user_id,
            message: "Pass confirm=true to perform this mutation.",
          });
        }
      }
      // Strip leading /api2/v2 so the user can pass either form.
      const normalised = of_path.replace(/^\/api2\/v2/, "");
      try {
        const data = await ctx.flask.call(
          method as HttpMethod,
          `/api/crm/${ctx.flask.crmId}/accounts/${of_user_id}/request`,
          {
            body: { path: `/api2/v2${normalised}`, method, body, query },
            allowMutation: true, // Flask's /request endpoint is itself a POST.
          },
        );
        return toResult({ method, of_path: `/api2/v2${normalised}`, response: data });
      } catch (e) {
        return toError((e as Error).message);
      }
    },
  );
}
