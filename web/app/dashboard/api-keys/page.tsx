"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { useApiKey, clearApiKeyCache } from "@/lib/hooks/use-api-key";
import { useApiClient } from "@/lib/hooks/use-api-client";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@heroui/button";
import { Tooltip } from "@heroui/tooltip";
import { Input } from "@heroui/input";
import { Chip } from "@heroui/chip";
import {
  Table,
  TableHeader,
  TableColumn,
  TableBody,
  TableRow,
  TableCell,
} from "@heroui/table";
import {
  Modal,
  ModalContent,
  ModalHeader,
  ModalBody,
  ModalFooter,
} from "@heroui/modal";
import { useDisclosure } from "@heroui/use-disclosure";
import toast from "react-hot-toast";

import {
  GlassCard,
  GlassCardHeader,
  GlassCardBody,
} from "@/components/dashboard/GlassCard";
import { DataState } from "@/components/dashboard/DataState";
import { Sparkline } from "@/components/dashboard/Sparkline";
import {
  PxKey,
  PxEye,
  PxLock,
  PxCopy,
  PxCheck,
  PxShield,
  PxCode2,
  PxBookOpen,
  PxGlobe,
  PxZap,
  PxPlus,
  PxActivity,
} from "@/components/ui/PixelIcons";

type ApiKeyRow = {
  id: number;
  name: string;
  prefix: string;
  is_primary: boolean;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
  requests_this_month: number;
  requests_all_time: number;
  series: number[];
};

function relTime(iso: string | null): string {
  if (!iso) return "Never";
  const then = new Date(iso).getTime();
  if (!isFinite(then)) return "—";
  const secs = Math.max(1, Math.floor((Date.now() - then) / 1000));
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 48) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function shortDate(iso: string): string {
  const d = new Date(iso);
  return isFinite(d.getTime())
    ? d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })
    : "—";
}

const REVEAL_DURATION = 60;

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL ||
  process.env.NEXT_PUBLIC_BACKEND_URL ||
  "http://localhost:5000";

function maskKey(key: string): string {
  if (!key) return "•".repeat(40);
  if (key.length <= 8) return "•".repeat(key.length);
  return `${key.slice(0, 4)}${"•".repeat(Math.max(8, key.length - 8))}${key.slice(-4)}`;
}

function CopyBtn({
  value,
  field,
  copiedField,
  onCopy,
  disabled,
}: {
  value: string;
  field: string;
  copiedField: string | null;
  onCopy: (value: string, field: string) => void;
  disabled?: boolean;
}) {
  const isCopied = copiedField === field;
  return (
    <Tooltip
      content={isCopied ? "Copied!" : "Copy"}
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
        onPress={() => onCopy(value, field)}
        className="!rounded-none border-white/[0.08] min-w-9 w-9 h-9"
        isDisabled={disabled}
      >
        {isCopied ? (
          <PxCheck className="h-3.5 w-3.5 text-green-400" />
        ) : (
          <PxCopy className="h-3.5 w-3.5" />
        )}
      </Button>
    </Tooltip>
  );
}

export default function ConsolePage() {
  const { data: session, update: updateSession } = useSession();
  const { apiKey: liveApiKey } = useApiKey();
  // After a rotation the JWT-backed `liveApiKey` lags until the session
  // refresh propagates, so prefer the freshly-rotated value when we have it.
  const [rotatedKey, setRotatedKey] = useState<string | null>(null);
  const apiKey = rotatedKey || liveApiKey || "";
  const crmId = session?.user?.crmId || "";

  const [revealed, setRevealed] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(REVEAL_DURATION);
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [rotating, setRotating] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const {
    isOpen: rotateOpen,
    onOpen: onRotateOpen,
    onClose: onRotateClose,
  } = useDisclosure();

  const handleRotate = useCallback(async () => {
    if (!crmId || rotating) return;
    setRotating(true);
    try {
      const res = await fetch(`/api/crm/${crmId}/rotate-key`, {
        method: "POST",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.api_key) {
        throw new Error(data?.error || "Rotation failed");
      }
      const newKey = data.api_key as string;
      // Show the new key right away, revealed, and reset the auto-hide timer.
      setRotatedKey(newKey);
      setRevealed(true);
      setSecondsLeft(REVEAL_DURATION);
      // Push the new key onto the signed JWT so every other surface (Settings,
      // API Docs, the X-API-Key proxy) uses it without a full re-login, and
      // drop the module-scope cache that `useApiKey` reads.
      clearApiKeyCache();
      await updateSession({ apiKey: newKey });
      onRotateClose();
      toast.success("API key rotated. Update your integrations with the new key.");
    } catch (err: any) {
      toast.error(err?.message || "Could not rotate the API key");
    } finally {
      setRotating(false);
    }
  }, [crmId, rotating, updateSession, onRotateClose]);

  // ── Multi-key console state ───────────────────────────────
  const api = useApiClient();
  const [keys, setKeys] = useState<ApiKeyRow[]>([]);
  const [keysLoading, setKeysLoading] = useState(true);
  // Every panel has at least a Default key, so "No keys yet." was never a true
  // sentence — it only ever appeared when the request failed.
  const [keysError, setKeysError] = useState<unknown>(null);
  const [revoking, setRevoking] = useState<number | null>(null);

  // Create-key modal
  const {
    isOpen: createOpen,
    onOpen: onCreateOpen,
    onClose: onCreateClose,
  } = useDisclosure();
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);
  const [createdKey, setCreatedKey] = useState<string | null>(null);

  // Per-key detail modal
  const {
    isOpen: detailOpen,
    onOpen: onDetailOpen,
    onClose: onDetailClose,
  } = useDisclosure();
  const [detailKey, setDetailKey] = useState<ApiKeyRow | null>(null);
  const [detailUsage, setDetailUsage] = useState<any>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const loadKeys = useCallback(async () => {
    if (!api) return;
    try {
      const res = await api.listApiKeys();
      setKeys(res.keys || []);
      setKeysError(null);
    } catch (err: any) {
      setKeysError(err);
      toast.error(err?.message || "Failed to load API keys");
    } finally {
      setKeysLoading(false);
    }
  }, [api]);

  useEffect(() => {
    loadKeys();
  }, [loadKeys]);

  const handleCreate = useCallback(async () => {
    if (!api || creating) return;
    setCreating(true);
    try {
      const res = await api.createApiKey(newName.trim() || "Untitled key");
      setCreatedKey(res.api_key);
      setNewName("");
      await loadKeys();
    } catch (err: any) {
      toast.error(err?.message || "Failed to create key");
    } finally {
      setCreating(false);
    }
  }, [api, creating, newName, loadKeys]);

  const handleRevoke = useCallback(
    async (key: ApiKeyRow) => {
      if (!api || key.is_primary) return;
      if (!confirm(`Revoke "${key.name}"? Any integration using it will stop working immediately.`)) return;
      setRevoking(key.id);
      try {
        await api.revokeApiKey(key.id);
        toast.success("Key revoked");
        await loadKeys();
      } catch (err: any) {
        toast.error(err?.message || "Failed to revoke key");
      } finally {
        setRevoking(null);
      }
    },
    [api, loadKeys]
  );

  const openDetail = useCallback(
    async (key: ApiKeyRow) => {
      if (!api) return;
      setDetailKey(key);
      setDetailUsage(null);
      setDetailLoading(true);
      onDetailOpen();
      try {
        const res = await api.getApiKeyUsage(key.id, 30);
        setDetailUsage(res);
      } catch (err: any) {
        toast.error(err?.message || "Failed to load key usage");
      } finally {
        setDetailLoading(false);
      }
    },
    [api, onDetailOpen]
  );

  const closeCreate = useCallback(() => {
    setCreatedKey(null);
    setNewName("");
    onCreateClose();
  }, [onCreateClose]);

  const hide = useCallback(() => {
    setRevealed(false);
    setSecondsLeft(REVEAL_DURATION);
    if (timerRef.current) clearInterval(timerRef.current);
  }, []);

  useEffect(() => {
    if (!revealed) return;
    timerRef.current = setInterval(() => {
      setSecondsLeft((s) => {
        if (s <= 1) {
          hide();
          return REVEAL_DURATION;
        }
        return s - 1;
      });
    }, 1000);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [revealed, hide]);

  const copy = (value: string, field: string) => {
    if (!value) return;
    navigator.clipboard.writeText(value);
    setCopiedField(field);
    setTimeout(() => setCopiedField(null), 1800);
  };

  const progressPct = (secondsLeft / REVEAL_DURATION) * 100;
  const displayedKey = revealed ? apiKey : maskKey(apiKey);

  const sampleCurl = `curl -X GET "${API_BASE_URL}/api/crm/${crmId || "<crm_id>"}/accounts" \\
  -H "X-API-Key: ${apiKey || "<api_key>"}"`;

  const samplePython = `import requests

CRM_ID  = "${crmId || "<crm_id>"}"
API_KEY = "${apiKey || "<api_key>"}"
BASE    = "${API_BASE_URL}"

resp = requests.get(
    f"{BASE}/api/crm/{CRM_ID}/accounts",
    headers={"X-API-Key": API_KEY},
)
print(resp.json())`;

  return (
    <div className="space-y-6">
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className="flex items-start justify-between gap-4 flex-wrap"
      >
        <div>
          <h2 className="heading-2 flex items-center gap-3">
            <PxKey className="h-6 w-6 text-[color:var(--theme-accent,#f54900)]" />
            API Keys
          </h2>
          <p className="text-sm text-default-500 mt-1">
            Your CRM credentials, base URL, and quick start. Copy what you need to
            integrate.
          </p>
        </div>

        <div className="flex gap-2">
          <Link href="/dashboard/api-docs">
            <Button
              size="sm"
              variant="bordered"
              className="!rounded-none border-white/[0.08] text-xs"
              startContent={<PxBookOpen className="h-3.5 w-3.5" />}
            >
              API Docs
            </Button>
          </Link>
        </div>
      </motion.div>

      <div className="grid grid-cols-1 xl:grid-cols-[1.1fr_1fr] gap-6 items-start">
        {/* Left: Credentials */}
        <GlassCard delay={0.05}>
          <GlassCardHeader>
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <PxShield className="h-4 w-4 text-[color:var(--theme-accent,#f54900)]" />
                <h3 className="text-sm font-semibold uppercase tracking-wider">
                  Credentials
                </h3>
              </div>
              <span
                className="inline-flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-wider px-1.5 py-0.5 border"
                style={{
                  color: revealed ? "#22c55e" : "var(--theme-accent, #f54900)",
                  borderColor: revealed
                    ? "rgba(34,197,94,0.3)"
                    : "rgba(var(--theme-accent-rgb,245,73,0),0.25)",
                  backgroundColor: revealed
                    ? "rgba(34,197,94,0.06)"
                    : "rgba(var(--theme-accent-rgb,245,73,0),0.06)",
                }}
              >
                <span
                  className={`h-1 w-1 ${revealed ? "bg-green-500 animate-pulse" : "bg-[color:var(--theme-accent,#f54900)]"}`}
                />
                {revealed ? "VISIBLE" : "HIDDEN"}
              </span>
            </div>
          </GlassCardHeader>

          <GlassCardBody className="space-y-5">
            {/* CRM ID */}
            <div>
              <div className="flex items-center gap-1.5 mb-2 text-default-500">
                <PxCode2 className="h-3 w-3" />
                <span className="text-[10px] uppercase tracking-wider">CRM ID</span>
              </div>
              <div className="flex items-stretch gap-2">
                <div className="flex-1 min-w-0 bg-black/40 border border-white/[0.08] px-3 py-2 font-mono text-sm text-white/90 truncate">
                  {crmId || "—"}
                </div>
                <CopyBtn
                  value={crmId}
                  field="crm"
                  copiedField={copiedField}
                  onCopy={copy}
                  disabled={!crmId}
                />
              </div>
            </div>

            {/* API Key */}
            <div>
              <div className="flex items-center gap-1.5 mb-2 text-default-500">
                <PxKey className="h-3 w-3" />
                <span className="text-[10px] uppercase tracking-wider">
                  API Key
                </span>
                {revealed && (
                  <span className="text-[10px] text-default-400 ml-auto">
                    Auto-hide in {secondsLeft}s
                  </span>
                )}
              </div>
              <div className="flex items-stretch gap-2">
                <div className="relative flex-1 min-w-0 bg-black/40 border border-white/[0.08] px-3 py-2 font-mono text-sm overflow-hidden">
                  <AnimatePresence mode="wait">
                    <motion.span
                      key={revealed ? "revealed" : "hidden"}
                      initial={{ opacity: 0, y: 3 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -3 }}
                      transition={{ duration: 0.18 }}
                      className={`block truncate ${revealed ? "text-white cursor-text" : "text-default-500 select-none cursor-default"}`}
                      title={revealed ? apiKey : undefined}
                    >
                      {displayedKey || "—"}
                    </motion.span>
                  </AnimatePresence>
                  <AnimatePresence>
                    {revealed && (
                      <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="absolute left-0 right-0 bottom-0 h-[2px] bg-white/[0.04]"
                      >
                        <motion.div
                          className="h-full"
                          style={{
                            backgroundColor: "var(--theme-accent, #f54900)",
                            width: `${progressPct}%`,
                          }}
                          transition={{ duration: 0.3 }}
                        />
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
                <Tooltip
                  content={revealed ? "Hide" : "Reveal"}
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
                    onPress={() => (revealed ? hide() : setRevealed(true))}
                    className="!rounded-none border-white/[0.08] min-w-9 w-9 h-9"
                    isDisabled={!apiKey}
                  >
                    {revealed ? (
                      <PxLock className="h-3.5 w-3.5 text-[color:var(--theme-accent,#f54900)]" />
                    ) : (
                      <PxEye className="h-3.5 w-3.5" />
                    )}
                  </Button>
                </Tooltip>
                <CopyBtn
                  value={apiKey}
                  field="key"
                  copiedField={copiedField}
                  onCopy={copy}
                  disabled={!apiKey}
                />
                <Tooltip
                  content="Rotate key"
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
                    onPress={onRotateOpen}
                    className="!rounded-none border-white/[0.08] min-w-9 w-9 h-9"
                    isDisabled={!crmId || rotating}
                  >
                    <PxZap className="h-3.5 w-3.5 text-[color:var(--theme-accent,#f54900)]" />
                  </Button>
                </Tooltip>
              </div>
            </div>

            {/* Base URL */}
            <div>
              <div className="flex items-center gap-1.5 mb-2 text-default-500">
                <PxGlobe className="h-3 w-3" />
                <span className="text-[10px] uppercase tracking-wider">
                  Base URL
                </span>
              </div>
              <div className="flex items-stretch gap-2">
                <div className="flex-1 min-w-0 bg-black/40 border border-white/[0.08] px-3 py-2 font-mono text-sm text-white/90 truncate">
                  {API_BASE_URL}
                </div>
                <CopyBtn
                  value={API_BASE_URL}
                  field="base"
                  copiedField={copiedField}
                  onCopy={copy}
                />
              </div>
              <p className="text-[10px] text-default-400 mt-1.5">
                All endpoints are scoped to{" "}
                <code className="bg-white/[0.06] px-1 text-foreground">
                  /api/crm/{crmId || "<crm_id>"}
                </code>
                .
              </p>
            </div>

            {/* Notice */}
            <div className="flex items-start gap-2 p-3 border border-white/[0.06] bg-white/[0.02]">
              <PxLock className="h-3.5 w-3.5 text-default-400 mt-0.5 shrink-0" />
              <p className="text-[11px] text-default-400 leading-relaxed">
                Treat your API key like a password. It carries the same
                privileges as your account. Use{" "}
                <button
                  type="button"
                  onClick={onRotateOpen}
                  disabled={!crmId || rotating}
                  className="text-[color:var(--theme-accent,#f54900)] hover:underline disabled:opacity-50 disabled:no-underline"
                >
                  Rotate key
                </button>{" "}
                if you suspect it was leaked — the old key stops working
                immediately.
              </p>
            </div>
          </GlassCardBody>
        </GlassCard>

        {/* Right: Quick start */}
        <GlassCard delay={0.1}>
          <GlassCardHeader>
            <div className="flex items-center gap-2">
              <PxZap className="h-4 w-4 text-[color:var(--theme-accent,#f54900)]" />
              <h3 className="text-sm font-semibold uppercase tracking-wider">
                Quick Start
              </h3>
            </div>
          </GlassCardHeader>

          <GlassCardBody className="space-y-5">
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-[10px] uppercase tracking-wider text-default-500">
                  curl
                </span>
                <CopyBtn
                  value={sampleCurl}
                  field="curl"
                  copiedField={copiedField}
                  onCopy={copy}
                />
              </div>
              <div className="bg-black/40 border border-white/[0.08] p-3 overflow-x-auto">
                <pre className="text-xs font-mono whitespace-pre text-white/90">
                  {sampleCurl}
                </pre>
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-[10px] uppercase tracking-wider text-default-500">
                  Python
                </span>
                <CopyBtn
                  value={samplePython}
                  field="python"
                  copiedField={copiedField}
                  onCopy={copy}
                />
              </div>
              <div className="bg-black/40 border border-white/[0.08] p-3 overflow-x-auto">
                <pre className="text-xs font-mono whitespace-pre text-white/90">
                  {samplePython}
                </pre>
              </div>
            </div>

            <div className="pt-2 border-t border-white/[0.06]">
              <p className="text-[11px] text-default-400 leading-relaxed">
                Want the full endpoint list with a "Try it" playground? Open the{" "}
                <Link
                  href="/dashboard/api-docs"
                  className="text-[color:var(--theme-accent,#f54900)] hover:underline font-semibold"
                >
                  API Docs →
                </Link>
              </p>
            </div>
          </GlassCardBody>
        </GlassCard>
      </div>

      {/* ── API keys console ───────────────────────────────────── */}
      <GlassCard delay={0.15}>
        <GlassCardHeader>
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-2">
              <PxKey className="h-4 w-4 text-[color:var(--theme-accent,#f54900)]" />
              <h3 className="text-sm font-semibold uppercase tracking-wider">
                Your API keys
              </h3>
            </div>
            <Button
              size="sm"
              onPress={() => {
                setCreatedKey(null);
                setNewName("");
                onCreateOpen();
              }}
              startContent={<PxPlus className="h-3.5 w-3.5" />}
              className="!rounded-none bg-[#f54900] text-white text-xs font-bold uppercase tracking-wider"
            >
              Create key
            </Button>
          </div>
        </GlassCardHeader>
        <GlassCardBody>
          <p className="text-[11px] text-default-400 mb-4 leading-relaxed">
            Create separate keys per integration and track each one&apos;s usage.
            The <span className="text-foreground">Default</span> key is used by this
            dashboard and your existing integrations — its request count includes
            dashboard traffic. Only the Default key can create or revoke keys.
          </p>

          <DataState
            compact
            loading={keysLoading}
            error={keysError}
            isEmpty={keys.length === 0}
            onRetry={loadKeys}
            noun="API keys"
            skeleton={
              <div className="py-10 text-center text-sm text-default-400">
                Loading keys…
              </div>
            }
            emptyContent={
              <div className="py-10 text-center text-sm text-default-400">
                No keys yet.
              </div>
            }
          >
            <Table
              aria-label="API keys"
              removeWrapper
              classNames={{
                th: "bg-transparent text-default-500 text-[10px] uppercase tracking-wider border-b border-white/[0.06]",
                td: "border-b border-white/[0.04] py-3",
              }}
            >
              <TableHeader>
                <TableColumn>NAME</TableColumn>
                <TableColumn>KEY</TableColumn>
                <TableColumn>CREATED</TableColumn>
                <TableColumn>LAST USED</TableColumn>
                <TableColumn>THIS MONTH</TableColumn>
                <TableColumn>30-DAY</TableColumn>
                <TableColumn> </TableColumn>
              </TableHeader>
              {/* Emptiness is decided by DataState above, which knows whether
                  the fetch succeeded — HeroUI's emptyContent does not. */}
              <TableBody>
                {keys.map((k) => (
                  <TableRow
                    key={k.id}
                    className={`cursor-pointer hover:bg-white/[0.02] ${k.revoked_at ? "opacity-50" : ""}`}
                  >
                    <TableCell onClick={() => openDetail(k)}>
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{k.name}</span>
                        {k.is_primary && (
                          <Chip
                            size="sm"
                            className="!rounded-none bg-[color:rgba(var(--theme-accent-rgb,245,73,0),0.1)] text-[color:var(--theme-accent,#f54900)] text-[9px] h-5"
                          >
                            Default
                          </Chip>
                        )}
                        {k.revoked_at && (
                          <Chip size="sm" className="!rounded-none bg-red-500/10 text-red-400 text-[9px] h-5">
                            Revoked
                          </Chip>
                        )}
                      </div>
                    </TableCell>
                    <TableCell onClick={() => openDetail(k)}>
                      <span className="font-mono text-xs text-default-400">
                        {k.prefix}••••••
                      </span>
                    </TableCell>
                    <TableCell onClick={() => openDetail(k)}>
                      <span className="text-xs text-default-400">{shortDate(k.created_at)}</span>
                    </TableCell>
                    <TableCell onClick={() => openDetail(k)}>
                      <span className="text-xs text-default-400">{relTime(k.last_used_at)}</span>
                    </TableCell>
                    <TableCell onClick={() => openDetail(k)}>
                      <span className="font-semibold text-sm">
                        {k.requests_this_month.toLocaleString()}
                      </span>
                    </TableCell>
                    <TableCell onClick={() => openDetail(k)}>
                      <Sparkline data={k.series} width={90} height={26} />
                    </TableCell>
                    <TableCell>
                      {k.is_primary ? (
                        <span className="text-[10px] text-default-500">rotate above</span>
                      ) : k.revoked_at ? (
                        <span className="text-[10px] text-default-500">—</span>
                      ) : (
                        <Button
                          size="sm"
                          variant="bordered"
                          isLoading={revoking === k.id}
                          onPress={() => handleRevoke(k)}
                          className="!rounded-none border-red-500/30 text-red-400 text-[11px] h-7"
                        >
                          Revoke
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </DataState>
        </GlassCardBody>
      </GlassCard>

      {/* Rotate-key confirmation — rotating is destructive (old key dies now) */}
      <Modal
        isOpen={rotateOpen}
        onClose={rotating ? undefined : onRotateClose}
        hideCloseButton={rotating}
        classNames={{
          base: "!rounded-none bg-[#0d0d0d] border border-white/[0.08]",
          header: "border-b border-white/[0.06]",
          footer: "border-t border-white/[0.06]",
        }}
      >
        <ModalContent>
          <ModalHeader className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider">
            <PxKey className="h-4 w-4 text-[color:var(--theme-accent,#f54900)]" />
            Rotate API key
          </ModalHeader>
          <ModalBody className="py-4 space-y-3 text-sm text-white/70">
            <p>
              This generates a new API key and{" "}
              <span className="text-white font-medium">
                immediately revokes the current one
              </span>
              .
            </p>
            <p className="text-[13px] text-default-400">
              Any integrations, scripts, SDKs, or MCP connections using the
              current key will stop working until you update them with the new
              key. This can&apos;t be undone.
            </p>
          </ModalBody>
          <ModalFooter>
            <Button
              size="sm"
              variant="bordered"
              onPress={onRotateClose}
              isDisabled={rotating}
              className="!rounded-none border-white/[0.08] text-xs"
            >
              Cancel
            </Button>
            <Button
              size="sm"
              onPress={handleRotate}
              isLoading={rotating}
              className="!rounded-none bg-[#f54900] text-white text-xs font-bold uppercase tracking-wider"
            >
              Rotate key
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      {/* Create-key modal — shows the full key ONCE */}
      <Modal
        isOpen={createOpen}
        onClose={creating ? undefined : closeCreate}
        hideCloseButton={creating}
        classNames={{
          base: "!rounded-none bg-[#0d0d0d] border border-white/[0.08]",
          header: "border-b border-white/[0.06]",
          footer: "border-t border-white/[0.06]",
        }}
      >
        <ModalContent>
          <ModalHeader className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider">
            <PxKey className="h-4 w-4 text-[color:var(--theme-accent,#f54900)]" />
            {createdKey ? "Save your new key" : "Create API key"}
          </ModalHeader>
          <ModalBody className="py-4 space-y-3">
            {!createdKey ? (
              <>
                <p className="text-[13px] text-default-400">
                  Give the key a name so you can recognise it later (e.g. the
                  integration or server it&apos;s for).
                </p>
                <Input
                  autoFocus
                  label="Key name"
                  value={newName}
                  onValueChange={setNewName}
                  variant="bordered"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleCreate();
                  }}
                  classNames={{ inputWrapper: "bg-white/[0.03] border-white/[0.08] !rounded-none" }}
                />
              </>
            ) : (
              <>
                <div className="flex items-start gap-2 p-3 border border-amber-500/30 bg-amber-500/[0.06]">
                  <PxLock className="h-3.5 w-3.5 text-amber-400 mt-0.5 shrink-0" />
                  <p className="text-[12px] text-amber-300 leading-relaxed">
                    Copy this key now — it won&apos;t be shown again. Store it
                    somewhere safe; treat it like a password.
                  </p>
                </div>
                <div className="flex items-stretch gap-2">
                  <div className="flex-1 min-w-0 bg-black/40 border border-white/[0.08] px-3 py-2 font-mono text-xs text-white/90 break-all">
                    {createdKey}
                  </div>
                  <CopyBtn
                    value={createdKey}
                    field="newkey"
                    copiedField={copiedField}
                    onCopy={copy}
                  />
                </div>
              </>
            )}
          </ModalBody>
          <ModalFooter>
            {!createdKey ? (
              <>
                <Button
                  size="sm"
                  variant="bordered"
                  onPress={closeCreate}
                  isDisabled={creating}
                  className="!rounded-none border-white/[0.08] text-xs"
                >
                  Cancel
                </Button>
                <Button
                  size="sm"
                  onPress={handleCreate}
                  isLoading={creating}
                  className="!rounded-none bg-[#f54900] text-white text-xs font-bold uppercase tracking-wider"
                >
                  Create key
                </Button>
              </>
            ) : (
              <Button
                size="sm"
                onPress={closeCreate}
                className="!rounded-none bg-[#f54900] text-white text-xs font-bold uppercase tracking-wider"
              >
                Done
              </Button>
            )}
          </ModalFooter>
        </ModalContent>
      </Modal>

      {/* Per-key usage detail */}
      <Modal
        isOpen={detailOpen}
        onClose={onDetailClose}
        size="2xl"
        scrollBehavior="inside"
        classNames={{
          base: "!rounded-none bg-[#0d0d0d] border border-white/[0.08]",
          header: "border-b border-white/[0.06]",
        }}
      >
        <ModalContent>
          <ModalHeader className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider">
            <PxActivity className="h-4 w-4 text-[color:var(--theme-accent,#f54900)]" />
            {detailKey?.name || "Key"} · usage
          </ModalHeader>
          <ModalBody className="py-4 space-y-5">
            {detailLoading || !detailUsage ? (
              <div className="py-8 text-center text-sm text-default-400">Loading…</div>
            ) : (
              <>
                <div className="grid grid-cols-3 gap-3">
                  <div className="border border-white/[0.06] bg-white/[0.02] p-3">
                    <div className="text-[10px] uppercase tracking-wider text-default-500">This month</div>
                    <div className="text-2xl font-bold mt-1">
                      {detailUsage.totals.month_total.toLocaleString()}
                    </div>
                  </div>
                  <div className="border border-white/[0.06] bg-white/[0.02] p-3">
                    <div className="text-[10px] uppercase tracking-wider text-default-500">All time</div>
                    <div className="text-2xl font-bold mt-1">
                      {detailUsage.totals.all_time_total.toLocaleString()}
                    </div>
                  </div>
                  <div className="border border-white/[0.06] bg-white/[0.02] p-3">
                    <div className="text-[10px] uppercase tracking-wider text-default-500">Last used</div>
                    <div className="text-sm font-semibold mt-2">
                      {relTime(detailUsage.totals.last_used_at)}
                    </div>
                  </div>
                </div>

                <div>
                  <div className="text-[10px] uppercase tracking-wider text-default-500 mb-2">
                    Requests · last 30 days
                  </div>
                  <div className="border border-white/[0.06] bg-black/30 p-3">
                    <Sparkline
                      data={(detailUsage.series || []).map((p: any) => p.count)}
                      width="100%"
                      height={64}
                    />
                  </div>
                </div>

                <div>
                  <div className="text-[10px] uppercase tracking-wider text-default-500 mb-2">
                    Top endpoints · this month
                  </div>
                  {detailUsage.endpoints.length === 0 ? (
                    <p className="text-xs text-default-400">No requests yet.</p>
                  ) : (
                    <div className="space-y-1">
                      {detailUsage.endpoints.slice(0, 10).map((e: any) => (
                        <div
                          key={e.endpoint}
                          className="flex items-center justify-between gap-3 border border-white/[0.04] bg-white/[0.02] px-3 py-1.5"
                        >
                          <span className="font-mono text-[11px] text-default-400 truncate">
                            {e.endpoint}
                          </span>
                          <span className="text-xs font-semibold shrink-0">
                            {e.count.toLocaleString()}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </>
            )}
          </ModalBody>
          <ModalFooter className="border-t border-white/[0.06]">
            <Button
              size="sm"
              variant="bordered"
              onPress={onDetailClose}
              className="!rounded-none border-white/[0.08] text-xs"
            >
              Close
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </div>
  );
}
