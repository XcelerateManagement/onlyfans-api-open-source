import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolCtx } from "./index.js";
import { toResult } from "./_shape.js";
import { OfUserId, ConfirmFlag, Limit, Offset } from "../schemas/common.js";
import { consume } from "../ratelimit.js";

const ConditionOp = z.enum(["eq", "neq", "gt", "gte", "lt", "lte", "contains", "startswith", "in"]);
const Condition = z.object({
  field: z.string().min(1).max(128),
  op: ConditionOp,
  value: z.unknown(),
});
const ActionType = z.enum(["webhook", "discord", "slack", "telegram", "send_dm", "tag_fan"]);
const TriggerEvent = z.string().min(1).max(64);

export function registerAutomationTools(server: McpServer, ctx: ToolCtx): void {
  server.registerTool(
    "of_list_automations",
    {
      title: "List automations",
      description: "List every automation rule for this CRM panel.",
      inputSchema: {},
    },
    async () => {
      const data = await ctx.flask.get(`/api/crm/${ctx.flask.crmId}/automations`);
      return toResult(data);
    },
  );

  server.registerTool(
    "of_get_automation",
    {
      title: "Get a single automation",
      description: "Fetch one automation rule by id.",
      inputSchema: { automation_id: z.number().int().positive() },
    },
    async ({ automation_id }) => {
      const data = await ctx.flask.get(`/api/crm/${ctx.flask.crmId}/automations/${automation_id}`);
      return toResult(data);
    },
  );

  server.registerTool(
    "of_create_automation",
    {
      title: "Create an automation rule",
      description: "Create a rule that runs an action whenever a matching event fires. Conditions use ops eq/neq/gt/gte/lt/lte/contains/startswith/in. Action params support {payload.x.y} templating.",
      inputSchema: {
        name: z.string().min(1).max(120),
        trigger_event: TriggerEvent,
        action_type: ActionType,
        action_params: z.record(z.unknown()),
        of_user_id: OfUserId.optional(),
        conditions: z.array(Condition).default([]),
        is_active: z.boolean().default(true),
      },
    },
    async (args) => {
      const data = await ctx.flask.post(
        `/api/crm/${ctx.flask.crmId}/automations`,
        { body: args },
      );
      return toResult(data);
    },
  );

  server.registerTool(
    "of_update_automation",
    {
      title: "Update an automation",
      description: "Patch any field on an automation (name, is_active, trigger_event, conditions, action_type, action_params).",
      inputSchema: {
        automation_id: z.number().int().positive(),
        name: z.string().min(1).max(120).optional(),
        trigger_event: TriggerEvent.optional(),
        action_type: ActionType.optional(),
        action_params: z.record(z.unknown()).optional(),
        conditions: z.array(Condition).optional(),
        is_active: z.boolean().optional(),
      },
    },
    async ({ automation_id, ...rest }) => {
      const data = await ctx.flask.patch(
        `/api/crm/${ctx.flask.crmId}/automations/${automation_id}`,
        { body: rest },
      );
      return toResult(data);
    },
  );

  server.registerTool(
    "of_delete_automation",
    {
      title: "Delete an automation",
      description: "Permanently delete an automation rule. Irreversible — requires confirm=true.",
      inputSchema: {
        automation_id: z.number().int().positive(),
        confirm: ConfirmFlag,
      },
    },
    async ({ automation_id, confirm }) => {
      if (!confirm) {
        return toResult({ dry_run: true, would_delete: automation_id });
      }
      const data = await ctx.flask.delete(`/api/crm/${ctx.flask.crmId}/automations/${automation_id}`);
      return toResult(data);
    },
  );

  server.registerTool(
    "of_run_automation_now",
    {
      title: "Run an automation against a sample event",
      description: "Manually fire an automation (for testing) against a sample event you supply, or against a built-in demo event if omitted.",
      inputSchema: {
        automation_id: z.number().int().positive(),
        sample_event: z.record(z.unknown()).optional(),
      },
    },
    async ({ automation_id, sample_event }) => {
      consume(ctx.flask.crmId, "of_run_automation_now");
      const body = sample_event ? { sample_event } : {};
      const data = await ctx.flask.post(
        `/api/crm/${ctx.flask.crmId}/automations/${automation_id}/run-now`,
        { body },
      );
      return toResult(data);
    },
  );

  server.registerTool(
    "of_list_automation_runs",
    {
      title: "List automation runs",
      description: "History of automation executions (success/error + error_snippet).",
      inputSchema: {
        automation_id: z.number().int().positive(),
        limit: Limit.default(50),
        offset: Offset.default(0),
      },
    },
    async ({ automation_id, limit, offset }) => {
      const data = await ctx.flask.get(
        `/api/crm/${ctx.flask.crmId}/automations/${automation_id}/runs`,
        { query: { limit, offset } },
      );
      return toResult(data);
    },
  );
}
