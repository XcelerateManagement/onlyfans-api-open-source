import Image from "next/image";
import type { Platform } from "@/lib/hooks/use-selected-account";

// Brand favicons extracted from onlyfans.com / fansly.com, stored locally in
// /public so we don't hotlink (no referrer leak, works offline). See
// public/onlyfans-icon.png and public/fansly-icon.png.
const ICONS: Record<Platform, { src: string; alt: string }> = {
  onlyfans: { src: "/onlyfans-icon.png", alt: "OnlyFans" },
  fansly: { src: "/fansly-icon.png", alt: "Fansly" },
};

/**
 * Small platform icon shown next to a connected account. Defaults to OnlyFans
 * so accounts created before the platform column render correctly.
 */
export default function PlatformBadge({
  platform,
  className = "",
  size = 16,
}: {
  platform?: Platform;
  className?: string;
  size?: number;
}) {
  const icon = ICONS[platform ?? "onlyfans"];
  return (
    <Image
      src={icon.src}
      alt={icon.alt}
      title={icon.alt}
      width={size}
      height={size}
      className={`inline-block shrink-0 rounded-[3px] ${className}`}
      unoptimized
    />
  );
}
