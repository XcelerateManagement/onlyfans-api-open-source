"use client";

import { useState } from "react";
import { Button } from "@heroui/button";
import { Input } from "@heroui/input";
import { Checkbox, CheckboxGroup } from "@heroui/checkbox";
import toast from "react-hot-toast";

import { useApiClient } from "@/lib/hooks/use-api-client";

const EVENT_OPTIONS = [
  "new_subscriber",
  "renewed_subscriber",
  "expired_subscriber",
  "new_tip",
  "new_message",
  "new_purchase",
  "balance_increased",
  "payout_completed",
  "polling_paused",
];

export function WebhookForm({
  existing,
  onSaved,
  onCancel,
}: {
  existing?: any;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const api = useApiClient();
  const [url, setUrl] = useState(existing?.url || "");
  const [description, setDescription] = useState(existing?.description || "");
  const [types, setTypes] = useState<string[]>(existing?.event_types || ["*"]);
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    if (!api) return;
    if (!url.trim()) {
      toast.error("URL is required");
      return;
    }
    if (types.length === 0) {
      toast.error("Select at least one event type");
      return;
    }
    setSaving(true);
    try {
      if (existing?.id) {
        await api.updateWebhook(existing.id, {
          url: url.trim(),
          event_types: types,
          description: description.trim(),
        });
        toast.success("Webhook updated");
      } else {
        await api.createWebhook({
          url: url.trim(),
          event_types: types,
          description: description.trim() || undefined,
        });
        toast.success("Webhook created");
      }
      onSaved();
    } catch (err: any) {
      toast.error(err?.message || "Failed to save webhook");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <Input
        label="Endpoint URL"
        placeholder="https://your-app.com/webhooks/only-api"
        value={url}
        onValueChange={setUrl}
        isRequired
        variant="bordered"
        radius="none"
      />
      <Input
        label="Description (optional)"
        value={description}
        onValueChange={setDescription}
        variant="bordered"
        radius="none"
      />
      <div>
        <p className="text-sm font-semibold mb-2">Event types</p>
        <Button
          size="sm"
          variant="flat"
          radius="none"
          className="mb-2"
          onPress={() => setTypes(["*"])}
        >
          All events
        </Button>
        <CheckboxGroup
          value={types}
          onValueChange={setTypes}
          orientation="vertical"
          className="max-h-60 overflow-y-auto"
        >
          <Checkbox value="*">All events (*)</Checkbox>
          {EVENT_OPTIONS.map((t) => (
            <Checkbox key={t} value={t}>
              {t.replace(/_/g, " ")}
            </Checkbox>
          ))}
        </CheckboxGroup>
      </div>
      <div className="flex gap-2 pt-2">
        <Button
          color="primary"
          isLoading={saving}
          onPress={handleSave}
          radius="none"
          className="flex-1"
        >
          {existing?.id ? "Save changes" : "Create webhook"}
        </Button>
        <Button variant="flat" radius="none" onPress={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
