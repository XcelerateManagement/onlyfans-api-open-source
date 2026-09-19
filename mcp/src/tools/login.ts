import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolCtx } from "./index.js";
import { toResult, toError } from "./_shape.js";
import { OfUserId } from "../schemas/common.js";

export function registerLoginTools(server: McpServer, ctx: ToolCtx): void {
  server.registerTool(
    "of_login_account",
    {
      title: "Add an OF account by email/password",
      description: "Log into OnlyFans with email + password and attach the account to this CRM. OnlyFans only — Fansly has no password-login path, use of_login_with_cookies with platform='fansly' instead. If 2FA is required, the response will include requires_2fa=true and an otp_state to pass into of_verify_login_otp. The proxy is mandatory; the password is sent only to the OF login flow and never stored in plaintext.",
      inputSchema: {
        email: z.string().email(),
        password: z.string().min(1).max(256),
        proxy: z.string().min(8).max(500),
        use_captcha: z.boolean().default(true),
      },
    },
    async ({ email, password, proxy, use_captcha }) => {
      const data = await ctx.flask.post(
        `/api/crm/${ctx.flask.crmId}/accounts/login`,
        {
          body: { email, password, proxy, use_captcha },
          extraHeaders: { "X-Proxy": proxy },
        },
      );
      return toResult(data);
    },
  );

  server.registerTool(
    "of_login_with_cookies",
    {
      title: "Attach an OnlyFans or Fansly account using existing session credentials",
      description:
        "Attach an account you already have credentials for, skipping password login. Two platforms, two credential sets — pass the ones matching `platform`. " +
        "OnlyFans (`platform` omitted or 'onlyfans'): REQUIRES `sess` + `auth_id` session cookies. Optional `fp` is the browser fingerprint, which is also reused as the `x-bc` request header; when omitted, one is generated server-side. " +
        "Fansly (`platform: 'fansly'`): REQUIRES `auth_token` (bearer token pulled from the browser) + `fansly_session_id`. Optional `fansly_client_id` is the device id; when omitted, one is generated. " +
        "Proxy is mandatory. Use this when password login is blocked by captcha, and for every Fansly account.",
      inputSchema: {
        platform: z
          .enum(["onlyfans", "fansly"])
          .default("onlyfans")
          .describe("Which platform the credentials belong to. Determines which fields are required."),
        of_user_id: OfUserId.optional().describe(
          "OnlyFans user id, when already known. Resolved from the session if omitted.",
        ),
        // ── OnlyFans ──
        sess: z.string().min(8).max(500).optional().describe("OnlyFans only — required. The `sess` session cookie."),
        auth_id: z.string().min(1).max(50).optional().describe("OnlyFans only — required. The `auth_id` cookie."),
        fp: z
          .string()
          .min(1)
          .max(200)
          .optional()
          .describe("OnlyFans only — optional browser fingerprint, also sent as the x-bc header. Generated if omitted."),
        // ── Fansly ──
        auth_token: z
          .string()
          .min(8)
          .max(2000)
          .optional()
          .describe("Fansly only — required. Bearer auth token pulled from the browser."),
        fansly_session_id: z
          .string()
          .min(1)
          .max(100)
          .optional()
          .describe("Fansly only — required. The Fansly session id."),
        fansly_client_id: z
          .string()
          .min(1)
          .max(100)
          .optional()
          .describe("Fansly only — optional device id. Generated if omitted."),
        proxy: z.string().min(8).max(500),
      },
    },
    async ({
      platform,
      of_user_id,
      sess,
      auth_id,
      fp,
      auth_token,
      fansly_session_id,
      fansly_client_id,
      proxy,
    }) => {
      const body: Record<string, unknown> =
        platform === "fansly"
          ? { platform, auth_token, fansly_session_id, fansly_client_id }
          : { of_user_id, sess, auth_id, fp };

      // Fail locally with an actionable message rather than round-tripping
      // to Flask for a 400 the agent could have avoided.
      if (platform === "fansly") {
        if (!auth_token || !fansly_session_id) {
          return toError(
            "Fansly login requires both auth_token and fansly_session_id. Pull them from the browser session.",
          );
        }
      } else if (!sess || !auth_id) {
        return toError("OnlyFans cookie login requires both sess and auth_id cookies.");
      }

      const data = await ctx.flask.post(
        `/api/crm/${ctx.flask.crmId}/accounts/login/cookies`,
        {
          body,
          extraHeaders: { "X-Proxy": proxy },
        },
      );
      return toResult(data);
    },
  );

  server.registerTool(
    "of_verify_login_otp",
    {
      title: "Complete a 2FA login",
      description: "Finish a 2FA-gated login. OnlyFans only. Use the email + otp_state returned by of_login_account, plus the 6-digit code from the user's authenticator app or SMS.",
      inputSchema: {
        email: z.string().email(),
        otp_code: z.string().regex(/^[0-9]{4,8}$/),
        otp_state: z.string().min(1).max(512),
      },
    },
    async ({ email, otp_code, otp_state }) => {
      const data = await ctx.flask.post(
        `/api/crm/${ctx.flask.crmId}/accounts/login/verify-otp`,
        { body: { email, otp_code, otp_state } },
      );
      return toResult(data);
    },
  );
}
