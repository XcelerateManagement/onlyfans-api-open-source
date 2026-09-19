"use client";

/**
 * OnlyFans face (selfie) verification for one account.
 *
 * OnlyFans can park an account behind a liveness check. While it is up, every
 * account-scoped call answers 403 `{reason: "face_id_required"}` — the session
 * and the password are both fine, so the reconnect flow is useless here. The
 * only way through is a human passing the check at OnlyFans' identity
 * provider.
 *
 * The one non-obvious constraint, and the reason this modal talks about IPs at
 * all: **OnlyFans ties the check to the session's egress IP.** The account's
 * traffic leaves through its proxy, so the browser doing the selfie has to
 * leave through the same place. Opening `verify_url` on a laptop with an
 * ordinary connection does not merely fail silently — it burns one of the
 * three attempts OnlyFans grants. That is why the proxy line below is shown as
 * a checklist item and not as a footnote.
 *
 * Progress is watched server-side (of_faceid.py polls /users/me), so this
 * component only has to poll one cheap status route and react.
 *
 * Lives under `components/` on purpose — Tailwind's `source(none)` config only
 * scans `../app` and `../components`, so a component under `lib/` renders
 * unstyled. See styles/globals.css.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Button,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
} from "@heroui/react";
import { ExternalLink, ShieldCheck, TriangleAlert } from "lucide-react";

import type { CrmApiClient, FaceIdStatus } from "@/lib/api-client";
import type { OfAccount } from "@/lib/hooks/use-selected-account";

/** How often to ask the backend where the check stands. The server is doing
 *  the real polling against OnlyFans; this is just the UI catching up. */
const POLL_MS = 4000;

interface Props {
  account: OfAccount | null;
  api: CrmApiClient | null | undefined;
  onClose: () => void;
  /** Called once the gate lifts, so the caller can refetch its account list. */
  onVerified?: () => void;
}

export function FaceVerifyModal({ account, api, onClose, onVerified }: Props) {
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [verifyUrl, setVerifyUrl] = useState<string | null>(null);
  const [status, setStatus] = useState<FaceIdStatus | null>(null);
  const notified = useRef(false);

  const ofUserId = account?.of_user_id ?? null;

  // Reset per account — reopening the modal for a different creator must not
  // show the previous one's verify URL.
  useEffect(() => {
    setVerifyUrl(null);
    setStatus(null);
    setError(null);
    notified.current = false;
  }, [ofUserId]);

  const refresh = useCallback(async () => {
    if (!api || !ofUserId) return;
    try {
      const next = await api.getFaceIdStatus(ofUserId);
      setStatus(next);
      if (next.redirect_url) setVerifyUrl((prev) => prev ?? next.redirect_url!);
      if (next.status === "approved" && !notified.current) {
        notified.current = true;
        onVerified?.();
      }
    } catch {
      // A failed status poll is not worth an error banner — the next tick
      // either recovers or the user closes the modal.
    }
  }, [api, ofUserId, onVerified]);

  // Poll while open and unresolved.
  useEffect(() => {
    if (!ofUserId) return;
    void refresh();
    if (status?.status === "approved") return;
    const id = setInterval(() => void refresh(), POLL_MS);
    return () => clearInterval(id);
  }, [ofUserId, refresh, status?.status]);

  const start = async () => {
    if (!api || !ofUserId) return;
    setStarting(true);
    setError(null);
    try {
      const res = await api.startFaceId(ofUserId, "regular");
      setVerifyUrl(res.verify_url);
      if (res.status) setStatus(res.status);
      window.open(res.verify_url, "_blank", "noopener,noreferrer");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not start the check.");
    } finally {
      setStarting(false);
    }
  };

  const approved = status?.status === "approved";
  const pending = status?.status === "pending";
  const failed = status?.status === "timeout" || status?.status === "error";

  return (
    <Modal isOpen={!!account} onClose={onClose} placement="center" size="lg">
      <ModalContent>
        <ModalHeader className="flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-amber-400" />
          Verify {account?.username ? `@${account.username}` : account?.email}
        </ModalHeader>
        <ModalBody className="gap-4">
          {error && <div className="dashboard-error">{error}</div>}

          {approved ? (
            <div className="border border-green-500/30 bg-green-500/[0.06] px-3 py-2 text-[13px] text-green-300">
              Verified — OnlyFans is answering for this account again.
            </div>
          ) : (
            <>
              <p className="text-sm text-default-500">
                OnlyFans is holding this account behind a face check. No code
                can clear it: someone has to pass a short selfie check on
                OnlyFans&apos; identity provider.
              </p>

              <div className="border border-amber-500/25 bg-amber-500/[0.05] px-3 py-2.5">
                <div className="flex items-start gap-2">
                  <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
                  <div className="text-[13px] leading-relaxed text-amber-200/90">
                    <span className="font-medium">
                      Open the link from this account&apos;s own IP.
                    </span>{" "}
                    OnlyFans checks that the browser doing the selfie is on the
                    same address as the session
                    {account?.proxy_country
                      ? ` (this account exits in ${account.proxy_country})`
                      : ""}
                    . A different connection fails the check and spends one of
                    three attempts.
                  </div>
                </div>
              </div>

              {status?.otp_state ? (
                <div className="text-xs text-default-400">
                  OnlyFans reports:{" "}
                  {(status.otp_state as { emailMask?: string }).emailMask
                    ? `account ${(status.otp_state as { emailMask?: string }).emailMask}, `
                    : ""}
                  face check{" "}
                  {(status.otp_state as { forceFaceOtp?: boolean }).forceFaceOtp
                    ? "required (no other factor offered)"
                    : "available"}
                  .
                </div>
              ) : null}

              {verifyUrl && (
                <div className="border border-white/[0.08] bg-white/[0.02] px-3 py-2">
                  <div className="mb-1 text-xs uppercase tracking-wider text-default-400">
                    Verification link
                  </div>
                  <code className="block break-all text-xs text-default-300">
                    {verifyUrl}
                  </code>
                </div>
              )}

              {pending && (
                <div className="text-[13px] text-default-400">
                  Waiting for OnlyFans to lift the check
                  {typeof status?.expires_in_seconds === "number"
                    ? ` — giving up in ${Math.ceil(status.expires_in_seconds / 60)} min`
                    : ""}
                  . You can close this; it keeps running.
                </div>
              )}

              {failed && (
                <div className="text-[13px] text-red-300">
                  {status?.detail || "The check did not complete."} Start it
                  again when whoever holds the phone is ready.
                </div>
              )}
            </>
          )}
        </ModalBody>
        <ModalFooter>
          <Button variant="light" onPress={onClose} className="rounded-none">
            Close
          </Button>
          {!approved && (
            <Button
              color="warning"
              isLoading={starting}
              onPress={start}
              className="rounded-none font-medium"
              startContent={!starting && <ExternalLink className="h-4 w-4" />}
            >
              {verifyUrl ? "Reopen check" : "Start verification"}
            </Button>
          )}
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}
