import { request } from "undici";
import { config } from "../config.js";
import { invalidateByToken, type Session } from "../auth/whoami.js";
import { AuthError, BackendError, ToolDeniedError } from "../auth/errors.js";
import { logger } from "../logging.js";
import { VERSION, SERVER_NAME } from "../version.js";

/** Paths that MUST NEVER be reachable through MCP, even via the escape hatch. */
const ADMIN_PATH_PREFIXES = ["/api/admin/", "/internal/"];

/**
 * Resolve `..` / `.` segments and decode percent-encoded slashes BEFORE the
 * denylist check. Otherwise a caller could pass `/somepath/../api/admin/me`
 * (or `/somepath%2F..%2Fapi%2Fadmin%2Fme`) and bypass the prefix match.
 */
function normalizePath(raw: string): string {
  // Decode common encoded variants of `/` and `..` so the comparison is
  // canonical. Iterate twice in case of double encoding.
  let s = raw;
  for (let i = 0; i < 3; i++) {
    try {
      const decoded = decodeURIComponent(s);
      if (decoded === s) break;
      s = decoded;
    } catch {
      break;
    }
  }
  // Strip query string for the path check — the denylist is path-only.
  const q = s.indexOf("?");
  const pathOnly = q >= 0 ? s.slice(0, q) : s;
  // Resolve `..` and `.` segments.
  const segs: string[] = [];
  for (const seg of pathOnly.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") { segs.pop(); continue; }
    segs.push(seg);
  }
  return "/" + segs.join("/");
}

export type HttpMethod = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";

export interface FlaskRequestOptions {
  query?: Record<string, string | number | boolean | null | undefined>;
  body?: unknown;
  extraHeaders?: Record<string, string>;
  /** Allow non-GET methods through. Required for any write. */
  allowMutation?: boolean;
  /** Allow internal/admin paths. Always false in production. */
  allowAdmin?: boolean;
}

function buildQuery(q?: FlaskRequestOptions["query"]): string {
  if (!q) return "";
  const usp = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) {
    if (v === undefined || v === null) continue;
    usp.set(k, String(v));
  }
  const s = usp.toString();
  return s ? `?${s}` : "";
}

function isAdminPath(path: string): boolean {
  const lower = normalizePath(path).toLowerCase();
  return ADMIN_PATH_PREFIXES.some((p) => lower.startsWith(p));
}

/** Strip any `Bearer …` token from a string before it leaves the server. */
function redactBearer(s: string): string {
  return s.replace(/Bearer\s+[A-Za-z0-9_\-.~+/=]+/gi, "Bearer [REDACTED]");
}

export class FlaskClient {
  constructor(private readonly session: Session) {}

  get crmId(): string { return this.session.crmId; }
  get unsafeProxyEnabled(): boolean { return this.session.mcpUnsafeProxy; }

  async call<T = unknown>(
    method: HttpMethod,
    path: string,
    opts: FlaskRequestOptions = {},
  ): Promise<T> {
    if (!path.startsWith("/")) {
      throw new BackendError(400, `Invalid path: ${path}`);
    }
    if (!opts.allowAdmin && isAdminPath(path)) {
      throw new ToolDeniedError(`Admin/internal paths are not callable from MCP: ${path}`);
    }
    if (method !== "GET" && !opts.allowMutation) {
      throw new ToolDeniedError(`Mutation requires explicit confirmation: ${method} ${path}`);
    }

    const url = `${config.backendUrl}${path}${buildQuery(opts.query)}`;
    // Two auth styles depending on how the MCP client authenticated:
    //   - Legacy bearer (CRM API key) → forward as X-API-Key.
    //   - OAuth JWT bearer            → use inter-service impersonation
    //     (X-Service-Token + X-Acting-Crm-Id) since Flask routes are
    //     wired to X-API-Key semantics, not JWT. The MCP server has
    //     already verified the JWT and extracted `sub`; Flask trusts
    //     the impersonation only because INTER_SERVICE_TOKEN is shared
    //     out-of-band with the MCP process.
    const sessionAny = this.session as unknown as { authScheme?: string };
    const isOauth = sessionAny.authScheme === "oauth";
    const authHeaders: Record<string, string> = isOauth
      ? {
          "X-Service-Token": config.serviceToken,
          "X-Acting-Crm-Id": this.session.crmId,
        }
      : { "X-API-Key": this.session.token };
    const headers: Record<string, string> = {
      ...authHeaders,
      "User-Agent": `${SERVER_NAME}/${VERSION}`,
      ...(opts.extraHeaders ?? {}),
    };

    let bodyBuf: string | undefined;
    if (opts.body !== undefined && method !== "GET") {
      bodyBuf = JSON.stringify(opts.body);
      headers["Content-Type"] = "application/json";
    }

    let res;
    try {
      res = await request(url, { method, headers, body: bodyBuf });
    } catch (e) {
      logger.warn({ err: (e as Error).message, path }, "flask fetch failed");
      throw new BackendError(502, "Backend unreachable");
    }

    const status = res.statusCode;
    if (status === 401 || status === 403) {
      // Token has been rotated or revoked since we last cached it.
      invalidateByToken(this.session.token);
      throw new AuthError("Bearer token rejected by backend");
    }

    if (status >= 400) {
      const text = await res.body.text().catch(() => "");
      let snippet = text.slice(0, 300);
      // Try to lift `error` field for a cleaner message.
      try {
        const j = JSON.parse(text);
        if (j && typeof j.error === "string") snippet = j.error;
      } catch {/* ignore */}
      // Belt-and-braces: scrub anything that looks like a bearer token from
      // both the cleaned message and the raw body snippet.
      throw new BackendError(
        status,
        redactBearer(snippet),
        redactBearer(text.slice(0, 300)),
      );
    }

    // Empty body (e.g. 204) — return null.
    const text = await res.body.text();
    if (!text) return null as T;
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new BackendError(502, "Backend returned non-JSON body", text.slice(0, 200));
    }
  }

  // Convenience wrappers.
  get<T = unknown>(path: string, opts: Omit<FlaskRequestOptions, "body" | "allowMutation"> = {}) {
    return this.call<T>("GET", path, opts);
  }
  post<T = unknown>(path: string, opts: FlaskRequestOptions = {}) {
    return this.call<T>("POST", path, { ...opts, allowMutation: true });
  }
  patch<T = unknown>(path: string, opts: FlaskRequestOptions = {}) {
    return this.call<T>("PATCH", path, { ...opts, allowMutation: true });
  }
  delete<T = unknown>(path: string, opts: FlaskRequestOptions = {}) {
    return this.call<T>("DELETE", path, { ...opts, allowMutation: true });
  }
}
