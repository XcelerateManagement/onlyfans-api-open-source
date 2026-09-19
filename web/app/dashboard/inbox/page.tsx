"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Input } from "@heroui/input";
import toast from "react-hot-toast";

import { Button } from "@heroui/button";

import { PxMail, PxSearch } from "@/components/ui/PixelIcons";
import { EmptyState } from "@/components/dashboard/EmptyState";
import { DataState } from "@/components/dashboard/DataState";
import {
  RealtimeIndicator,
  useRealtimeStatus,
} from "@/components/dashboard/RealtimeStatus";
import { SkeletonList } from "@/components/dashboard/Skeleton";
import { ChatListItem } from "@/components/dashboard/ChatListItem";
import { ChatConversation } from "@/components/dashboard/ChatConversation";
import { useApiClient } from "@/lib/hooks/use-api-client";
import { useAccounts } from "@/lib/hooks/use-selected-account";
import { useSSE } from "@/lib/hooks/use-sse";
import { useDebounced } from "@/lib/hooks/use-debounced";
import { cn } from "@/lib/utils";
import { useTour } from "@/lib/tour-context";
import { TOUR_ACCOUNTS, TOUR_CHATS } from "@/lib/tour-fake-data";

const PAGE_SIZE = 40;

export default function InboxPage() {
  const api = useApiClient();
  const { selectedAccount: realSelectedAccount, accounts: realAccounts } = useAccounts();
  const { isActive: isTourActive } = useTour();
  // In tour mode synthesise an account context so the page renders the chats.
  const accounts = isTourActive ? TOUR_ACCOUNTS : realAccounts;
  const selectedAccount = isTourActive
    ? (realSelectedAccount ?? TOUR_ACCOUNTS[0])
    : realSelectedAccount;
  const connectionState = selectedAccount?.connection_state;
  const connectionHealthy = !connectionState || connectionState === "connected";
  const [chats, setChats] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  // Separates "this account has no conversations" from "the chats call failed".
  const [error, setError] = useState<unknown>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [selectedChatId, setSelectedChatId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounced(search, 200);
  const [liveBump, setLiveBump] = useState(0);
  // Locally-read chats → the unread count they had when opened. The badge is
  // suppressed while OF still reports ≤ that count; a newer message (higher
  // count) re-surfaces it. There's no server-side mark-read endpoint yet, so
  // this keeps the "Inbox N" badge honest without one.
  const [readChats, setReadChats] = useState<Record<string, number>>({});

  const refresh = useCallback(async () => {
    if (isTourActive) {
      setChats(TOUR_CHATS);
      setHasMore(false);
      setLoading(false);
      // Auto-select the first chat so the conversation pane has demo content.
      setSelectedChatId((cur) => cur ?? String(TOUR_CHATS[0]?.withUser?.id ?? ""));
      return;
    }
    if (!api || !selectedAccount || !connectionHealthy) return;
    setLoading(true);
    try {
      const res = await api.listChats(selectedAccount.of_user_id, { limit: PAGE_SIZE });
      setChats(res.chats || []);
      setHasMore(!!res.hasMore);
      setError(null);
    } catch (err: any) {
      setError(err);
      toast.error(err?.message || "Failed to load chats");
    } finally {
      setLoading(false);
    }
  }, [api, selectedAccount, isTourActive, connectionHealthy]);

  const loadMore = useCallback(async () => {
    if (!api || !selectedAccount || !connectionHealthy || loadingMore) return;
    setLoadingMore(true);
    try {
      const res = await api.listChats(selectedAccount.of_user_id, {
        limit: PAGE_SIZE,
        offset: chats.length,
      });
      // De-dupe on withUser.id in case of overlap from live updates
      const existingIds = new Set(
        chats.map((c) => String((c.withUser || c.user)?.id || ""))
      );
      const extra = (res.chats || []).filter(
        (c: any) => !existingIds.has(String((c.withUser || c.user)?.id || ""))
      );
      setChats((prev) => [...prev, ...extra]);
      setHasMore(!!res.hasMore);
    } catch (err: any) {
      toast.error(err?.message || "Failed to load more");
    } finally {
      setLoadingMore(false);
    }
  }, [api, selectedAccount, connectionHealthy, chats, loadingMore]);

  useEffect(() => {
    setChats([]);
    setSelectedChatId(null);
    refresh();
  }, [refresh]);

  // "/" keyboard shortcut focuses the chat search box
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (e.key === "/" && tag !== "INPUT" && tag !== "TEXTAREA") {
        e.preventDefault();
        const input = document.querySelector<HTMLInputElement>(
          'input[data-inbox-search="1"]'
        );
        input?.focus();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  // Live refresh on new messages for the current account
  const { events } = useSSE({
    types: ["new_message"],
    bufferSize: 20,
    disabled: isTourActive || !connectionHealthy,
  });
  // The conversation pane's "Live" badge used to be fed raw SSE connectivity,
  // which is true even for an account that has no event source running at all.
  // isLive additionally requires that this account can actually emit.
  const realtime = useRealtimeStatus(selectedAccount);
  const lastLiveId = events[0]?.id ?? null;
  useEffect(() => {
    if (!lastLiveId || !selectedAccount) return;
    const lastEvent = events[0];
    if (String(lastEvent?.of_user_id) !== String(selectedAccount.of_user_id)) return;
    refresh();
    setLiveBump((b) => b + 1);
  }, [lastLiveId, selectedAccount, events, refresh]);

  // Apply local read-state: zero the unread badge for chats opened this session
  // whose OF unread count hasn't grown since.
  const displayChats = useMemo(
    () =>
      chats.map((c) => {
        const id = String((c.withUser || c.user)?.id || "");
        const cur = Number(c.unreadMessagesCount || 0);
        const readAt = readChats[id];
        return readAt != null && cur <= readAt
          ? { ...c, unreadMessagesCount: 0 }
          : c;
      }),
    [chats, readChats]
  );

  const filteredChats = useMemo(() => {
    if (!debouncedSearch.trim()) return displayChats;
    const needle = debouncedSearch.toLowerCase().trim();
    return displayChats.filter((c) => {
      const u = c.withUser || c.user || {};
      const name = String(u.name || "").toLowerCase();
      const username = String(u.username || "").toLowerCase();
      const lastText = String(c.lastMessage?.text || "").toLowerCase();
      return name.includes(needle) || username.includes(needle) || lastText.includes(needle);
    });
  }, [displayChats, debouncedSearch]);

  const selectedChat = useMemo(
    () =>
      filteredChats.find(
        (c) => String((c.withUser || c.user)?.id) === String(selectedChatId)
      ) || null,
    [filteredChats, selectedChatId]
  );

  const totalUnread = useMemo(
    () => displayChats.reduce((s, c) => s + Number(c.unreadMessagesCount || 0), 0),
    [displayChats]
  );

  if (!selectedAccount) {
    return (
      <EmptyState
        icon={<PxMail className="h-8 w-8" />}
        title={accounts.length === 0 ? "No account connected" : "No account selected"}
        description={
          accounts.length === 0
            ? "Connect an account to see messages here."
            : "Pick an account from the header dropdown to open its inbox."
        }
      />
    );
  }

  if (!connectionHealthy) {
    return (
      <EmptyState
        icon={<PxMail className="h-8 w-8" />}
        title={connectionState === "login_failed" ? "Login failed" : "Inbox sync unavailable"}
        description={selectedAccount.login_failure?.message
          || selectedAccount.connection_error?.message
          || "Resolve this account on the Accounts page before requesting live conversations."}
      />
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="heading-2 flex items-center gap-3">
            Inbox
            {totalUnread > 0 && (
              <motion.span
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                className="text-xs font-bold text-white px-2 py-0.5"
                style={{ backgroundColor: "var(--theme-accent, #f54900)" }}
              >
                {totalUnread}
              </motion.span>
            )}
          </h2>
          <p className="text-sm text-default-500 mt-1">
            Conversations for{" "}
            {selectedAccount.username || selectedAccount.email}
            {" · "}
            {/* Scoped to the open account — the inbox only ever shows one. */}
            <RealtimeIndicator scope={selectedAccount} />
          </p>
        </div>
      </div>

      <div className="flex flex-col md:flex-row border border-white/[0.06] bg-[#0d0d0d] h-[calc(100vh-220px)] min-h-[520px] overflow-hidden">
        {/* Chat list */}
        <div
          data-tour="inbox-list"
          className={cn(
            "flex-col w-full md:w-80 md:shrink-0 md:border-r border-white/[0.06] min-h-0",
            selectedChatId ? "hidden md:flex" : "flex"
          )}
        >
          <div className="p-3 border-b border-white/[0.06] shrink-0">
            <Input
              size="sm"
              placeholder='Search conversations (press "/")'
              startContent={<PxSearch className="h-4 w-4 text-default-400" />}
              value={search}
              onValueChange={setSearch}
              variant="bordered"
              data-inbox-search="1"
              classNames={{
                inputWrapper: "bg-black/20 border-white/[0.08] !rounded-none",
              }}
            />
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto styled-scrollbar">
            <DataState
              compact
              loading={loading}
              error={error}
              isEmpty={filteredChats.length === 0}
              onRetry={refresh}
              noun="conversations"
              skeleton={<SkeletonList rows={8} rowHeight={60} />}
              emptyContent={
                <div className="p-6 text-center text-xs text-default-400">
                  {search ? "No matches." : "No conversations yet."}
                </div>
              }
            >
              <motion.div
                initial="hidden"
                animate="visible"
                variants={{
                  hidden: {},
                  visible: { transition: { staggerChildren: 0.02 } },
                }}
              >
                <AnimatePresence initial={false}>
                  {filteredChats.map((c) => {
                    const id = String((c.withUser || c.user)?.id || "");
                    return (
                      <ChatListItem
                        key={id}
                        chat={c}
                        selected={selectedChatId === id}
                        onSelect={() => {
                          setSelectedChatId(id);
                          setReadChats((m) => ({
                            ...m,
                            [id]: Number(c.unreadMessagesCount || 0),
                          }));
                        }}
                        ofSelfId={selectedAccount?.of_user_id}
                      />
                    );
                  })}
                </AnimatePresence>
                {hasMore && !debouncedSearch && (
                  <div className="p-3">
                    <Button
                      size="sm"
                      variant="bordered"
                      isLoading={loadingMore}
                      onPress={loadMore}
                      radius="none"
                      className="w-full bg-transparent border border-white/[0.08]"
                    >
                      Load more
                    </Button>
                  </div>
                )}
              </motion.div>
            </DataState>
          </div>
        </div>

        {/* Conversation pane */}
        <div
          data-tour="inbox-thread"
          className={cn(
            "flex-col flex-1 min-w-0 min-h-0",
            selectedChatId ? "flex" : "hidden md:flex"
          )}
        >
          {selectedChat ? (
            <ChatConversation
              // Remount on conversation switch so the previous fan's messages
              // never flash under the new header while the new thread loads.
              key={selectedChatId ?? "none"}
              ofUserId={selectedAccount.of_user_id}
              ofSelfId={selectedAccount.of_user_id}
              chat={selectedChat}
              liveSignal={liveBump}
              onBack={() => setSelectedChatId(null)}
              connected={realtime.isLive}
              // Platform + backend-emitted capabilities, threaded down to the
              // composer so Attach/PPV/reply gate per-platform (chats/messages/
              // send_message are supported on both platforms — no page gate).
              account={selectedAccount}
            />
          ) : (
            <div className="flex-1 flex items-center justify-center text-sm text-default-400 px-6 text-center">
              <div>
                <PxMail className="h-8 w-8 mx-auto mb-2 opacity-50" />
                Select a conversation to read messages.
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
