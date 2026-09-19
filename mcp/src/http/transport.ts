import { randomUUID } from "node:crypto";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SERVER_NAME, VERSION } from "../version.js";
import type { Session } from "../auth/whoami.js";
import { FlaskClient } from "../flask/client.js";
import { logger, hashToken } from "../logging.js";
import { registerAllTools, type ToolCtx } from "../tools/index.js";
import { registerAllPrompts } from "../prompts/index.js";
import { SYSTEM_PROMPT } from "../system_prompt.js";

export interface ManagedSession {
  sessionId: string;
  /** sha256 prefix of the bearer that owns this session — used to defend against hijacks. */
  tokenHash: string;
  crmId: string;
  transport: StreamableHTTPServerTransport;
  server: McpServer;
  createdAt: number;
}

const sessions = new Map<string, ManagedSession>();

// Cap to avoid unbounded growth if many clients never close cleanly.
const MAX_SESSIONS = 500;
// Sweep idle sessions every 5 min; sessions older than 1 hour are dropped.
const SESSION_IDLE_MS = 60 * 60 * 1000;
const SWEEP_INTERVAL_MS = 5 * 60 * 1000;

let sweepTimer: ReturnType<typeof setInterval> | null = null;
function startSweep(): void {
  if (sweepTimer) return;
  sweepTimer = setInterval(() => {
    const cutoff = Date.now() - SESSION_IDLE_MS;
    let dropped = 0;
    for (const [id, s] of sessions) {
      if (s.createdAt < cutoff) {
        sessions.delete(id);
        s.transport.close().catch(() => undefined);
        dropped += 1;
      }
    }
    if (dropped > 0) logger.info({ dropped }, "swept idle sessions");
  }, SWEEP_INTERVAL_MS);
  // Don't keep the event loop alive solely for this.
  if (typeof sweepTimer.unref === "function") sweepTimer.unref();
}
startSweep();

export function getSession(sessionId: string | undefined): ManagedSession | undefined {
  if (!sessionId) return undefined;
  return sessions.get(sessionId);
}

export function deleteSession(sessionId: string): void {
  const s = sessions.get(sessionId);
  if (!s) return;
  sessions.delete(sessionId);
  s.transport.close().catch((err) => logger.warn({ err: String(err) }, "transport close failed"));
}

export async function createSession(session: Session): Promise<ManagedSession> {
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
    onsessioninitialized: (id) => {
      const tokenHash = session.tokenHash;
      const managed: ManagedSession = {
        sessionId: id,
        tokenHash,
        crmId: session.crmId,
        transport,
        server,
        createdAt: Date.now(),
      };
      if (sessions.size >= MAX_SESSIONS) {
        // Drop oldest by insertion order to make room.
        const first = sessions.keys().next().value;
        if (first !== undefined) {
          const old = sessions.get(first);
          sessions.delete(first);
          old?.transport.close().catch(() => undefined);
        }
      }
      sessions.set(id, managed);
      logger.info({ session_id: id, crm_id: session.crmId, token_h: tokenHash }, "mcp session opened");
    },
    onsessionclosed: (id) => {
      sessions.delete(id);
      logger.info({ session_id: id }, "mcp session closed");
    },
  });

  const server = new McpServer(
    { name: SERVER_NAME, version: VERSION },
    {
      capabilities: { tools: {}, logging: {}, prompts: {} },
      instructions: SYSTEM_PROMPT,
    },
  );

  const flask = new FlaskClient(session);
  const ctx: ToolCtx = { flask, session };
  registerAllTools(server, ctx);
  registerAllPrompts(server);

  await server.connect(transport);

  // If for any reason the transport disconnects, clean the entry.
  transport.onclose = () => {
    const sid = transport.sessionId;
    if (sid) sessions.delete(sid);
  };

  // The session-id assignment happens during the next handleRequest call
  // (on initialize). Return a partially-populated managed entry; we'll
  // populate the real sessionId via the onsessioninitialized callback.
  return {
    sessionId: "",
    tokenHash: session.tokenHash,
    crmId: session.crmId,
    transport,
    server,
    createdAt: Date.now(),
  };
}

/** Used for hijack defense: compare stored hash to current bearer's hash. */
export function checkSessionOwnership(managed: ManagedSession, bearer: string): boolean {
  return managed.tokenHash === hashToken(bearer);
}

export function _sessionCountForTests(): number {
  return sessions.size;
}
