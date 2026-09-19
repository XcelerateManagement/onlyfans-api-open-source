import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { FlaskClient } from "../flask/client.js";
import type { Session } from "../auth/whoami.js";

import { registerIdentityTools } from "./identity.js";
import { registerAccountTools } from "./accounts.js";
import { registerLoginTools } from "./login.js";
import { registerFanTools } from "./fans.js";
import { registerSubscriberTools } from "./subscribers.js";
import { registerInboxTools } from "./inbox.js";
import { registerEarningsTools } from "./earnings.js";
import { registerTransactionTools } from "./transactions.js";
import { registerCampaignTools } from "./campaigns.js";
import { registerAutomationTools } from "./automations.js";
import { registerWebhookTools } from "./webhooks.js";
import { registerEventTools } from "./events.js";
import { registerNotificationTools } from "./notifications.js";
import { registerIntegrationTools } from "./integrations.js";
import { registerEscapeTools } from "./escape.js";
import { registerPpvTools } from "./ppv.js";

export interface ToolCtx {
  flask: FlaskClient;
  session: Session;
}

export function registerAllTools(server: McpServer, ctx: ToolCtx): void {
  registerIdentityTools(server, ctx);
  registerAccountTools(server, ctx);
  registerLoginTools(server, ctx);
  registerFanTools(server, ctx);
  registerSubscriberTools(server, ctx);
  registerInboxTools(server, ctx);
  registerEarningsTools(server, ctx);
  registerTransactionTools(server, ctx);
  registerCampaignTools(server, ctx);
  registerAutomationTools(server, ctx);
  registerWebhookTools(server, ctx);
  registerEventTools(server, ctx);
  registerNotificationTools(server, ctx);
  registerIntegrationTools(server, ctx);
  registerPpvTools(server, ctx);
  registerEscapeTools(server, ctx);
}
