"use client";

import Image from "next/image";

type AuthBrandLogoProps = {
  compact?: boolean;
};

/**
 * Open-source panel logo used through the sign-out/sign-in transition.
 *
 * The supplied artwork is a transparent square with the visible mark centered
 * vertically. The clipped wrapper removes that transparent padding at render
 * time while preserving the source asset byte-for-byte.
 */
export function AuthBrandLogo({ compact = false }: AuthBrandLogoProps) {
  return (
    <div
      className={
        compact
          ? "relative h-[88px] w-[220px] shrink-0 overflow-hidden"
          : "relative h-[112px] w-[280px] shrink-0 overflow-hidden"
      }
    >
      <Image
        priority
        alt="The Only API Xcelerator — open source"
        className={
          compact
            ? "absolute left-0 top-[-68px] h-[220px] w-[220px] object-contain"
            : "absolute left-0 top-[-87px] h-[280px] w-[280px] object-contain"
        }
        height={1254}
        src="/open-source-panel-logo.png"
        width={1254}
      />
    </div>
  );
}
