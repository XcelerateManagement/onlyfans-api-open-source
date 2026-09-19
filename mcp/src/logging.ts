import pino from "pino";
import { createHash } from "node:crypto";
import { config } from "./config.js";

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex").slice(0, 12);
}

// Strip any `Authorization: Bearer …` value from arbitrary objects we log.
// Belt-and-braces: we hash tokens explicitly elsewhere, but if some object
// containing the raw token slips into a log line, this catches it.
function redact(obj: unknown): unknown {
  if (obj == null || typeof obj !== "object") return obj;
  if (Array.isArray(obj)) return obj.map(redact);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    const lk = k.toLowerCase();
    if (lk === "authorization" || lk === "x-api-key" || lk === "api_key" || lk === "apikey" || lk === "token" || lk === "bearer" || lk === "password" || lk === "encrypted_password") {
      out[k] = "[REDACTED]";
    } else {
      out[k] = redact(v);
    }
  }
  return out;
}

export const logger = pino({
  level: config.logLevel,
  redact: {
    paths: [
      "req.headers.authorization",
      "req.headers['x-api-key']",
      "headers.authorization",
      "headers['x-api-key']",
      "args.password",
      "args.encrypted_password",
      "args.api_key",
      "args.sess",
      "args.auth_id",
    ],
    censor: "[REDACTED]",
  },
  formatters: {
    log(obj) {
      return redact(obj) as Record<string, unknown>;
    },
  },
});
