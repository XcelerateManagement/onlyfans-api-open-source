"use client";

/**
 * Mass DM ("massive messaging") composer.
 *
 * Flow: pick an audience → Preview (dry-run resolves the real recipient count
 * from the subscriber cache, sends nothing) → Send. Sending is gated per
 * account by `allow_of_write_actions`, which ships OFF as a safety default
 * (nothing can DM your fans until you opt in). Rather than dead-ending on a
 * 403, the first Send flips that flag on with a clear heads-up, then delivers.
 */

import { useCallback, useEffect, useState } from "react";
import {
  Modal,
  ModalContent,
  ModalHeader,
  ModalBody,
  ModalFooter,
} from "@heroui/modal";
import { Button } from "@heroui/button";
import { Textarea, Input } from "@heroui/input";
import { Select, SelectItem } from "@heroui/select";
import { Chip } from "@heroui/chip";
import toast from "react-hot-toast";
import { useApiClient } from "@/lib/hooks/use-api-client";

type Audience = "active" | "all" | "expired";

const AUDIENCE_LABEL: Record<Audience, string> = {
  active: "Active subscribers",
  all: "All subscribers",
  expired: "Expired subscribers",
};

export function MassDmModal({
  isOpen,
  onClose,
  ofUserId,
  defaultAudience = "active",
}: {
  isOpen: boolean;
  onClose: () => void;
  ofUserId: string;
  defaultAudience?: Audience;
}) {
  const api = useApiClient();

  const [text, setText] = useState("");
  const [price, setPrice] = useState("");
  const [audience, setAudience] = useState<Audience>(defaultAudience);
  const [minSpent, setMinSpent] = useState("");

  const [writesEnabled, setWritesEnabled] = useState<boolean | null>(null);
  const [recipients, setRecipients] = useState<number | null>(null);
  const [sample, setSample] = useState<Array<{ username: string | null }>>([]);
  const [previewing, setPreviewing] = useState(false);
  const [sending, setSending] = useState(false);

  // Reset + read the account's current write-gate whenever the modal opens.
  useEffect(() => {
    if (!isOpen) return;
    setText("");
    setPrice("");
    setMinSpent("");
    setAudience(defaultAudience);
    setRecipients(null);
    setSample([]);
    if (!api || !ofUserId) return;
    api
      .getAccountPolling(ofUserId)
      .then((r) => setWritesEnabled(!!r.polling?.allow_of_write_actions))
      .catch(() => setWritesEnabled(null));
  }, [isOpen, ofUserId, defaultAudience, api]);

  // A change to the targeting invalidates a stale recipient count.
  useEffect(() => {
    setRecipients(null);
    setSample([]);
  }, [audience, minSpent]);

  const buildAudience = useCallback(() => {
    const a: { type: Audience; min_spent?: number } = { type: audience };
    const ms = parseFloat(minSpent);
    if (!isNaN(ms) && ms > 0) a.min_spent = ms;
    return a;
  }, [audience, minSpent]);

  const handlePreview = async () => {
    if (!api || !ofUserId) return;
    setPreviewing(true);
    try {
      const res = await api.sendMassMessage(ofUserId, {
        text: text || "preview",
        audience: buildAudience(),
        dryRun: true,
      });
      setRecipients(res.recipients ?? 0);
      setSample(res.sample ?? []);
      if (!res.recipients) toast(res.note || "No subscribers matched this audience.");
    } catch (err: any) {
      toast.error(err?.message || "Preview failed");
    } finally {
      setPreviewing(false);
    }
  };

  const handleSend = async () => {
    if (!api || !ofUserId) return;
    if (!text.trim()) {
      toast.error("Write a message first.");
      return;
    }
    if (!recipients) {
      toast.error("Preview the audience first so you can see who this reaches.");
      return;
    }
    setSending(true);
    try {
      // The write-gate is OFF by default for safety. Turn it on the first time
      // the operator actually sends, and tell them we did.
      if (!writesEnabled) {
        await api.updateAccountPolling(ofUserId, { allow_of_write_actions: true });
        setWritesEnabled(true);
        toast("Message sending enabled for this account.", { icon: "🔓" });
      }
      const res = await api.sendMassMessage(ofUserId, {
        text,
        price: parseFloat(price) || 0,
        audience: buildAudience(),
        dryRun: false,
      });
      const failed = res.failed ?? 0;
      if (res.sent > 0 && failed === 0) {
        toast.success(`Sent to ${res.sent} ${res.sent === 1 ? "fan" : "fans"} 🎉`);
        onClose();
      } else if (res.sent > 0) {
        toast(`Sent to ${res.sent}, ${failed} failed. Check activity for details.`);
        onClose();
      } else {
        toast.error(res.note || "Nothing was sent.");
      }
    } catch (err: any) {
      // WRITES_DISABLED is handled globally (WritesDisabledWatcher) — skip the
      // redundant generic toast.
      if (err?.data?.code === "WRITES_DISABLED") return;
      toast.error(err?.message || "Send failed");
    } finally {
      setSending(false);
    }
  };

  const priceNum = parseFloat(price) || 0;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      size="lg"
      backdrop="blur"
      classNames={{
        base: "bg-[#0d0d0d] border border-white/[0.08] rounded-none",
        header: "border-b border-white/[0.06]",
        footer: "border-t border-white/[0.06]",
      }}
    >
      <ModalContent>
        <ModalHeader className="flex flex-col gap-1">
          <span className="text-lg font-bold">Mass DM</span>
          <span className="text-xs font-normal text-default-500">
            Message many subscribers at once{priceNum > 0 ? " · PPV" : ""}
          </span>
        </ModalHeader>

        <ModalBody className="gap-4 py-4">
          {/* Audience */}
          <div className="flex gap-3 flex-wrap">
            <Select
              size="sm"
              label="Audience"
              labelPlacement="outside"
              selectedKeys={[audience]}
              onChange={(e) => setAudience((e.target.value || "active") as Audience)}
              className="max-w-[240px]"
              classNames={{ trigger: "bg-white/[0.03] border-white/[0.08] !rounded-none" }}
            >
              {(Object.keys(AUDIENCE_LABEL) as Audience[]).map((k) => (
                <SelectItem key={k}>{AUDIENCE_LABEL[k]}</SelectItem>
              ))}
            </Select>

            <Input
              size="sm"
              type="number"
              label="Min. spent ($)"
              labelPlacement="outside"
              placeholder="0"
              value={minSpent}
              onValueChange={setMinSpent}
              className="max-w-[140px]"
              classNames={{ inputWrapper: "bg-white/[0.03] border-white/[0.08] !rounded-none" }}
            />

            <Input
              size="sm"
              type="number"
              label="PPV price ($)"
              labelPlacement="outside"
              placeholder="0 = free"
              value={price}
              onValueChange={setPrice}
              className="max-w-[140px]"
              classNames={{ inputWrapper: "bg-white/[0.03] border-white/[0.08] !rounded-none" }}
            />
          </div>

          {/* Message */}
          <Textarea
            label="Message"
            labelPlacement="outside"
            placeholder="hey 💕 just dropped something new…"
            value={text}
            onValueChange={setText}
            minRows={4}
            classNames={{ inputWrapper: "bg-white/[0.03] border-white/[0.08] !rounded-none" }}
          />

          {/* Recipient preview */}
          <div className="flex items-center justify-between gap-3 border border-white/[0.06] bg-white/[0.02] px-3 py-2">
            <div className="text-sm">
              {recipients === null ? (
                <span className="text-default-500">
                  Preview to see how many fans this reaches.
                </span>
              ) : recipients === 0 ? (
                <span className="text-warning">
                  0 subscribers matched — widen the audience or refresh subscribers.
                </span>
              ) : (
                <span>
                  Will send to{" "}
                  <span className="font-bold text-[color:rgb(var(--theme-accent-rgb,245,73,0))]">
                    {recipients.toLocaleString()}
                  </span>{" "}
                  {recipients === 1 ? "fan" : "fans"}
                  {sample.length > 0 && (
                    <span className="text-default-500">
                      {" "}
                      ({sample.slice(0, 3).map((s) => s.username || "fan").join(", ")}
                      {recipients > 3 ? ", …" : ""})
                    </span>
                  )}
                </span>
              )}
            </div>
            <Button
              size="sm"
              variant="bordered"
              isLoading={previewing}
              onPress={handlePreview}
              className="bg-transparent border border-white/[0.08] rounded-none shrink-0"
            >
              Preview
            </Button>
          </div>

          {/* Write-gate notice */}
          {writesEnabled === false && (
            <div className="text-xs text-default-500 border border-warning/30 bg-warning/[0.06] px-3 py-2">
              Message sending is turned <span className="text-warning font-medium">off</span>{" "}
              for this account by default (a safety guard so nothing can DM your
              fans without you). Hitting <span className="font-medium">Send</span>{" "}
              turns it on for this account.
            </div>
          )}
        </ModalBody>

        <ModalFooter className="justify-between">
          <div className="flex items-center gap-2">
            {priceNum > 0 && <Chip size="sm" variant="flat" color="warning">PPV ${priceNum}</Chip>}
          </div>
          <div className="flex gap-2">
            <Button
              variant="light"
              onPress={onClose}
              className="rounded-none"
              isDisabled={sending}
            >
              Cancel
            </Button>
            <Button
              onPress={handleSend}
              isLoading={sending}
              isDisabled={!recipients || !text.trim()}
              className="rounded-none font-bold bg-[color:rgb(var(--theme-accent-rgb,245,73,0))] text-black"
            >
              {writesEnabled === false ? "Enable & send" : "Send"}
              {recipients ? ` to ${recipients.toLocaleString()}` : ""}
            </Button>
          </div>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}
