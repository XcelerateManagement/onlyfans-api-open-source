"use client";

import { useEffect, useRef, useState } from "react";
import { useSession } from "next-auth/react";
import Image from "next/image";
import { Button } from "@heroui/button";
import { Input } from "@heroui/input";
import {
  GlassCard,
  GlassCardHeader,
  GlassCardBody,
} from "@/components/dashboard/GlassCard";
import { PxUser, PxLock, PxMail } from "@/components/ui/PixelIcons";
import { Upload, Trash2 } from "lucide-react";
import toast from "react-hot-toast";
import { useConfirm } from "@/lib/hooks/use-confirm";

const inputClassNames = {
  inputWrapper: "bg-white/[0.03] border-white/[0.08] !rounded-none",
};

type EmailStep = "idle" | "request" | "verify";

/**
 * Profile card — avatar upload + email change. Sits at the top of /dashboard/settings.
 */
export function ProfileCard() {
  const { data: session, update: updateSession } = useSession();
  const confirm = useConfirm();
  const avatarUrl = (session?.user as any)?.avatar as string | undefined;
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── Avatar upload state ──
  const [avatarBusy, setAvatarBusy] = useState(false);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);

  const handleAvatarPick = () => fileInputRef.current?.click();

  const handleAvatarChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 4 * 1024 * 1024) {
      toast.error("Avatar must be ≤ 4MB");
      return;
    }
    // Show local preview immediately for snappy feedback; replace with the
    // canonical server URL once upload completes.
    const localUrl = URL.createObjectURL(file);
    setAvatarPreview(localUrl);
    setAvatarBusy(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/user/avatar", { method: "POST", body: fd });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(body.error || "Upload failed");
        setAvatarPreview(null);
        return;
      }
      setAvatarPreview(body.avatarUrl);
      // Bump NextAuth session so the navbar pfp refreshes without a reload.
      try {
        await updateSession({ avatar: body.avatarUrl });
        toast.success("Avatar updated");
      } catch (e) {
        console.warn("[avatar] updateSession failed:", e);
        toast("Avatar saved — refresh to see it everywhere", { icon: "⚠️" });
      }
    } catch (err: any) {
      toast.error(err?.message || "Upload failed");
      setAvatarPreview(null);
    } finally {
      setAvatarBusy(false);
      // Clear the input so the same file can be re-picked.
      e.target.value = "";
    }
  };

  const handleAvatarRemove = async () => {
    if (!avatarPreview && !avatarUrl) return;
    if (
      !(await confirm({
        title: "Remove profile picture?",
        confirmLabel: "Remove",
        danger: true,
      }))
    )
      return;
    setAvatarBusy(true);
    try {
      const res = await fetch("/api/user/avatar", { method: "DELETE" });
      if (!res.ok) {
        toast.error("Failed to remove avatar");
        return;
      }
      setAvatarPreview(null);
      // Best-effort session sync — if it fails the user will see the old avatar
      // in the navbar until next page load, which is acceptable. We still toast
      // success because the server-side removal succeeded.
      try {
        await updateSession({ avatar: null });
      } catch (err) {
        console.warn("[avatar] updateSession failed:", err);
        toast("Avatar removed — refresh to see it everywhere", { icon: "⚠️" });
        return;
      }
      toast.success("Avatar removed");
    } catch (err: any) {
      toast.error(err?.message || "Failed to remove avatar");
    } finally {
      setAvatarBusy(false);
    }
  };

  // ── Email change state ──
  const [emailStep, setEmailStep] = useState<EmailStep>("idle");
  const [newEmail, setNewEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [emailBusy, setEmailBusy] = useState(false);

  const handleEmailRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newEmail || !password) return;
    setEmailBusy(true);
    try {
      const res = await fetch("/api/user/email/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ newEmail, password }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(body.error || "Email change failed");
        return;
      }
      toast.success(`Code sent to ${newEmail}`);
      setEmailStep("verify");
      setPassword(""); // never keep around after submit
    } finally {
      setEmailBusy(false);
    }
  };

  const handleEmailConfirm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!code) return;
    setEmailBusy(true);
    try {
      const res = await fetch("/api/user/email/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: code.trim() }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(body.error || "Verification failed");
        return;
      }
      toast.success(`Email updated to ${body.email || newEmail}`);
      try {
        await updateSession({ email: body.email || newEmail });
      } catch { /* not fatal */ }
      setEmailStep("idle");
      setNewEmail("");
      setCode("");
    } finally {
      setEmailBusy(false);
    }
  };

  const handleEmailCancel = () => {
    setEmailStep("idle");
    setNewEmail("");
    setPassword("");
    setCode("");
  };

  const displayedAvatar = avatarPreview || avatarUrl || null;
  const initials = (session?.user?.name || session?.user?.email || "?").slice(0, 2).toUpperCase();

  return (
    <GlassCard delay={0}>
      <GlassCardHeader>
        <div className="flex items-center gap-3">
          <PxUser className="h-5 w-5 text-[color:var(--theme-accent,#f54900)]" />
          <h3 className="text-lg font-semibold">Profile</h3>
        </div>
      </GlassCardHeader>
      <GlassCardBody>
        <div className="flex flex-col sm:flex-row gap-6 items-start">
          {/* Avatar block */}
          <div className="flex flex-col items-center gap-2">
            <div className="relative h-24 w-24 rounded-full overflow-hidden border border-white/[0.08] bg-white/[0.03] flex items-center justify-center">
              {displayedAvatar ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={displayedAvatar} alt="" className="h-full w-full object-cover" />
              ) : (
                <span className="text-2xl text-white/40 font-bold">{initials}</span>
              )}
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/jpg,image/webp"
              className="hidden"
              onChange={handleAvatarChange}
            />
            <div className="flex gap-1.5">
              <Button
                size="sm"
                variant="bordered"
                className="rounded-none uppercase tracking-wider font-bold text-xs"
                startContent={<Upload className="h-3 w-3" />}
                isDisabled={avatarBusy}
                onPress={handleAvatarPick}
              >
                {avatarBusy ? "Uploading…" : "Upload"}
              </Button>
              {displayedAvatar && (
                <Button
                  size="sm"
                  variant="light"
                  className="rounded-none uppercase tracking-wider font-bold text-xs text-red-400"
                  isDisabled={avatarBusy}
                  onPress={handleAvatarRemove}
                >
                  <Trash2 className="h-3 w-3" />
                </Button>
              )}
            </div>
            <p className="text-[10px] text-default-400 text-center max-w-[120px]">
              PNG/JPG/WEBP · 4MB max · resized to 256px
            </p>
          </div>

          {/* Email change block */}
          <div className="flex-1 w-full">
            <div className="flex items-center gap-2 mb-2">
              <PxMail className="h-4 w-4 text-default-400" />
              <span className="text-sm font-semibold">Email</span>
            </div>
            <p className="text-sm text-white/80 mb-3">{session?.user?.email}</p>

            {emailStep === "idle" && (
              <Button
                size="sm"
                variant="bordered"
                className="rounded-none uppercase tracking-wider font-bold text-xs"
                onPress={() => setEmailStep("request")}
              >
                Change email
              </Button>
            )}

            {emailStep === "request" && (
              <form onSubmit={handleEmailRequest} className="space-y-2">
                <Input
                  type="email"
                  placeholder="new@email.com"
                  value={newEmail}
                  onValueChange={setNewEmail}
                  startContent={<PxMail className="h-3 w-3 text-default-400" />}
                  variant="bordered"
                  size="sm"
                  isRequired
                  classNames={inputClassNames}
                  isDisabled={emailBusy}
                />
                <Input
                  type="password"
                  placeholder="Current password"
                  value={password}
                  onValueChange={setPassword}
                  startContent={<PxLock className="h-3 w-3 text-default-400" />}
                  variant="bordered"
                  size="sm"
                  isRequired
                  classNames={inputClassNames}
                  isDisabled={emailBusy}
                />
                <div className="flex gap-2">
                  <Button
                    type="submit"
                    size="sm"
                    className="bg-accent text-white hover:bg-accent-hover rounded-none uppercase tracking-wider font-bold text-xs"
                    isLoading={emailBusy}
                  >
                    Send code
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="light"
                    className="rounded-none uppercase tracking-wider font-bold text-xs"
                    onPress={handleEmailCancel}
                    isDisabled={emailBusy}
                  >
                    Cancel
                  </Button>
                </div>
                <p className="text-[11px] text-default-400">
                  We&apos;ll email a code to the new address. A security notice goes to your current email too.
                </p>
              </form>
            )}

            {emailStep === "verify" && (
              <form onSubmit={handleEmailConfirm} className="space-y-2">
                <p className="text-sm text-default-500">
                  Code sent to <span className="text-foreground font-mono">{newEmail}</span>
                </p>
                <Input
                  type="text"
                  inputMode="numeric"
                  pattern="\d{4,10}"
                  placeholder="6-digit code"
                  value={code}
                  onValueChange={setCode}
                  variant="bordered"
                  size="sm"
                  isRequired
                  autoFocus
                  classNames={inputClassNames}
                  isDisabled={emailBusy}
                />
                <div className="flex gap-2">
                  <Button
                    type="submit"
                    size="sm"
                    className="bg-accent text-white hover:bg-accent-hover rounded-none uppercase tracking-wider font-bold text-xs"
                    isLoading={emailBusy}
                  >
                    Confirm
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="light"
                    className="rounded-none uppercase tracking-wider font-bold text-xs"
                    onPress={handleEmailCancel}
                    isDisabled={emailBusy}
                  >
                    Cancel
                  </Button>
                </div>
              </form>
            )}
          </div>
        </div>
      </GlassCardBody>
    </GlassCard>
  );
}
