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

import { PxLink, PxPlus, PxCopy } from "@/components/ui/PixelIcons";
import { DataState } from "@/components/dashboard/DataState";
import { SkeletonList } from "@/components/dashboard/Skeleton";
import { useApiClient } from "@/lib/hooks/use-api-client";
import { useAccounts } from "@/lib/hooks/use-selected-account";
import { accountSupports, platformLabel } from "@/lib/platform-capabilities";
import { useConfirm } from "@/lib/hooks/use-confirm";
import { WebhookForm } from "@/components/dashboard/WebhookForm";
import { useTour } from "@/lib/tour-context";
import { TOUR_WEBHOOKS } from "@/lib/tour-fake-data";

export default function WebhooksPage() {
  const api = useApiClient();
  const confirm = useConfirm();
  const { accounts } = useAccounts();
  const { isActive: isTourActive } = useTour();

  // Webhooks are platform-agnostic, but new_message events only flow where a
  // real-time feed exists. While websocket=false for Fansly the poller emits
  // no message events — surface that so subscriptions aren't silently dead.
  const fanslyWithoutRealtime = accounts.find(
    (a) => a.platform === "fansly" && !accountSupports(a, "websocket")
  );
  const [webhooks, setWebhooks] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  // Distinguishes "you have no webhooks" from "we could not ask".
  const [error, setError] = useState<unknown>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<any | null>(null);
  const [deliveries, setDeliveries] = useState<Record<number, any[]>>({});
  const [showDeliveriesFor, setShowDeliveriesFor] = useState<number | null>(null);

  const refresh = useCallback(async () => {
    if (isTourActive) {
      setWebhooks(TOUR_WEBHOOKS);
      setLoading(false);
      return;
    }
    if (!api) return;
    setLoading(true);
    try {
      const data = await api.listWebhooks();
      setWebhooks(data.webhooks || []);
      setError(null);
    } catch (err: any) {
      setError(err);
      toast.error(err?.message || "Failed to load webhooks");
    } finally {
      setLoading(false);
    }
  }, [api, isTourActive]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function toggleActive(wh: any) {
    if (!api) return;
    try {
      await api.updateWebhook(wh.id, { is_active: !wh.is_active });
      toast.success(wh.is_active ? "Disabled" : "Enabled");
      refresh();
    } catch (err: any) {
      toast.error(err?.message || "Update failed");
    }
  }

  async function testWebhook(wh: any) {
    if (!api) return;
    const t = toast.loading("Sending test event…");
    try {
      const res = await api.testWebhook(wh.id);
      if (res.success) toast.success("Test delivered", { id: t });
      else toast.error("Test failed — see delivery log", { id: t });
      refresh();
    } catch (err: any) {
      toast.error(err?.message || "Test failed", { id: t });
    }
  }

  async function deleteWebhook(wh: any) {
    if (!api) return;
    if (
      !(await confirm({
        title: "Delete webhook?",
        body: `This stops delivery to ${wh.url}.`,
        confirmLabel: "Delete",
        danger: true,
      }))
    )
      return;
    try {
      await api.deleteWebhook(wh.id);
      toast.success("Deleted");
      refresh();
    } catch (err: any) {
      toast.error(err?.message || "Delete failed");
    }
  }

  async function loadDeliveries(id: number) {
    if (!api) return;
    try {
      const res = await api.listWebhookDeliveries(id);
      setDeliveries((d) => ({ ...d, [id]: res.deliveries || [] }));
      setShowDeliveriesFor(id);
    } catch (err: any) {
      toast.error(err?.message || "Failed to load deliveries");
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="heading-2">Webhooks</h2>
          <p className="text-sm text-default-500 mt-1">
            Forward events to any URL with HMAC-signed POSTs.
          </p>
        </div>
        <Button
          data-tour="webhooks-new"
          color="primary"
          radius="none"
          onPress={() => {
            setEditing(null);
            setModalOpen(true);
          }}
          startContent={<PxPlus className="h-4 w-4" />}
        >
          New webhook
        </Button>
      </div>

      {!isTourActive && fanslyWithoutRealtime && (
        <div className="border border-amber-500/20 bg-amber-500/[0.04] px-3 py-2 text-[12px] text-amber-500/90">
          new_message events aren&apos;t emitted for{" "}
          {platformLabel(fanslyWithoutRealtime.platform)} accounts yet — webhooks
          subscribed to new_message won&apos;t receive deliveries from them. All
          other event types (tips, subscribers, purchases) deliver normally.
        </div>
      )}

      <DataState
        loading={loading}
        error={error}
        isEmpty={webhooks.length === 0}
        onRetry={refresh}
        noun="webhooks"
        skeleton={
          <div className="border border-white/[0.06] bg-[#0d0d0d]">
            <SkeletonList rows={3} rowHeight={96} />
          </div>
        }
        icon={<PxLink className="h-8 w-8" />}
        title="No webhooks yet"
        description="Create one to receive event POSTs at your URL of choice."
      >
        <div className="space-y-3" data-tour="webhooks-list">
          {webhooks.map((wh) => (
            <Card key={wh.id} className="bg-[#0d0d0d] border border-white/[0.06] rounded-none shadow-none">
              <CardBody className="p-4 space-y-3">
                <div className="flex items-start justify-between gap-4 flex-wrap">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <code className="text-sm truncate">{wh.url}</code>
                      {wh.status === "pending" ? (
                        <Chip size="sm" color="warning" variant="flat">
                          Awaiting approval
                        </Chip>
                      ) : wh.status === "rejected" ? (
                        <Chip size="sm" color="danger" variant="flat">
                          Rejected
                        </Chip>
                      ) : (
                        <Chip
                          size="sm"
                          color={wh.is_active ? "success" : "default"}
                          variant="flat"
                        >
                          {wh.is_active ? "Active" : "Disabled"}
                        </Chip>
                      )}
                      {wh.consecutive_failures > 0 && (
                        <Chip size="sm" color="warning" variant="flat">
                          {wh.consecutive_failures} failures
                        </Chip>
                      )}
                    </div>
                    {wh.status === "pending" && (
                      <p className="text-[11px] text-warning-500 mb-1">
                        Your custom domain is being reviewed by an admin.
                        Events won&apos;t deliver until it&apos;s approved.
                      </p>
                    )}
                    {wh.status === "rejected" && wh.reject_reason && (
                      <p className="text-[11px] text-danger-500 mb-1">
                        Rejected: {wh.reject_reason}
                      </p>
                    )}
                    {wh.description && (
                      <p className="text-xs text-default-500">
                        {wh.description}
                      </p>
                    )}
                    <div className="flex gap-1 flex-wrap mt-2">
                      {(wh.event_types || []).map((t: string) => (
                        <Chip key={t} size="sm" variant="bordered">
                          {t}
                        </Chip>
                      ))}
                    </div>
                    <div className="text-xs text-default-400 mt-2 flex gap-3 flex-wrap">
                      <span>
                        Secret:{" "}
                        <code className="select-all text-default-300">
                          {wh.secret}
                        </code>
                        <button
                          className="ml-1 text-default-500 hover:text-foreground"
                          onClick={() => {
                            navigator.clipboard.writeText(wh.secret);
                            toast.success("Secret copied");
                          }}
                        >
                          <PxCopy className="inline h-3 w-3" />
                        </button>
                      </span>
                      {wh.last_delivery_at && (
                        <span>
                          Last delivery:{" "}
                          {new Date(wh.last_delivery_at).toLocaleString()} (
                          {wh.last_status_code})
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex flex-col gap-2 items-end">
                    <Switch
                      isSelected={!!wh.is_active}
                      onValueChange={() => toggleActive(wh)}
                      size="sm"
                    >
                      <span className="text-xs">Active</span>
                    </Switch>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="flat"
                        radius="none"
                        onPress={() => testWebhook(wh)}
                        isDisabled={wh.status && wh.status !== "approved"}
                      >
                        Test
                      </Button>
                      <Button
                        size="sm"
                        variant="flat"
                        radius="none"
                        onPress={() => loadDeliveries(wh.id)}
                      >
                        Deliveries
                      </Button>
                      <Button
                        size="sm"
                        variant="flat"
                        radius="none"
                        onPress={() => {
                          setEditing(wh);
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
                        onPress={() => deleteWebhook(wh)}
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
      >
        <ModalContent>
          <ModalHeader>
            {editing ? "Edit webhook" : "New webhook"}
          </ModalHeader>
          <ModalBody className="pb-6">
            <WebhookForm
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
        isOpen={showDeliveriesFor !== null}
        onOpenChange={() => setShowDeliveriesFor(null)}
        backdrop="blur"
        radius="none"
        size="3xl"
      >
        <ModalContent>
          <ModalHeader>Recent deliveries</ModalHeader>
          <ModalBody className="pb-6">
            {showDeliveriesFor !== null &&
            (deliveries[showDeliveriesFor] || []).length === 0 ? (
              <p className="text-sm text-default-500">No deliveries yet.</p>
            ) : (
              <div className="space-y-2">
                {showDeliveriesFor !== null &&
                  (deliveries[showDeliveriesFor] || []).map((d: any) => (
                    <div
                      key={d.id}
                      className="border border-white/[0.06] p-3 text-xs"
                    >
                      <div className="flex items-center gap-2 flex-wrap">
                        <Chip
                          size="sm"
                          color={
                            d.status === "success"
                              ? "success"
                              : d.status === "failed"
                                ? "danger"
                                : "default"
                          }
                          variant="flat"
                        >
                          {d.status}
                        </Chip>
                        <span className="text-default-400">
                          {new Date(d.created_at).toLocaleString()}
                        </span>
                        <span className="text-default-400">
                          attempt {d.attempt} · {d.response_code || "—"}
                        </span>
                      </div>
                      {d.response_snippet && (
                        <pre className="mt-2 p-2 bg-black/40 overflow-x-auto text-[11px]">
                          {d.response_snippet}
                        </pre>
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
