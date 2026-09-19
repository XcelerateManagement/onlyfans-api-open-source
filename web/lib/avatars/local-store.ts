/**
 * Local avatar storage for company-page users.
 *
 * Strategy: re-encode every upload through sharp to strip EXIF, normalise to
 * webp at 256x256, and write to /public/uploads/avatars/{userId}/{hash}.webp.
 * The destination is under /public so Next serves it directly — no separate
 * blob CDN, no signed URLs. Old avatars are best-effort deleted on overwrite
 * to avoid a growing pile of orphans.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import sharp from "sharp";

const AVATAR_DIM = 256;
const MAX_INPUT_BYTES = 4 * 1024 * 1024;
const ALLOWED_MIME = new Set(["image/jpeg", "image/png", "image/webp", "image/jpg"]);

// Magic-byte prefixes for the formats we accept. Content-Type alone is
// trivially forgeable, so we sniff the first few bytes too.
const MAGIC: Array<{ kind: string; bytes: number[] }> = [
  { kind: "jpeg", bytes: [0xff, 0xd8, 0xff] },
  { kind: "png", bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  { kind: "webp", bytes: [0x52, 0x49, 0x46, 0x46] }, // RIFF header — second check inspects WEBP at offset 8
];

function sniffImageKind(buf: Buffer): string | null {
  for (const sig of MAGIC) {
    if (buf.length < sig.bytes.length) continue;
    let ok = true;
    for (let i = 0; i < sig.bytes.length; i++) {
      if (buf[i] !== sig.bytes[i]) { ok = false; break; }
    }
    if (!ok) continue;
    if (sig.kind === "webp") {
      // RIFF....WEBP — verify the WEBP marker at offset 8.
      if (buf.length < 12) return null;
      const tag = buf.slice(8, 12).toString("ascii");
      if (tag !== "WEBP") return null;
    }
    return sig.kind;
  }
  return null;
}

export class AvatarStoreError extends Error {
  constructor(public code: string, message: string) {
    super(message);
  }
}

export interface SavedAvatar {
  url: string; // public URL the browser uses
  bytes: number; // size of the stored file
}

/**
 * Save an uploaded avatar. Validates size + magic bytes + decodes through
 * sharp (which throws on malformed images, providing implicit defense
 * against image-parser exploits piping straight through to clients).
 * Returns the canonical URL.
 */
export async function saveAvatar(
  userId: string,
  buf: Buffer,
  declaredMime: string
): Promise<SavedAvatar> {
  if (!userId || !/^[a-zA-Z0-9_-]+$/.test(userId)) {
    throw new AvatarStoreError("BAD_USER_ID", "Invalid userId");
  }
  if (buf.length > MAX_INPUT_BYTES) {
    throw new AvatarStoreError("TOO_LARGE", `Avatar must be ≤ ${MAX_INPUT_BYTES / 1024 / 1024}MB`);
  }
  if (!ALLOWED_MIME.has(declaredMime.toLowerCase())) {
    throw new AvatarStoreError("BAD_MIME", "Unsupported image type");
  }
  if (!sniffImageKind(buf)) {
    throw new AvatarStoreError("BAD_MAGIC", "File doesn't look like a supported image");
  }

  let processed: Buffer;
  try {
    processed = await sharp(buf, { failOn: "error" })
      .rotate() // honour EXIF orientation before stripping
      .resize(AVATAR_DIM, AVATAR_DIM, { fit: "cover", position: "centre" })
      .webp({ quality: 88 })
      .toBuffer();
  } catch (err: any) {
    throw new AvatarStoreError("DECODE_FAIL", err?.message || "Image could not be decoded");
  }

  // Content-addressed filename so re-uploads don't accumulate but distinct
  // images get distinct URLs (forces browser cache busting automatically).
  const hash = crypto.createHash("sha256").update(processed).digest("hex").slice(0, 16);
  const dir = path.join(process.cwd(), "public", "uploads", "avatars", userId);
  await fs.mkdir(dir, { recursive: true });

  // Clean up older avatars in this user's dir — best-effort, errors ignored.
  try {
    const existing = await fs.readdir(dir);
    await Promise.all(existing.map(name => fs.unlink(path.join(dir, name)).catch(() => {})));
  } catch { /* dir didn't exist or readdir failed; safe to ignore */ }

  const filename = `${hash}.webp`;
  const fullPath = path.join(dir, filename);
  await fs.writeFile(fullPath, processed, { flag: "w" });

  const url = `/uploads/avatars/${encodeURIComponent(userId)}/${encodeURIComponent(filename)}`;
  return { url, bytes: processed.length };
}
