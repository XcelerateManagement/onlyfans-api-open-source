"use client";

import { useState, useEffect } from "react";
import { Card, CardBody } from "@heroui/card";
import { Button } from "@heroui/button";
import { Chip } from "@heroui/chip";
import { PxBell } from "@/components/ui/PixelIcons";
import { motion } from "framer-motion";
import { useApiClient } from "@/lib/hooks/use-api-client";
import { isPlatformNotSupported, platformUnsupportedMessage } from "@/lib/api-client";
import { useAccounts } from "@/lib/hooks/use-selected-account";
import { useSSE } from "@/lib/hooks/use-sse";
import { useTour } from "@/lib/tour-context";
import { TOUR_ACCOUNTS, TOUR_NOTIFICATIONS } from "@/lib/tour-fake-data";
import { EmptyState } from "@/components/dashboard/EmptyState";
import { DataState } from "@/components/dashboard/DataState";
import { SkeletonList } from "@/components/dashboard/Skeleton";
import { PixelSpinner } from "@/components/ui/PixelSpinner";
import toast from "react-hot-toast";

function parseNotificationText(text: string, replacePairs?: Record<string, string>): string {
  if (!text) return "";
  let username = "";
  if (replacePairs) {
    // Priority: {NAME} > {SUBSCRIBER_LINK} > any LINK key
    if (replacePairs["{NAME}"]) {
      username = replacePairs["{NAME}"];
    } else {
      for (const [key, value] of Object.entries(replacePairs)) {
        if (key.includes("SUBSCRIBER") || key.includes("USER")) {
          const match = String(value).match(/>([^<]+)</);
          if (match) { username = match[1]; break; }
        }
      }
    }
  }
  // Clean HTML from text
  const cleanText = text
    .replace(/<a[^>]*>([^<]*)<\/a>/g, "$1")
    .replace(/<[^>]+>/g, "")
    .trim();
  return username ? `${username} ${cleanText}` : cleanText;
}

export default function NotificationsPage() {
  const api = useApiClient();
  const { selectedAccount: realSelectedAccount } = useAccounts();
  const { isActive: isTourActive } = useTour();
  const selectedAccount = isTourActive
    ? (realSelectedAccount ?? TOUR_ACCOUNTS[0])
    : realSelectedAccount;

  const [notifications, setNotifications] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [limit, setLimit] = useState(20);
  // "No recent activity for this account" is a claim about the account. Only
  // make it when the request actually came back.
  const [error, setError] = useState<unknown>(null);

  const fetchNotifications = async (newLimit = 20) => {
    if (isTourActive) {
      setNotifications(TOUR_NOTIFICATIONS.slice(0, newLimit));
      setLoading(false);
      return;
    }
    if (!api || !selectedAccount) return;
    setLoading(true);
    try {
      const data = await api.getNotifications(
        selectedAccount.of_user_id,
        newLimit
      );
      setNotifications(data.notifications || []);
      setError(null);
    } catch (err: any) {
      setError(err);
      // Notifications are live on both platforms — this mapping is defensive
      // so a capability regression never surfaces a raw backend string.
      if (isPlatformNotSupported(err)) {
        toast.error(platformUnsupportedMessage(err.data?.feature, err.data?.platform));
      } else {
        toast.error(err?.message || "Failed to load notifications");
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setNotifications([]);
    setLimit(20);
    fetchNotifications(20);
  }, [selectedAccount]); // eslint-disable-line react-hooks/exhaustive-deps

  // Refresh when a relevant event arrives over SSE
  const { events } = useSSE({
    types: ["new_tip", "new_subscriber", "renewed_subscriber", "new_message", "new_purchase"],
    bufferSize: 10,
    disabled: isTourActive,
  });
  const lastEventId = events[0]?.id ?? null;
  useEffect(() => {
    if (lastEventId && selectedAccount) {
      fetchNotifications(limit);
    }
  }, [lastEventId]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!selectedAccount) {
    return (
      <EmptyState
        icon={<PxBell className="h-8 w-8" />}
        title="No account selected"
        description="Select an account from the header dropdown to view notifications."
      />
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="heading-2">Notifications</h2>
        <p className="text-sm text-default-500 mt-1">
          Activity feed for{" "}
          {selectedAccount.username || selectedAccount.email}
        </p>
      </div>

      <DataState
        loading={loading}
        error={error}
        isEmpty={notifications.length === 0}
        onRetry={() => fetchNotifications(limit)}
        noun="notifications"
        skeleton={
          <div className="border border-white/[0.06] bg-[#0d0d0d]">
            <SkeletonList rows={8} rowHeight={64} />
          </div>
        }
        icon={<PxBell className="h-8 w-8" />}
        title="No notifications"
        description="No recent activity for this account."
      >
        <>
          <motion.div
            data-tour="notifications-feed"
            className="space-y-3"
            initial="hidden"
            animate="visible"
            variants={{
              hidden: {},
              visible: { transition: { staggerChildren: 0.05 } },
            }}
          >
            {notifications.map((n: any) => (
              <motion.div
                key={n.id}
                variants={{
                  hidden: { opacity: 0, y: 10 },
                  visible: { opacity: 1, y: 0 },
                }}
              >
              <Card className="bg-[#0d0d0d] border border-white/[0.06] rounded-none shadow-none">
                <CardBody className="flex flex-row items-center gap-4 p-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Chip size="sm" variant="flat" color="warning">
                        {(n.type || "notification")
                          .replace("paided_message", "paid_message")
                          .replace(/_/g, " ")}
                      </Chip>
                      {!n.isRead && (
                        <Chip size="sm" variant="dot" className="text-accent">
                          New
                        </Chip>
                      )}
                    </div>
                    <p className="mt-1 text-sm">{parseNotificationText(n.text, n.replacePairs) || "—"}</p>
                    <p className="mt-1 text-xs text-default-400">
                      {n.createdAt
                        ? new Date(n.createdAt).toLocaleString()
                        : ""}
                    </p>
                  </div>
                </CardBody>
              </Card>
              </motion.div>
            ))}
          </motion.div>

          <div className="flex justify-center">
            <Button
              variant="bordered"
              isLoading={loading}
              className="bg-transparent border border-white/[0.08] rounded-none hover:border-[color:rgba(var(--theme-accent-rgb,245,73,0),0.3)]"
              onPress={() => {
                const newLimit = limit + 20;
                setLimit(newLimit);
                fetchNotifications(newLimit);
              }}
            >
              Load More
            </Button>
          </div>
        </>
      </DataState>
    </div>
  );
}
