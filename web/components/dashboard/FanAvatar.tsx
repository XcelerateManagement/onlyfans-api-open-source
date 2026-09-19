"use client";

import { useMemo, useState } from "react";

const PALETTE = ["#f54900", "#e11d48", "#ea580c", "#d97706", "#b45309", "#a16207", "#65a30d", "#0891b2", "#6366f1", "#7c3aed"];

function hashColor(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0;
  return PALETTE[Math.abs(h) % PALETTE.length];
}

/** True when a signed CDN URL (Fansly avatars carry an `Expires` unix-seconds
 * query param) has already expired — the request is guaranteed to fail, so
 * skip issuing it and go straight to the initial-letter fallback. URLs
 * without an Expires param (OF avatars) are never treated as expired. */
function isExpiredSignedUrl(url: string): boolean {
  try {
    const exp = new URL(url, "https://x.invalid").searchParams.get("Expires");
    if (!exp) return false;
    const t = Number(exp);
    if (!Number.isFinite(t) || t <= 0) return false;
    // Unix seconds normally; tolerate millisecond timestamps defensively.
    const ms = t > 1e12 ? t : t * 1000;
    return ms < Date.now();
  } catch {
    return false;
  }
}

export function FanAvatar({
  username,
  displayName,
  avatar,
  size = 32,
}: {
  username?: string | null;
  displayName?: string | null;
  avatar?: string | null;
  size?: number;
}) {
  const [failed, setFailed] = useState(false);
  const seed = username || displayName || "fan";
  const initial = (displayName || username || "?").trim().charAt(0).toUpperCase() || "?";
  const bg = hashColor(seed);
  const expired = useMemo(
    () => (avatar ? isExpiredSignedUrl(avatar) : false),
    [avatar]
  );

  if (avatar && !failed && !expired) {
    return (
      <img
        src={avatar}
        alt=""
        width={size}
        height={size}
        onError={() => setFailed(true)}
        className="flex-shrink-0 object-cover"
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <div
      className="flex items-center justify-center font-bold text-white flex-shrink-0 select-none"
      style={{
        width: size,
        height: size,
        backgroundColor: bg,
        fontSize: size * 0.45,
      }}
    >
      {initial}
    </div>
  );
}
