"use client";

import * as React from "react";
import { HeroUIProvider } from "@heroui/system";
import { useRouter } from "next/navigation";
import { ThemeProvider } from "@/lib/theme-context";
import { AppearanceProvider } from "@/lib/hooks/use-appearance";

export interface ProvidersProps {
  children: React.ReactNode;
}

declare module "@react-types/shared" {
  interface RouterConfig {
    routerOptions: NonNullable<
      Parameters<ReturnType<typeof useRouter>["push"]>[1]
    >;
  }
}

export function Providers({ children }: ProvidersProps) {
  const router = useRouter();

  return (
    <AppearanceProvider>
      <ThemeProvider>
        <HeroUIProvider navigate={router.push}>
          {children}
        </HeroUIProvider>
      </ThemeProvider>
    </AppearanceProvider>
  );
}
