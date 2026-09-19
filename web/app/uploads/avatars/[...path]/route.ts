import { promises as fs } from "node:fs";
import path from "node:path";

import { NextRequest } from "next/server";

/**
 * Serves uploaded avatars from disk at REQUEST time.
 *
 * Avatars are written to `public/uploads/avatars/{userId}/{hash}.webp`, and
 * `public/` is normally served by Next directly — which is why this route
 * looks redundant. It is not. `next start` resolves `public/` against a file
 * list captured when the server booted, so a file written after boot is
 * invisible to it: the upload succeeds, the row is saved, and the image 404s
 * until someone happens to restart the service. Observed exactly that — an
 * avatar written at 16:52 against a server that started at 16:50:51 returned
 * 404 from the origin while avatars from previous deploys returned 200.
 *
 * Static `public/` still wins for files that existed at boot, so this handler
 * only runs for the ones Next would otherwise miss. Nothing about the upload
 * path or the stored URL changes.
 */

const ROOT = path.join(process.cwd(), "public", "uploads", "avatars");

const CONTENT_TYPES: Record<string, string> = {
  ".webp": "image/webp",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
};

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ path: string[] }> },
) {
  const { path: segments } = await context.params;
  if (!segments?.length) {
    return new Response("Not found", { status: 404 });
  }

  // Resolve, then prove the result is still inside ROOT. Next already decodes
  // and rejects most traversal, but this handler reads arbitrary paths off the
  // filesystem — it does not get to assume the caller was well behaved.
  const target = path.resolve(ROOT, ...segments);
  const rel = path.relative(ROOT, target);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    return new Response("Not found", { status: 404 });
  }

  const ext = path.extname(target).toLowerCase();
  const contentType = CONTENT_TYPES[ext];
  if (!contentType) {
    return new Response("Not found", { status: 404 });
  }

  let data: Buffer;
  let stat: Awaited<ReturnType<typeof fs.stat>>;
  try {
    stat = await fs.stat(target);
    if (!stat.isFile()) return new Response("Not found", { status: 404 });
    data = await fs.readFile(target);
  } catch {
    return new Response("Not found", { status: 404 });
  }

  return new Response(new Uint8Array(data), {
    headers: {
      "Content-Type": contentType,
      "Content-Length": String(data.length),
      // The filename is a content hash, so a new upload is a new URL and this
      // can be cached hard. `must-revalidate` is deliberately absent for the
      // same reason.
      "Cache-Control": "public, max-age=31536000, immutable",
      "Last-Modified": stat.mtime.toUTCString(),
      "X-Content-Type-Options": "nosniff",
    },
  });
}
