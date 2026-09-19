import { z } from "zod";

export const OfUserId = z
  .string()
  .min(1)
  .max(32)
  .regex(/^[0-9]+$/, "of_user_id must be a numeric string");

export const FanId = z
  .string()
  .min(1)
  .max(32)
  .regex(/^[0-9]+$/, "fan_of_user_id must be a numeric string");

export const Limit = z.number().int().min(1).max(500);
export const Offset = z.number().int().min(0).max(100000);

export const Tag = z.string().min(1).max(64).regex(/^[a-zA-Z0-9_\-: ]+$/, "tag must be alphanumeric");

// Backend (Flask) only accepts these three. Adding 'year' / 'all-time'
// here would let the schema validate inputs the backend would then reject
// with a confusing 4xx — the model would see two contradictory signals
// and either ask the user for clarification or retry blindly.
export const Period = z.enum(["today", "week", "month"]);

export const SubscriberType = z.enum(["all", "active", "expired"]);

export const ConfirmFlag = z
  .boolean()
  .describe("Must be true to actually perform this write action. Without it the tool returns a dry-run summary.");

export const IdempotencyKey = z
  .string()
  .min(8)
  .max(128)
  .regex(/^[a-zA-Z0-9_\-]+$/)
  .optional()
  .describe("Optional caller-supplied key for deduplication on retries.");
