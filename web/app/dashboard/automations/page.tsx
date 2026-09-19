"use client";

import { useCallback, useEffect, useState } from "react";
import { Card, CardBody } from "@heroui/card";
import { Button } from "@heroui/button";
import { Chip } from "@heroui/chip";
import { Switch } from "@heroui/switch";
import {
  Modal,
  ModalBody,
  ModalContent,
  ModalHeader,
} from "@heroui/modal";
import toast from "react-hot-toast";

import { PxZap, PxPlus } from "@/components/ui/PixelIcons";
import { DataState } from "@/components/dashboard/DataState";
import { SkeletonList } from "@/components/dashboard/Skeleton";
import { useApiClient } from "@/lib/hooks/use-api-client";
import { useConfirm } from "@/lib/hooks/use-confirm";
import { useAccounts, type OfAccount } from "@/lib/hooks/use-selected-account";
import { accountSupports, platformLabel } from "@/lib/platform-capabilities";
import { AutomationForm } from "@/components/dashboard/AutomationForm";
import { useTour } from "@/lib/tour-context";
import { TOUR_AUTOMATIONS } from "@/lib/tour-fake-data";

const ACTION_COLORS: Record<string, "success" | "warning" | "primary" | "default" | "danger"> = {
  webhook: "primary",
  discord: "primary",
  slack: "primary",
  telegram: "primary",
  send_dm: "warning",
  tag_fan: "success",
};

// Friendly, platform-neutral action labels. "Send DM" works on both OnlyFans
// and Fansly (the of_dm connector branches per platform) — no OF-only wording.
const ACTION_LABELS: Record<string, string> = {
  webhook: "Webhook",
  discord: "Discord",
  slack: "Slack",
  telegram: "Telegram",
  send_dm: "Send DM",
  tag_fan: "Tag fan",
};

export default function AutomationsPage() {
  const api = useApiClient();
  const confirm = useConfirm();
  const { accounts, selectedAccount } = useAccounts();
  const { isActive: isTourActive } = useTour();
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  // Distinguishes "you have no automations" from "we could not ask".
  const [error, setError] = useState<unknown>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<any | null>(null);
  const [runs, setRuns] = useState<Record<number, any[]>>({});
  const [showRunsFor, setShowRunsFor] = useState<number | null>(null);

  const refresh = useCallback(async () => {
    if (isTourActive) {
      setItems(TOUR_AUTOMATIONS);
      setLoading(false);
      return;
    }
    if (!api) return;
    setLoading(true);
    try {
      const data = await api.listAutomations();
      setItems(data.automations || []);
      setError(null);
    } catch (err: any) {
      setError(err);
      toast.error(err?.message || "Failed to load automations");
    } finally {
      setLoading(false);
    }
  }, [api, isTourActive]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function toggleActive(a: any) {
    if (!api) return;
    try {
      await api.updateAutomation(a.id, { is_active: !a.is_active });
      refresh();
    } catch (err: any) {
      toast.error(err?.message || "Update failed");
    }
  }

  async function runNow(a: any) {
    if (!api) return;
    const t = toast.loading("Running…");
    try {
      const res = await api.runAutomationNow(a.id, {
        fan: { id: "123", username: "testfan", display_name: "Test Fan" },
        amount: 5.0,
        text: "manual test",
      });
      toast.success(`Run: ${res.result?.status || "done"}`, { id: t });
    } catch (err: any) {
      toast.error(err?.message || "Run failed", { id: t });
    }
  }

  async function deleteAutomation(a: any) {
    if (!api) return;
    if (
      !(await confirm({
        title: "Delete automation?",
        body: `"${a.name}" will stop running.`,
        confirmLabel: "Delete",
        danger: true,
      }))
    )
      return;
    try {
      await api.deleteAutomation(a.id);
      toast.success("Deleted");
      refresh();
    } catch (err: any) {
      toast.error(err?.message || "Delete failed");
    }
  }

  async function loadRuns(id: number) {
    if (!api) return;
    try {
      const res = await api.listAutomationRuns(id);
      setRuns((r) => ({ ...r, [id]: res.runs || [] }));
      setShowRunsFor(id);
    } catch (err: any) {
      toast.error(err?.message || "Failed to load runs");
    }
  }

  // True when the account has no real-time message feed — the poller emits no
  // new_message events, so automations on that trigger would never run for it.
  const lacksRealtimeMessages = (acc: OfAccount | null | undefined) =>
    !!acc && acc.platform === "fansly" && !accountSupports(acc, "websocket");

  /** The account an automation is scoped to, if it's account-scoped. */
  const accountFor = (a: any): OfAccount | undefined =>
    a?.of_user_id
      ? accounts.find((x) => String(x.of_user_id) === String(a.of_user_id))
      : undefined;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="heading-2">Automations</h2>
          <p className="text-sm text-default-500 mt-1">
            Run actions automatically when events are detected.
          </p>
        </div>
        <Button
          data-tour="automations-new"
          color="primary"
          radius="none"
          onPress={() => {
            setEditing(null);
            setModalOpen(true);
          }}
          startContent={<PxPlus className="h-4 w-4" />}
        >
          New automation
        </Button>
      </div>

      {/* Real-time gap note: while websocket=false for Fansly, the poller
          emits no message events — warn before users build dead automations. */}
      {!isTourActive && lacksRealtimeMessages(selectedAccount) && (
        <div className="border border-amber-500/20 bg-amber-500/[0.04] px-3 py-2 text-[12px] text-amber-500/90">
          &apos;New message&apos; triggers don&apos;t fire for{" "}
          {platformLabel(selectedAccount?.platform)} accounts yet — real-time
          message events aren&apos;t available, so automations on that trigger
          won&apos;t run for @{selectedAccount?.username || selectedAccount?.of_user_id}.
          Tip, subscriber and purchase triggers work normally.
        </div>
      )}

      <DataState
        loading={loading}
        error={error}
        isEmpty={items.length === 0}
        onRetry={refresh}
        noun="automations"
        skeleton={
          <div className="border border-white/[0.06] bg-[#0d0d0d]">
            <SkeletonList rows={3} rowHeight={88} />
          </div>
        }
        icon={<PxZap className="h-8 w-8" />}
        title="No automations yet"
        description="Connect events to actions — e.g. ping Discord on every new tip."
      >
        <div className="space-y-3" data-tour="automations-list">
          {items.map((a) => (
            <Card key={a.id} className="bg-[#0d0d0d] border border-white/[0.06] rounded-none shadow-none">
              <CardBody className="p-4 space-y-2">
                <div className="flex items-start justify-between gap-4 flex-wrap">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <h3 className="font-semibold">{a.name}</h3>
                      <Chip size="sm" variant="flat">
                        on {a.trigger_event.replace(/_/g, " ")}
                      </Chip>
                      <Chip
                        size="sm"
                        variant="flat"
                        color={ACTION_COLORS[a.action_type] || "default"}
                      >
                        → {ACTION_LABELS[a.action_type] || a.action_type.replace(/_/g, " ")}
                      </Chip>
                      {!a.is_active && (
                        <Chip size="sm" variant="flat" color="default">
                          Disabled
                        </Chip>
                      )}
                      {a.trigger_event === "new_message" &&
                        lacksRealtimeMessages(accountFor(a)) && (
                          <Chip size="sm" variant="flat" color="warning">
                            Won&apos;t fire on {platformLabel(accountFor(a)?.platform)} yet
                          </Chip>
                        )}
                    </div>
                    {(a.conditions || []).length > 0 && (
                      <p className="text-xs text-default-500">
                        {a.conditions.length} condition(s) ·{" "}
                        {a.of_user_id
                          ? `account ${a.of_user_id}`
                          : "all accounts"}
                      </p>
                    )}
                    <p className="text-xs text-default-400 mt-1">
                      Run {a.run_count || 0} times{" "}
                      {a.last_run_at
                        ? `· last ${new Date(a.last_run_at).toLocaleString()}`
                        : ""}
                    </p>
                  </div>
                  <div className="flex flex-col gap-2 items-end">
                    <Switch
                      isSelected={!!a.is_active}
                      onValueChange={() => toggleActive(a)}
                      size="sm"
                    >
                      <span className="text-xs">Active</span>
                    </Switch>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="flat"
                        radius="none"
                        onPress={() => runNow(a)}
                      >
                        Run now
                      </Button>
                      <Button
                        size="sm"
                        variant="flat"
                        radius="none"
                        onPress={() => loadRuns(a.id)}
                      >
                        Runs
                      </Button>
                      <Button
                        size="sm"
                        variant="flat"
                        radius="none"
                        onPress={() => {
                          setEditing(a);
                          setModalOpen(true);
                        }}
                      >
                        Edit
                      </Button>
                      <Button
                        size="sm"
                        variant="flat"
                        color="danger"
                        radius="none"
                        onPress={() => deleteAutomation(a)}
                      >
                        Delete
                      </Button>
                    </div>
                  </div>
                </div>
              </CardBody>
            </Card>
          ))}
        </div>
      </DataState>

      <Modal
        isOpen={modalOpen}
        onOpenChange={setModalOpen}
        backdrop="blur"
        radius="none"
        size="2xl"
        scrollBehavior="inside"
      >
        <ModalContent>
          <ModalHeader>
            {editing ? "Edit automation" : "New automation"}
          </ModalHeader>
          <ModalBody className="pb-6">
            <AutomationForm
              existing={editing}
              onSaved={() => {
                setModalOpen(false);
                refresh();
              }}
              onCancel={() => setModalOpen(false)}
            />
          </ModalBody>
        </ModalContent>
      </Modal>

      <Modal
        isOpen={showRunsFor !== null}
        onOpenChange={() => setShowRunsFor(null)}
        backdrop="blur"
        radius="none"
        size="3xl"
      >
        <ModalContent>
          <ModalHeader>Recent runs</ModalHeader>
          <ModalBody className="pb-6">
            {showRunsFor !== null && (runs[showRunsFor] || []).length === 0 ? (
              <p className="text-sm text-default-500">No runs yet.</p>
            ) : (
              <div className="space-y-2">
                {showRunsFor !== null &&
                  (runs[showRunsFor] || []).map((r: any) => (
                    <div
                      key={r.id}
                      className="border border-white/[0.06] p-3 text-xs"
                    >
                      <div className="flex items-center gap-2 flex-wrap">
                        <Chip
                          size="sm"
                          color={
                            r.status === "success"
                              ? "success"
                              : r.status === "failed"
                                ? "danger"
                                : "default"
                          }
                          variant="flat"
                        >
                          {r.status}
                        </Chip>
                        <span className="text-default-400">
                          {new Date(r.created_at).toLocaleString()}
                        </span>
                      </div>
                      {r.error_snippet && (
                        <p className="mt-2 text-danger-400">
                          {r.error_snippet}
                        </p>
                      )}
                    </div>
                  ))}
              </div>
            )}
          </ModalBody>
        </ModalContent>
      </Modal>
    </div>
  );
}
