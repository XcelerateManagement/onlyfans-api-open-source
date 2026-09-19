"use client";

/**
 * Confirm an account's OnlyFans 2FA from next to the account.
 *
 * OnlyFans can gate an account behind a second factor (error 101/105) — either
 * the moment it's connected (a login step-up) or later, when a poll hits a
 * session OnlyFans decided to re-challenge. The account row shows a "Confirm
 * 2FA" affordance; this modal completes it.
 *
 * The inputs are driven entirely by the factors OnlyFans reports (`methods`):
 *   - `app`   → a code input (the authenticator generates it; nothing to send)
 *   - `email` → "Send code to ali***@example.com" then a code input
 *   - `sms`   → "Send code to ***1234" then a code input
 *   - `face`  → not a typed code; hand off to the face-verification flow
 *
 * On success the backend swaps the gated session for the elevated one, clears
 * the flag, and fires `verification.approved` — the caller just refetches.
 *
 * Lives under `components/` (Tailwind's `source(none)` only scans ../app and
 * ../components; a component under lib/ renders unstyled).
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Button,
  Input,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
} from "@heroui/react";
import { KeyRound, Mail, MessageSquare, ScanFace, Send } from "lucide-react";

import type {
  CrmApiClient,
  TwoFactorMethod,
} from "@/lib/api-client";
import type { OfAccount } from "@/lib/hooks/use-selected-account";

interface Props {
  account: OfAccount | null;
  api: CrmApiClient | null | undefined;
  onClose: () => void;
  /** Fired once the gate clears so the caller can refetch its list. */
  onConfirmed?: () => void;
  /** Face-only accounts route here instead of showing a code input. */
  onUseFace?: (account: OfAccount) => void;
}

const METHOD_META: Record<
  Exclude<TwoFactorMethod, "face">,
  { label: string; hint: string; icon: typeof KeyRound; sendable: boolean }
> = {
  app: {
    label: "Authenticator app",
    hint: "Enter the current 6-digit code from the account's authenticator app.",
    icon: KeyRound,
    sendable: false,
  },
  email: {
    label: "Email code",
    hint: "OnlyFans emails a code to the account.",
    icon: Mail,
    sendable: true,
  },
  sms: {
    label: "Text message",
    hint: "OnlyFans texts a code to the account's phone.",
    icon: MessageSquare,
    sendable: true,
  },
};

function maskFromOtpState(
  method: TwoFactorMethod,
  otpState: Record<string, unknown> | null | undefined,
): string | null {
  if (!otpState) return null;
  if (method === "email" && typeof otpState.emailMask === "string")
    return otpState.emailMask;
  if (method === "sms" && typeof otpState.phoneLast4 === "string")
    return `***${otpState.phoneLast4}`;
  return null;
}

export function TwoFactorModal({
  account,
  api,
  onClose,
  onConfirmed,
  onUseFace,
}: Props) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);

  const ofUserId = account?.of_user_id ?? null;
  const verification = account?.verification ?? null;
  const otpState = verification?.otp_state ?? null;

  // Factors OnlyFans offered, in a stable order. Derived from the account's
  // otpState so the modal never guesses — forced-face collapses to ["face"].
  const methods = useMemo<TwoFactorMethod[]>(() => {
    if (verification?.face_required) return ["face"];
    const order: TwoFactorMethod[] = ["app", "email", "sms", "face"];
    const flags: Record<string, boolean> = {
      app: Boolean((otpState as Record<string, unknown>)?.appOtp),
      email: Boolean((otpState as Record<string, unknown>)?.email),
      sms: Boolean((otpState as Record<string, unknown>)?.phoneOtp),
      face: Boolean((otpState as Record<string, unknown>)?.faceOtp),
    };
    const found = order.filter((m) => flags[m]);
    return found.length ? found : ["app"];
  }, [verification?.face_required, otpState]);

  const codeMethods = methods.filter(
    (m): m is Exclude<TwoFactorMethod, "face"> => m !== "face",
  );
  const faceOnly = methods.length === 1 && methods[0] === "face";

  const [channel, setChannel] = useState<Exclude<TwoFactorMethod, "face">>(
    codeMethods[0] ?? "app",
  );

  useEffect(() => {
    setCode("");
    setError(null);
    setSent(null);
    setChannel(codeMethods[0] ?? "app");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ofUserId]);

  const sendCode = useCallback(async () => {
    if (!api || !ofUserId || channel === "app") return;
    setSending(true);
    setError(null);
    try {
      const res = await api.request2faCode(ofUserId, channel);
      setSent(res.message || "Code sent.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not send a code.");
    } finally {
      setSending(false);
    }
  }, [api, ofUserId, channel]);

  const submit = useCallback(async () => {
    if (!api || !ofUserId || !code.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await api.submit2fa(ofUserId, code.trim());
      onConfirmed?.();
      onClose();
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "That code was not accepted. Check the newest code and try again.",
      );
    } finally {
      setBusy(false);
    }
  }, [api, ofUserId, code, onConfirmed, onClose]);

  const mask = maskFromOtpState(channel, otpState);

  return (
    <Modal isOpen={!!account} onClose={onClose} placement="center" size="lg">
      <ModalContent>
        <ModalHeader className="flex items-center gap-2">
          <ScanFace className="h-4 w-4 text-amber-400" />
          Confirm 2FA — {account?.username ? `@${account.username}` : account?.email}
        </ModalHeader>
        <ModalBody className="gap-4">
          {error && <div className="dashboard-error">{error}</div>}

          <p className="text-sm text-default-500">
            OnlyFans is holding this account behind a second factor. The password
            is fine — it just needs one code to finish connecting.
          </p>

          {faceOnly ? (
            <div className="border border-amber-500/25 bg-amber-500/[0.05] px-3 py-3 text-[13px] leading-relaxed text-amber-200/90">
              This account requires a <span className="font-medium">face check</span>,
              which can&apos;t be done with a typed code.
              <div className="mt-2">
                <Button
                  size="sm"
                  color="warning"
                  className="rounded-none"
                  onPress={() => account && onUseFace?.(account)}
                  startContent={<ScanFace className="h-4 w-4" />}
                >
                  Start face verification
                </Button>
              </div>
            </div>
          ) : (
            <>
              {codeMethods.length > 1 && (
                <div className="flex flex-wrap gap-2">
                  {codeMethods.map((m) => {
                    const Meta = METHOD_META[m];
                    const active = channel === m;
                    return (
                      <button
                        key={m}
                        type="button"
                        onClick={() => {
                          setChannel(m);
                          setSent(null);
                          setError(null);
                        }}
                        className={`inline-flex items-center gap-1.5 rounded-none border px-2.5 py-1 text-xs font-medium transition-colors ${
                          active
                            ? "border-amber-500/40 bg-amber-500/15 text-amber-300"
                            : "border-white/[0.08] bg-white/[0.02] text-default-400 hover:text-default-200"
                        }`}
                      >
                        <Meta.icon className="h-3.5 w-3.5" />
                        {Meta.label}
                      </button>
                    );
                  })}
                </div>
              )}

              <p className="text-xs text-default-400">
                {METHOD_META[channel].hint}
                {mask ? ` (${mask})` : ""}
              </p>

              {METHOD_META[channel].sendable && (
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="flat"
                    className="rounded-none"
                    isLoading={sending}
                    onPress={sendCode}
                    startContent={!sending && <Send className="h-3.5 w-3.5" />}
                  >
                    Send code
                  </Button>
                  {sent && <span className="text-xs text-green-400">{sent}</span>}
                </div>
              )}

              <Input
                label="Verification code"
                value={code}
                onValueChange={(v) => setCode(v.replace(/[^0-9]/g, "").slice(0, 8))}
                autoFocus
                inputMode="numeric"
                placeholder="6-digit code"
                variant="bordered"
                classNames={{
                  inputWrapper: "bg-white/[0.03] border-white/[0.08] !rounded-none",
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void submit();
                }}
              />

              {/* Face is deliberately NOT offered as an alternative here even
                  when OnlyFans lists it: a login-2FA face factor is an approval
                  in the OnlyFans mobile app, which a web selfie URL cannot
                  satisfy (the selfie URL is identity verification, a different
                  system). A typed code is the path that actually works, so we
                  keep the user on it. Forced-face accounts have no code factor
                  and fall into the faceOnly branch above. */}
            </>
          )}
        </ModalBody>
        <ModalFooter>
          <Button variant="light" onPress={onClose} className="rounded-none">
            Close
          </Button>
          {!faceOnly && (
            <Button
              color="warning"
              className="rounded-none font-medium"
              isLoading={busy}
              isDisabled={!code.trim()}
              onPress={submit}
            >
              Confirm
            </Button>
          )}
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}
