/**
 * Coherent fake sample data for the dashboard tour. Pages that opt into the
 * tour swap their real fetched data for these constants when `useTour().isActive`
 * is true. The shapes mirror the real API responses (see `lib/api-client.ts`)
 * so the same renderers can consume them with no branching.
 *
 * Design rules:
 *   - No `new Date()` at module load — use `daysAgoIso(n)` so timestamps stay
 *     fresh whenever the tour is started.
 *   - Numbers should look impressive but plausible: ~$5–10k / month, tip $5–200.
 *   - Realistic OF-style usernames; no `lorem ipsum` or "John Doe".
 *   - Every collection should be long enough to fill the visible viewport
 *     without scrolling past the empty zone.
 */

import type { OfAccount } from "@/lib/hooks/use-selected-account";
import type {
  CampaignEarnings,
  CampaignsCacheStatus,
  SubscribersCacheStatus,
  TransactionsCacheStatus,
} from "@/lib/api-client";
import type { LiveEvent } from "@/lib/hooks/use-sse";

const DAY = 86_400_000;
const HOUR = 3_600_000;
const MIN = 60_000;

function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * DAY).toISOString();
}
function isoHoursAgo(hours: number): string {
  return new Date(Date.now() - hours * HOUR).toISOString();
}
function isoMinutesAgo(mins: number): string {
  return new Date(Date.now() - mins * MIN).toISOString();
}

/* ────────────────────────────────────────────────────────────────────────── *
 * Accounts                                                                   *
 * ────────────────────────────────────────────────────────────────────────── */

export const TOUR_ACCOUNTS: OfAccount[] = [
  {
    id: 9_999_001,
    of_user_id: "9999001",
    email: "jess.kingsley@example.com",
    username: "jess.kingsley",
    proxy: "http://proxy.example.com:8080",
    created_at: isoDaysAgo(124),
    last_login: isoHoursAgo(3),
  },
  {
    id: 9_999_002,
    of_user_id: "9999002",
    email: "mia.luxx@example.com",
    username: "mia.luxx",
    proxy: null,
    created_at: isoDaysAgo(57),
    last_login: isoHoursAgo(11),
  },
  {
    id: 9_999_003,
    of_user_id: "9999003",
    email: "ava.rae@example.com",
    username: "ava.rae",
    proxy: "http://proxy.example.com:8081",
    created_at: isoDaysAgo(28),
    last_login: isoMinutesAgo(42),
  },
];

/* ────────────────────────────────────────────────────────────────────────── *
 * Earnings                                                                   *
 * ────────────────────────────────────────────────────────────────────────── */

/** 30-day series, vaguely upward-trending with a midweek dip. Values rounded. */
function buildEarningsChart(): { date: string; amount: number }[] {
  const base = [
    180, 220, 260, 195, 240, 310, 380, 340, 290, 360, 420, 480, 410, 500, 540,
    500, 470, 540, 610, 580, 650, 720, 690, 740, 800, 760, 830, 880, 920, 960,
  ];
  return base.map((amount, i) => ({
    date: isoDaysAgo(base.length - 1 - i).slice(0, 10),
    amount,
  }));
}

const EARNINGS_CHART = buildEarningsChart();

/** The tour's three accounts are all OnlyFans, so every split is OF-only. */
function tourSummaryExtras(
  byCategory: Record<string, number>,
  total: number,
  prevToDate: number,
  newSubs: { count: number; renewals: number; prev: number },
) {
  const byCategoryPlatform: Record<string, { onlyfans: number }> = {};
  for (const [k, v] of Object.entries(byCategory)) byCategoryPlatform[k] = { onlyfans: v };
  return {
    prev_total_to_date: prevToDate,
    by_category_platform: byCategoryPlatform,
    new_subs: {
      count: newSubs.count,
      renewals: newSubs.renewals,
      prev_count: newSubs.prev,
      prev_renewals: 0,
      by_platform: {
        onlyfans: {
          count: newSubs.count,
          renewals: newSubs.renewals,
          prev_count: newSubs.prev,
          prev_renewals: 0,
          accounts: 3,
          accounts_tracked: 3,
          oldest_sync_at: null,
        },
      },
      accounts: 3,
      accounts_tracked: 3,
      accounts_never_synced: 0,
      oldest_sync_at: null,
    },
    total,
    computed_at: new Date().toISOString(),
    accounts_stale: 0,
    accounts_never_synced: 0,
  };
}

const TOUR_CATEGORIES = {
  today: { subscriptions: 89.97, messages: 65.0, tips: 45.5, posts: 28.0, streams: 12.0, referrals: 7.03 },
  week: { subscriptions: 720.0, messages: 460.5, tips: 385.25, posts: 178.5, streams: 98.0, referrals: 49.75 },
  month: { subscriptions: 2580.0, messages: 1620.0, tips: 1340.5, posts: 642.0, streams: 348.75, referrals: 200.0 },
};

/** What `getEarningsSummary(period)` returns. */
export const TOUR_EARNINGS_SUMMARY = {
  today: {
    prev_total: 198.0,
    by_category: TOUR_CATEGORIES.today,
    ...tourSummaryExtras(TOUR_CATEGORIES.today, 247.5, 176.0, { count: 6, renewals: 4, prev: 5 }),
    chart: EARNINGS_CHART.slice(-1).map((d) => d.amount),
    accounts_count: 3,
    transactions_counted: 18,
    transactions_capped: false,
    period: "today",
    cached: true,
  },
  week: {
    prev_total: 1640.5,
    by_category: TOUR_CATEGORIES.week,
    ...tourSummaryExtras(TOUR_CATEGORIES.week, 1892.0, 1512.25, { count: 41, renewals: 27, prev: 36 }),
    chart: EARNINGS_CHART.slice(-7).map((d) => d.amount),
    accounts_count: 3,
    transactions_counted: 142,
    transactions_capped: false,
    period: "week",
    cached: true,
  },
  month: {
    prev_total: 5980.0,
    by_category: TOUR_CATEGORIES.month,
    ...tourSummaryExtras(TOUR_CATEGORIES.month, 6731.25, 5410.0, { count: 168, renewals: 112, prev: 150 }),
    chart: EARNINGS_CHART.map((d) => d.amount),
    accounts_count: 3,
    transactions_counted: 612,
    transactions_capped: false,
    period: "month",
    cached: true,
  },
} as const;

/** What `getEarnings(uid, start, end)` returns inside `data.earnings`. */
export const TOUR_EARNINGS_DETAIL = {
  total: {
    total: 6731.25,
    gross: 8413.06,
    chartAmount: EARNINGS_CHART.map((d) => ({ count: d.amount, date: d.date })),
    chartCount: EARNINGS_CHART.map(() => Math.floor(Math.random() * 20) + 5),
  },
};

export const TOUR_PAYOUT_HISTORY = [
  {
    id: "tour-payout-3",
    amount: 4200,
    fee: 84,
    amountPaid: 4116,
    status: "completed",
    createdAt: isoDaysAgo(7),
  },
  {
    id: "tour-payout-2",
    amount: 3850,
    fee: 77,
    amountPaid: 3773,
    status: "completed",
    createdAt: isoDaysAgo(28),
  },
  {
    id: "tour-payout-1",
    amount: 3200,
    fee: 64,
    amountPaid: 3136,
    status: "completed",
    createdAt: isoDaysAgo(58),
  },
];

export const TOUR_PAYOUT_STATUS = {
  can_withdraw: true,
  blockers: [] as string[],
  check_receive: { ok: true },
  balances: {
    payoutAvailable: 2480.5,
    minPayoutSumm: 20,
    maxPayoutSumm: 2480.5,
  },
  account: {
    type: "bank",
    last_four: "8821",
    country: "US",
  },
};

/* ────────────────────────────────────────────────────────────────────────── *
 * Quick stats balances + polling state (used by QuickStats)                  *
 * ────────────────────────────────────────────────────────────────────────── */

/** Per-account balance the QuickStats card sums. */
export const TOUR_BALANCES: Record<string, { payoutAvailable: number }> = {
  "9999001": { payoutAvailable: 1480.5 },
  "9999002": { payoutAvailable: 720.0 },
  "9999003": { payoutAvailable: 280.0 },
};

export const TOUR_POLLING_STATE: Record<
  string,
  {
    of_user_id: string;
    polling_enabled: number;
    polling_interval_seconds: number;
    last_polled_at: string | null;
    polling_failure_count: number;
    allow_of_write_actions: number;
  }
> = {
  "9999001": {
    of_user_id: "9999001",
    polling_enabled: 1,
    polling_interval_seconds: 120,
    last_polled_at: isoMinutesAgo(2),
    polling_failure_count: 0,
    allow_of_write_actions: 0,
  },
  "9999002": {
    of_user_id: "9999002",
    polling_enabled: 1,
    polling_interval_seconds: 180,
    last_polled_at: isoMinutesAgo(3),
    polling_failure_count: 0,
    allow_of_write_actions: 1,
  },
  "9999003": {
    of_user_id: "9999003",
    polling_enabled: 0,
    polling_interval_seconds: 300,
    last_polled_at: isoHoursAgo(6),
    polling_failure_count: 0,
    allow_of_write_actions: 0,
  },
};

/* ────────────────────────────────────────────────────────────────────────── *
 * Fans                                                                       *
 * ────────────────────────────────────────────────────────────────────────── */

export const TOUR_FANS = [
  {
    id: "tour-fan-1",
    fan_of_user_id: "8001",
    of_user_id: "9999001",
    username: "sarah_92",
    display_name: "Sarah",
    avatar: null,
    total_spend: 489.5,
    total_tips: 145,
    total_events: 38,
    last_event_at: isoMinutesAgo(12),
    last_seen_at: isoMinutesAgo(12),
    first_seen_at: isoDaysAgo(74),
    tags: ["VIP", "whale"],
  },
  {
    id: "tour-fan-2",
    fan_of_user_id: "8002",
    of_user_id: "9999001",
    username: "mark.j",
    display_name: "Mark",
    avatar: null,
    total_spend: 412.0,
    total_tips: 88,
    total_events: 27,
    last_event_at: isoHoursAgo(2),
    last_seen_at: isoHoursAgo(2),
    first_seen_at: isoDaysAgo(61),
    tags: ["VIP"],
  },
  {
    id: "tour-fan-3",
    fan_of_user_id: "8003",
    of_user_id: "9999002",
    username: "jay_dee",
    display_name: "Jay D.",
    avatar: null,
    total_spend: 348.25,
    total_tips: 62,
    total_events: 22,
    last_event_at: isoHoursAgo(5),
    last_seen_at: isoHoursAgo(5),
    first_seen_at: isoDaysAgo(45),
    tags: ["loyal"],
  },
  {
    id: "tour-fan-4",
    fan_of_user_id: "8004",
    of_user_id: "9999001",
    username: "tomas.b",
    display_name: "Tomas",
    avatar: null,
    total_spend: 289.0,
    total_tips: 40,
    total_events: 19,
    last_event_at: isoHoursAgo(8),
    last_seen_at: isoHoursAgo(8),
    first_seen_at: isoDaysAgo(31),
    tags: [],
  },
  {
    id: "tour-fan-5",
    fan_of_user_id: "8005",
    of_user_id: "9999003",
    username: "lila.x",
    display_name: "Lila",
    avatar: null,
    total_spend: 245.5,
    total_tips: 75,
    total_events: 17,
    last_event_at: isoHoursAgo(14),
    last_seen_at: isoHoursAgo(14),
    first_seen_at: isoDaysAgo(22),
    tags: ["new"],
  },
  {
    id: "tour-fan-6",
    fan_of_user_id: "8006",
    of_user_id: "9999002",
    username: "kev_99",
    display_name: "Kev",
    avatar: null,
    total_spend: 198.0,
    total_tips: 30,
    total_events: 14,
    last_event_at: isoHoursAgo(3),
    last_seen_at: isoHoursAgo(3),
    first_seen_at: isoDaysAgo(40),
    tags: [],
  },
  {
    id: "tour-fan-7",
    fan_of_user_id: "8007",
    of_user_id: "9999001",
    username: "anna_ww",
    display_name: "Anna",
    avatar: null,
    total_spend: 162.75,
    total_tips: 28,
    total_events: 12,
    last_event_at: isoHoursAgo(6),
    last_seen_at: isoHoursAgo(6),
    first_seen_at: isoDaysAgo(18),
    tags: ["loyal"],
  },
  {
    id: "tour-fan-8",
    fan_of_user_id: "8008",
    of_user_id: "9999002",
    username: "ben_2k",
    display_name: "Ben",
    avatar: null,
    total_spend: 124.0,
    total_tips: 20,
    total_events: 9,
    last_event_at: isoHoursAgo(9),
    last_seen_at: isoHoursAgo(9),
    first_seen_at: isoDaysAgo(15),
    tags: [],
  },
  {
    id: "tour-fan-9",
    fan_of_user_id: "8009",
    of_user_id: "9999001",
    username: "ryanx",
    display_name: "Ryan",
    avatar: null,
    total_spend: 88.0,
    total_tips: 15,
    total_events: 8,
    last_event_at: isoHoursAgo(13),
    last_seen_at: isoHoursAgo(13),
    first_seen_at: isoDaysAgo(11),
    tags: [],
  },
  {
    id: "tour-fan-10",
    fan_of_user_id: "8010",
    of_user_id: "9999003",
    username: "mike_g",
    display_name: "Mike",
    avatar: null,
    total_spend: 60.0,
    total_tips: 10,
    total_events: 6,
    last_event_at: isoHoursAgo(15),
    last_seen_at: isoHoursAgo(15),
    first_seen_at: isoDaysAgo(9),
    tags: [],
  },
  {
    id: "tour-fan-11",
    fan_of_user_id: "8011",
    of_user_id: "9999002",
    username: "patty.k",
    display_name: "Patty",
    avatar: null,
    total_spend: 45.0,
    total_tips: 5,
    total_events: 4,
    last_event_at: isoHoursAgo(18),
    last_seen_at: isoHoursAgo(18),
    first_seen_at: isoDaysAgo(7),
    tags: ["new"],
  },
  {
    id: "tour-fan-12",
    fan_of_user_id: "8012",
    of_user_id: "9999001",
    username: "dave_o",
    display_name: "Dave",
    avatar: null,
    total_spend: 30.0,
    total_tips: 0,
    total_events: 3,
    last_event_at: isoHoursAgo(22),
    last_seen_at: isoHoursAgo(22),
    first_seen_at: isoDaysAgo(8),
    tags: [],
  },
];

/* ────────────────────────────────────────────────────────────────────────── *
 * Inbox / chats                                                              *
 * ────────────────────────────────────────────────────────────────────────── */

export const TOUR_CHATS = [
  {
    withUser: { id: "8001", username: "sarah_92", name: "Sarah", avatar: null },
    lastMessage: {
      id: "tour-msg-1-6",
      text: "I'd love to see that custom set you mentioned 💕",
      createdAt: isoMinutesAgo(7),
      fromUser: { id: "8001", username: "sarah_92" },
      price: 0,
    },
    unreadMessagesCount: 3,
    lastMessageAt: isoMinutesAgo(7),
  },
  {
    withUser: { id: "8002", username: "mark.j", name: "Mark", avatar: null },
    lastMessage: {
      id: "tour-msg-2-1",
      text: "Thanks for the quick reply, you're the best!",
      createdAt: isoHoursAgo(1),
      fromUser: { id: "8002", username: "mark.j" },
      price: 0,
    },
    unreadMessagesCount: 1,
    lastMessageAt: isoHoursAgo(1),
  },
  {
    withUser: { id: "8003", username: "jay_dee", name: "Jay D.", avatar: null },
    lastMessage: {
      id: "tour-msg-3-1",
      text: "sent: New gallery 📸",
      createdAt: isoHoursAgo(3),
      fromUser: { id: "9999001" },
      price: 25,
    },
    unreadMessagesCount: 0,
    lastMessageAt: isoHoursAgo(3),
  },
  {
    withUser: { id: "8004", username: "tomas.b", name: "Tomas", avatar: null },
    lastMessage: {
      id: "tour-msg-4-1",
      text: "any chance of a video call this weekend?",
      createdAt: isoHoursAgo(6),
      fromUser: { id: "8004", username: "tomas.b" },
      price: 0,
    },
    unreadMessagesCount: 2,
    lastMessageAt: isoHoursAgo(6),
  },
  {
    withUser: { id: "8005", username: "lila.x", name: "Lila", avatar: null },
    lastMessage: {
      id: "tour-msg-5-1",
      text: "you're amazing 😍",
      createdAt: isoHoursAgo(11),
      fromUser: { id: "8005", username: "lila.x" },
      price: 0,
    },
    unreadMessagesCount: 0,
    lastMessageAt: isoHoursAgo(11),
  },
  {
    withUser: { id: "8006", username: "kev_99", name: "Kev", avatar: null },
    lastMessage: {
      id: "tour-msg-6-1",
      text: "tipped $20",
      createdAt: isoHoursAgo(16),
      fromUser: { id: "8006", username: "kev_99" },
      price: 0,
    },
    unreadMessagesCount: 0,
    lastMessageAt: isoHoursAgo(16),
  },
  {
    withUser: { id: "8007", username: "anna_ww", name: "Anna", avatar: null },
    lastMessage: {
      id: "tour-msg-7-1",
      text: "renewed for 3 months — see you around 💕",
      createdAt: isoHoursAgo(19),
      fromUser: { id: "8007", username: "anna_ww" },
      price: 0,
    },
    unreadMessagesCount: 0,
    lastMessageAt: isoHoursAgo(19),
  },
  {
    withUser: { id: "8008", username: "ben_2k", name: "Ben", avatar: null },
    lastMessage: {
      id: "tour-msg-8-1",
      text: "really enjoyed the last post",
      createdAt: isoHoursAgo(23),
      fromUser: { id: "8008", username: "ben_2k" },
      price: 0,
    },
    unreadMessagesCount: 0,
    lastMessageAt: isoHoursAgo(23),
  },
];

/** Demo thread for whichever conversation is selected. The Inbox renderer
 *  doesn't care which fan it's for — it just renders the bubble list. */
export const TOUR_THREAD_MESSAGES = [
  {
    id: "tour-thr-1",
    text: "Hey beautiful, just subscribed — love your content!",
    createdAt: isoHoursAgo(21),
    fromUser: { id: "8001", username: "sarah_92", name: "Sarah" },
    isOpened: true,
    media: [],
    price: 0,
  },
  {
    id: "tour-thr-2",
    text: "Aww thank you so much! Welcome 💕 Let me know what you're into and I'll send some recommendations.",
    createdAt: isoHoursAgo(20),
    fromUser: { id: "9999001" },
    isOpened: true,
    media: [],
    price: 0,
  },
  {
    id: "tour-thr-3",
    text: "Tipped $50",
    createdAt: isoHoursAgo(19),
    fromUser: { id: "8001", username: "sarah_92" },
    isOpened: true,
    media: [],
    price: 50,
  },
  {
    id: "tour-thr-4",
    text: "Wow thank you Sarah!! That made my day. Here's a little something just for you 💋",
    createdAt: isoHoursAgo(18),
    fromUser: { id: "9999001" },
    isOpened: true,
    media: [{ name: "preview.jpg" }],
    price: 0,
  },
  {
    id: "tour-thr-5",
    text: "I'd love to see that custom set you mentioned 💕",
    createdAt: isoMinutesAgo(7),
    fromUser: { id: "8001", username: "sarah_92" },
    isOpened: false,
    media: [],
    price: 0,
  },
];

/* ────────────────────────────────────────────────────────────────────────── *
 * Subscribers                                                                *
 * ────────────────────────────────────────────────────────────────────────── */

export const TOUR_SUBSCRIBERS_CACHE: SubscribersCacheStatus = {
  total: 348,
  active: 312,
  expired: 36,
  spenders: 198,
  total_spent_sum: 18_420.5,
  breakdown: {
    tips: 4_120,
    messages: 5_840,
    posts: 1_980,
    streams: 1_280,
    subscriptions: 5_200.5,
  },
  last_row_synced_at: isoMinutesAgo(8),
  last_refreshed_at: isoMinutesAgo(8),
  consecutive_failures: 0,
};

function makeSubscriber(
  i: number,
  spent: number,
  username: string,
  displayName: string,
  daysSubbed: number,
  daysToExpire: number,
  active = true,
) {
  return {
    fan_of_user_id: `9${10000 + i}`,
    username,
    display_name: displayName,
    subscribed_at: isoDaysAgo(daysSubbed),
    expired_at:
      daysToExpire >= 0
        ? new Date(Date.now() + daysToExpire * DAY).toISOString()
        : isoDaysAgo(-daysToExpire),
    subscribe_price: 9.99,
    is_active: active ? 1 : 0,
    total_spent: spent,
    spent_tips: Math.round(spent * 0.25 * 100) / 100,
    spent_messages: Math.round(spent * 0.35 * 100) / 100,
    spent_posts: Math.round(spent * 0.15 * 100) / 100,
    spent_streams: Math.round(spent * 0.1 * 100) / 100,
    spent_subscriptions: Math.round(spent * 0.15 * 100) / 100,
  };
}

export const TOUR_SUBSCRIBERS = [
  makeSubscriber(1, 489.5, "sarah_92", "Sarah", 74, 16),
  makeSubscriber(2, 412.0, "mark.j", "Mark", 61, 22),
  makeSubscriber(3, 348.25, "jay_dee", "Jay D.", 45, 13),
  makeSubscriber(4, 289.0, "tomas.b", "Tomas", 31, 27),
  makeSubscriber(5, 245.5, "lila.x", "Lila", 22, 7),
  makeSubscriber(6, 198.0, "kev_99", "Kev", 40, 19),
  makeSubscriber(7, 162.75, "anna_ww", "Anna", 18, 11),
  makeSubscriber(8, 124.0, "ben_2k", "Ben", 15, 14),
  makeSubscriber(9, 88.0, "ryanx", "Ryan", 11, 18),
  makeSubscriber(10, 60.0, "mike_g", "Mike", 9, 20),
  makeSubscriber(11, 45.0, "patty.k", "Patty", 7, 22),
  makeSubscriber(12, 30.0, "dave_o", "Dave", 8, 21),
  makeSubscriber(13, 24.0, "kim_l", "Kim", 5, 24),
  makeSubscriber(14, 18.0, "tony_z", "Tony", 4, 25),
  makeSubscriber(15, 12.0, "nora.k", "Nora", 3, 26),
  makeSubscriber(16, 10.0, "rob_s", "Rob", 65, -3, false),
  makeSubscriber(17, 9.99, "stella_b", "Stella", 90, -8, false),
  makeSubscriber(18, 9.99, "henry.t", "Henry", 95, -12, false),
  makeSubscriber(19, 0, "mike_b", "Mike B.", 60, 4),
  makeSubscriber(20, 0, "lou.q", "Lou", 30, 9),
];

/* ────────────────────────────────────────────────────────────────────────── *
 * Transactions / purchases                                                   *
 * ────────────────────────────────────────────────────────────────────────── */

export const TOUR_TRANSACTIONS_CACHE: TransactionsCacheStatus = {
  total: 482,
  total_amount: 8_413.06,
  total_net: 6_731.25,
  oldest: isoDaysAgo(30),
  newest: isoMinutesAgo(15),
  by_type: [
    { tx_type: "Tip", n: 168, amt: 1_540.5 },
    { tx_type: "Message", n: 142, amt: 2_140.0 },
    { tx_type: "Subscription", n: 98, amt: 980.02 },
    { tx_type: "Post", n: 56, amt: 642.0 },
    { tx_type: "Stream", n: 18, amt: 348.75 },
  ],
  last_refreshed_at: isoMinutesAgo(15),
  consecutive_failures: 0,
  last_tx_marker: null,
};

function makeTx(
  i: number,
  type: string,
  amount: number,
  hoursAgo: number,
  fan: string,
) {
  const fee = Math.round(amount * 0.2 * 100) / 100;
  const net = Math.round((amount - fee) * 100) / 100;
  return {
    id: `tour-tx-${i}`,
    tx_id: `tour-tx-${i}`,
    description: `${type} from <a href="#">${fan}</a>`,
    amount,
    net,
    fee,
    tx_type: type,
    type,
    status: "done",
    createdAt: isoHoursAgo(hoursAgo),
    created_at: isoHoursAgo(hoursAgo),
  };
}

export const TOUR_TRANSACTIONS = [
  makeTx(1, "Tip", 50, 0.25, "sarah_92"),
  makeTx(2, "Message", 25, 1, "mark.j"),
  makeTx(3, "Subscription", 9.99, 2, "patty.k"),
  makeTx(4, "Tip", 100, 3, "jay_dee"),
  makeTx(5, "Message", 35, 5, "tomas.b"),
  makeTx(6, "Post", 12, 8, "anna_ww"),
  makeTx(7, "Tip", 200, 9, "sarah_92"),
  makeTx(8, "Message", 15, 10, "ben_2k"),
  makeTx(9, "Stream", 30, 10.5, "kev_99"),
  makeTx(10, "Subscription", 9.99, 11, "lila.x"),
  makeTx(11, "Tip", 75, 12, "mark.j"),
  makeTx(12, "Message", 45, 13, "ryanx"),
  makeTx(13, "Tip", 25, 13.5, "lila.x"),
  makeTx(14, "Message", 60, 14, "jay_dee"),
  makeTx(15, "Subscription", 9.99, 14.5, "mike_g"),
  makeTx(16, "Tip", 15, 15, "dave_o"),
  makeTx(17, "Post", 18, 16, "anna_ww"),
  makeTx(18, "Message", 22, 16.5, "kev_99"),
  makeTx(19, "Tip", 40, 17, "tomas.b"),
  makeTx(20, "Subscription", 9.99, 17.5, "kim_l"),
  makeTx(21, "Message", 28, 18, "mark.j"),
  makeTx(22, "Tip", 90, 18.5, "sarah_92"),
  makeTx(23, "Stream", 18, 19, "anna_ww"),
  makeTx(24, "Message", 33, 19.5, "ben_2k"),
  makeTx(25, "Tip", 20, 20, "lila.x"),
  makeTx(26, "Subscription", 9.99, 20.5, "tony_z"),
  makeTx(27, "Message", 50, 21, "jay_dee"),
  makeTx(28, "Post", 14, 21.5, "mike_g"),
  makeTx(29, "Tip", 35, 22, "ryanx"),
  makeTx(30, "Message", 40, 23, "tomas.b"),
];

/* ────────────────────────────────────────────────────────────────────────── *
 * Campaigns                                                                  *
 * ────────────────────────────────────────────────────────────────────────── */

export const TOUR_CAMPAIGNS = [
  {
    id: "tour-camp-1",
    campaignName: "Reddit /r/onlyfans promo",
    campaignCode: "RDT1",
    countSubscribers: { count: 47 },
    countTransitions: { count: 1_280 },
    createdAt: isoDaysAgo(28),
  },
  {
    id: "tour-camp-2",
    campaignName: "TikTok bio link",
    campaignCode: "TKT2",
    countSubscribers: { count: 89 },
    countTransitions: { count: 3_420 },
    createdAt: isoDaysAgo(45),
  },
  {
    id: "tour-camp-3",
    campaignName: "Twitter pinned tweet",
    campaignCode: "TWT3",
    countSubscribers: { count: 32 },
    countTransitions: { count: 980 },
    createdAt: isoDaysAgo(15),
  },
  {
    id: "tour-camp-4",
    campaignName: "Instagram story swipe-up",
    campaignCode: "IGS4",
    countSubscribers: { count: 18 },
    countTransitions: { count: 540 },
    createdAt: isoDaysAgo(7),
  },
];

export const TOUR_CAMPAIGNS_EARNINGS: CampaignEarnings[] = [
  {
    campaign_id: "tour-camp-1",
    claimers_count: 47,
    mapped_claimers_count: 45,
    total_spent: 2_840.5,
    coverage_pct: 96,
  },
  {
    campaign_id: "tour-camp-2",
    claimers_count: 89,
    mapped_claimers_count: 86,
    total_spent: 4_120.0,
    coverage_pct: 97,
  },
  {
    campaign_id: "tour-camp-3",
    claimers_count: 32,
    mapped_claimers_count: 30,
    total_spent: 1_240.75,
    coverage_pct: 94,
  },
  {
    campaign_id: "tour-camp-4",
    claimers_count: 18,
    mapped_claimers_count: 16,
    total_spent: 480.0,
    coverage_pct: 89,
  },
];

export const TOUR_CAMPAIGNS_CACHE: CampaignsCacheStatus = {
  campaigns: 4,
  claimers: 186,
  last_row_synced_at: isoMinutesAgo(20),
  last_refreshed_at: isoMinutesAgo(20),
  consecutive_failures: 0,
};

/* ────────────────────────────────────────────────────────────────────────── *
 * Notifications                                                              *
 * ────────────────────────────────────────────────────────────────────────── */

export const TOUR_NOTIFICATIONS = [
  {
    id: "tour-notif-1",
    type: "tip",
    text: "tipped you $50.00",
    isRead: false,
    createdAt: isoMinutesAgo(15),
    replacePairs: { "{NAME}": "sarah_92" },
  },
  {
    id: "tour-notif-2",
    type: "subscriber",
    text: "subscribed to your account",
    isRead: false,
    createdAt: isoMinutesAgo(48),
    replacePairs: { "{NAME}": "patty.k" },
  },
  {
    id: "tour-notif-3",
    type: "paided_message",
    text: "paid $25.00 for your message",
    isRead: false,
    createdAt: isoHoursAgo(2),
    replacePairs: { "{NAME}": "mark.j" },
  },
  {
    id: "tour-notif-4",
    type: "subscriber",
    text: "renewed their subscription",
    isRead: true,
    createdAt: isoHoursAgo(4),
    replacePairs: { "{NAME}": "anna_ww" },
  },
  {
    id: "tour-notif-5",
    type: "tip",
    text: "tipped you $100.00",
    isRead: true,
    createdAt: isoHoursAgo(6),
    replacePairs: { "{NAME}": "jay_dee" },
  },
  {
    id: "tour-notif-6",
    type: "post",
    text: "purchased your post for $12.00",
    isRead: true,
    createdAt: isoHoursAgo(8),
    replacePairs: { "{NAME}": "tomas.b" },
  },
  {
    id: "tour-notif-7",
    type: "subscriber",
    text: "subscribed to your account",
    isRead: true,
    createdAt: isoHoursAgo(10),
    replacePairs: { "{NAME}": "lila.x" },
  },
  {
    id: "tour-notif-8",
    type: "stream",
    text: "tipped $30.00 during your stream",
    isRead: true,
    createdAt: isoHoursAgo(12),
    replacePairs: { "{NAME}": "kev_99" },
  },
  {
    id: "tour-notif-9",
    type: "tip",
    text: "tipped you $75.00",
    isRead: true,
    createdAt: isoHoursAgo(14),
    replacePairs: { "{NAME}": "mark.j" },
  },
  {
    id: "tour-notif-10",
    type: "subscriber",
    text: "subscribed to your account",
    isRead: true,
    createdAt: isoHoursAgo(17),
    replacePairs: { "{NAME}": "ben_2k" },
  },
  {
    id: "tour-notif-11",
    type: "paided_message",
    text: "paid $45.00 for your message",
    isRead: true,
    createdAt: isoHoursAgo(19),
    replacePairs: { "{NAME}": "ryanx" },
  },
  {
    id: "tour-notif-12",
    type: "tip",
    text: "tipped you $25.00",
    isRead: true,
    createdAt: isoHoursAgo(22),
    replacePairs: { "{NAME}": "lila.x" },
  },
];

/* ────────────────────────────────────────────────────────────────────────── *
 * Events / activity feed                                                     *
 * ────────────────────────────────────────────────────────────────────────── */

function makeEvent(
  i: number,
  type: string,
  payload: Record<string, any>,
  hoursAgo: number,
  ofUserId = "9999001",
): LiveEvent {
  return {
    id: 100_000 - i,
    crm_id: "tour",
    of_user_id: ofUserId,
    event_type: type,
    source_event_id: `src-${i}`,
    payload,
    occurred_at: isoHoursAgo(hoursAgo),
    created_at: isoHoursAgo(hoursAgo),
  };
}

export const TOUR_EVENTS: LiveEvent[] = [
  makeEvent(
    1,
    "new_tip",
    { fan: { username: "sarah_92", display_name: "Sarah" }, amount: 50 },
    0.1,
  ),
  makeEvent(
    2,
    "new_subscriber",
    { fan: { username: "patty.k", display_name: "Patty" } },
    0.8,
  ),
  makeEvent(
    3,
    "new_purchase",
    { fan: { username: "mark.j", display_name: "Mark" }, amount: 25 },
    2,
  ),
  makeEvent(
    4,
    "balance_increased",
    { delta: 75.0, available: 2480.5 },
    3,
    "9999002",
  ),
  makeEvent(
    5,
    "new_tip",
    { fan: { username: "jay_dee", display_name: "Jay D." }, amount: 100 },
    4,
  ),
  makeEvent(
    6,
    "new_message",
    { fan: { username: "lila.x", display_name: "Lila" } },
    7,
    "9999003",
  ),
  makeEvent(
    7,
    "renewed_subscriber",
    { fan: { username: "anna_ww", display_name: "Anna" } },
    10,
  ),
  makeEvent(
    8,
    "new_purchase",
    { fan: { username: "tomas.b", display_name: "Tomas" }, amount: 12 },
    13,
  ),
  makeEvent(
    9,
    "new_tip",
    { fan: { username: "sarah_92", display_name: "Sarah" }, amount: 200 },
    16,
  ),
  makeEvent(
    10,
    "new_subscriber",
    { fan: { username: "ben_2k", display_name: "Ben" } },
    18,
    "9999002",
  ),
  makeEvent(
    11,
    "new_purchase",
    { fan: { username: "kev_99", display_name: "Kev" }, amount: 30 },
    21,
  ),
  makeEvent(
    12,
    "expired_subscriber",
    { delta: 2 },
    23,
  ),
];

/* ────────────────────────────────────────────────────────────────────────── *
 * Automations                                                                *
 * ────────────────────────────────────────────────────────────────────────── */

export const TOUR_AUTOMATIONS = [
  {
    id: 9_001,
    name: "Auto-thank tippers (Discord)",
    trigger_event: "new_tip",
    action_type: "discord",
    action_params: { channel: "#tips", template: "🎉 {payload.fan.username} tipped ${payload.amount}!" },
    conditions: [{ field: "amount", op: "gte", value: 5 }],
    of_user_id: null,
    is_active: 1,
    run_count: 184,
    last_run_at: isoMinutesAgo(15),
  },
  {
    id: 9_002,
    name: "Welcome new subscribers",
    trigger_event: "new_subscriber",
    action_type: "send_dm",
    action_params: { text: "Hey {payload.fan.username}! Thanks for subscribing 💕" },
    conditions: [],
    of_user_id: "9999001",
    is_active: 1,
    run_count: 47,
    last_run_at: isoMinutesAgo(48),
  },
  {
    id: 9_003,
    name: "Tag whales in CRM",
    trigger_event: "new_tip",
    action_type: "tag_fan",
    action_params: { tag: "whale" },
    conditions: [{ field: "amount", op: "gte", value: 100 }],
    of_user_id: null,
    is_active: 0,
    run_count: 12,
    last_run_at: isoHoursAgo(6),
  },
];

/* ────────────────────────────────────────────────────────────────────────── *
 * Webhooks                                                                   *
 * ────────────────────────────────────────────────────────────────────────── */

export const TOUR_WEBHOOKS = [
  {
    id: 7_001,
    url: "https://example.com/of-events",
    event_types: ["new_tip", "new_subscriber", "new_purchase"],
    description: "Forward all earnings events to internal CRM",
    secret: "whsec_demoXXXXXXXXXXXXXXXXX",
    is_active: 1,
    status: "approved",
    consecutive_failures: 0,
    last_delivery_at: isoMinutesAgo(15),
    last_status_code: 200,
  },
  {
    id: 7_002,
    url: "https://example.com/zapier-hook",
    event_types: ["new_subscriber", "renewed_subscriber"],
    description: "Sync subscribers into Mailchimp via Zapier",
    secret: "whsec_demoYYYYYYYYYYYYYYYYY",
    is_active: 1,
    status: "approved",
    consecutive_failures: 0,
    last_delivery_at: isoHoursAgo(2),
    last_status_code: 200,
  },
];
