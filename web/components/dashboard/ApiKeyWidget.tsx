"use client";

import { useState } from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { useApiKey } from "@/lib/hooks/use-api-key";
import { Button } from "@heroui/button";
import { Tooltip } from "@heroui/tooltip";

import {
  GlassCard,
  GlassCardHeader,
  GlassCardBody,
} from "@/components/dashboard/GlassCard";
import { SecretField } from "@/components/dashboard/SecretField";
import {
  PxLock,
  PxCopy,
  PxCheck,
  PxShield,
  PxCode2,
} from "@/components/ui/PixelIcons";
import { useTour } from "@/lib/tour-context";

export function ApiKeyWidget() {
  const { data: session } = useSession();
  const { isActive: isTourActive } = useTour();
  const { apiKey: realApiKey } = useApiKey();
  // In tour mode show a placeholder key so we never accidentally expose the
  // real one in screenshots/screen-shares of the walkthrough.
  const apiKey = isTourActive
    ? "sk_demoXXXXXXXXXXXXXXXXXXXXXXX"
    : realApiKey || "";
  const crmId = isTourActive
    ? "tour-crm-demo"
    : session?.user?.crmId || "";

  const [crmCopied, setCrmCopied] = useState(false);
  const copyCrm = () => {
    if (!crmId) return;
    navigator.clipboard.writeText(crmId);
    setCrmCopied(true);
    setTimeout(() => setCrmCopied(false), 1800);
  };

  return (
    <GlassCard delay={0.1}>
      <GlassCardHeader className="!px-4 !py-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <PxShield className="h-4 w-4 text-[color:var(--theme-accent,#f54900)]" />
            <h3 className="text-xs font-semibold uppercase tracking-wider">
              API Credentials
            </h3>
          </div>
        </div>
      </GlassCardHeader>

      <GlassCardBody className="!p-4 space-y-3">
        <SecretField label="Key" value={apiKey} />

        {/* CRM ID — not secret, copy only */}
        <div>
          <div className="flex items-center gap-1.5 mb-1.5 text-default-500">
            <PxCode2 className="h-3 w-3" />
            <span className="text-[10px] uppercase tracking-wider">CRM ID</span>
          </div>
          <div className="flex items-stretch gap-1.5">
            <div className="flex-1 min-w-0 bg-black/40 border border-white/[0.08] px-2.5 py-2 font-mono text-xs text-white/90 truncate">
              {crmId || "—"}
            </div>
            <Tooltip
              content={crmCopied ? "Copied!" : "Copy"}
              placement="top"
              delay={300}
              classNames={{
                content:
                  "!rounded-none bg-[#0d0d0d] border border-white/[0.08] text-xs",
              }}
            >
              <Button
                isIconOnly
                size="sm"
                variant="bordered"
                onPress={copyCrm}
                className="!rounded-none border-white/[0.08] min-w-8 w-8 h-8"
                isDisabled={!crmId}
              >
                {crmCopied ? (
                  <PxCheck className="h-3 w-3 text-green-400" />
                ) : (
                  <PxCopy className="h-3 w-3" />
                )}
              </Button>
            </Tooltip>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between pt-2 border-t border-white/[0.06]">
          <span className="text-[10px] text-default-500 flex items-center gap-1">
            <PxLock className="h-2.5 w-2.5" />
            Keep secret
          </span>
          <Link
            href="/dashboard/console"
            className="text-[10px] text-[color:var(--theme-accent,#f54900)] hover:underline font-semibold uppercase tracking-wider"
          >
            Console →
          </Link>
        </div>
      </GlassCardBody>
    </GlassCard>
  );
}
