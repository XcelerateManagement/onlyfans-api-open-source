/**
 * Strict accessor for the shared secret that authenticates server-to-server
 * calls from this dashboard to the Flask API's `/internal/*` endpoints.
 *
 * Both containers must be given the SAME value for `INTER_SERVICE_TOKEN`. The
 * API refuses every `/internal/*` request when its own copy is unset, so these
 * endpoints are inert on an install that never configures one.
 *
 * The token MUST be set at runtime. Returning an empty string here would mean
 * every outbound call sends `X-Service-Token: ""`, and if any peer fails open
 * on an empty token the whole privileged surface becomes unauthenticated.
 *
 * Throws on every call when the env var is missing — fails closed at the call
 * site rather than at module load, so `next build` (which will not have a
 * production environment populated) still succeeds.
 */
export function getServiceToken(): string {
  const value = process.env.INTER_SERVICE_TOKEN;
  if (!value) {
    throw new Error(
      "INTER_SERVICE_TOKEN is not configured — refusing to make inter-service call",
    );
  }
  return value;
}
