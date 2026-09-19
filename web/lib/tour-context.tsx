"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { usePathname, useRouter } from "next/navigation";

export type TourPlacement = "top" | "bottom" | "left" | "right" | "auto";

export interface TourStep {
  /** Required: a CSS selector targeting an element rendered with data-tour="…". */
  selector: string;
  title: string;
  /** Short, calm body. Aim for ≤2 sentences and a concrete use case. */
  body: string;
  /** Optional: a route the user must be on for this step to make sense. */
  route?: string;
  /** Hint for popover placement; the overlay will flip if it overflows. */
  placement?: TourPlacement;
  /** Required: which chapter this step belongs to (matches a `TourChapter.id`). */
  chapter: string;
}

/**
 * Chapters break the ~30 atomic steps into bite-sized arcs. Bucketing tames
 * the "1 of 30" overwhelm — the user sees "Chapter 2 of 6 · Foundations"
 * instead. Same atoms underneath, much friendlier mental model.
 */
export interface TourChapter {
  id: string;
  title: string;
  /** One-line promise of what this chapter shows. Used on the chapter intro card. */
  hook: string;
}

export const TOUR_CHAPTERS: TourChapter[] = [
  {
    id: "home",
    title: "Your home base",
    hook: "Get oriented — earnings, live activity, and the controls you'll come back to every day.",
  },
  {
    id: "accounts-fans",
    title: "Accounts & fans",
    hook: "Connect OF accounts, then meet the people who keep coming back.",
  },
  {
    id: "money",
    title: "Money in, money out",
    hook: "See where your earnings come from, and request payouts when you're ready.",
  },
  {
    id: "conversations",
    title: "Conversations & subscribers",
    hook: "Your inbox and your subscriber list — the human side of the business.",
  },
  {
    id: "growth",
    title: "Growth & signals",
    hook: "Tracked links and a real-time feed of what's happening across your accounts.",
  },
  {
    id: "automate",
    title: "Automate & integrate",
    hook: "Let the panel work for you — automations, webhooks, and the API.",
  },
];

export const TOUR_STEPS: TourStep[] = [
  // ─── Chapter 1: Your home base ───
  {
    chapter: "home",
    selector: "[data-tour='sidebar-nav']",
    title: "Welcome — here's your map",
    body: "Every feature lives in this sidebar. We'll visit each one together. You can leave anytime and come back where you stopped.",
    route: "/dashboard",
    placement: "right",
  },
  {
    chapter: "home",
    selector: "[data-tour='header-account']",
    title: "Your active account",
    body: "Some pages (Inbox, Subscribers, Earnings) show one account at a time. Switch which one up here whenever you like.",
    route: "/dashboard",
    placement: "bottom",
  },
  {
    chapter: "home",
    selector: "[data-tour='overview-earnings'], [data-tour='sidebar-nav']",
    title: "Today's earnings, at a glance",
    body: "Total + a sparkline + breakdown by source. Flip between today, this week, and this month with one click.",
    route: "/dashboard",
    placement: "bottom",
  },
  {
    chapter: "home",
    selector: "[data-tour='overview-live-activity'], [data-tour='sidebar-nav']",
    title: "What's happening, live",
    body: "Tips, subs, purchases — they show up here the moment they happen. Tap a row for the full payload.",
    route: "/dashboard",
    placement: "right",
  },
  {
    chapter: "home",
    selector: "[data-tour='overview-quick-stats'], [data-tour='sidebar-nav']",
    title: "Your morning health-check",
    body: "Spot a payout drop or a webhook outage in two seconds — perfect for a daily glance before you start work.",
    route: "/dashboard",
    placement: "left",
  },
  {
    chapter: "home",
    selector: "[data-tour='overview-api-key'], [data-tour='sidebar-nav']",
    title: "Your API key",
    body: "Hidden by default — click the eye to reveal, then copy. Use it for any external integration you build.",
    route: "/dashboard",
    placement: "left",
  },

  // ─── Chapter 2: Accounts & fans ───
  {
    chapter: "accounts-fans",
    selector: "[data-tour='accounts-add']",
    title: "Connect an OF account",
    body: "Email, password, optional proxy — that's it. We handle 2FA and captchas automatically.",
    route: "/dashboard/accounts",
    placement: "left",
  },
  {
    chapter: "accounts-fans",
    selector: "[data-tour='accounts-list'], [data-tour='accounts-add']",
    title: "All your accounts in one table",
    body: "Toggle polling per row, set sub price, refresh data inline. Click any row for the deep-dive on that account.",
    route: "/dashboard/accounts",
    placement: "top",
  },
  {
    chapter: "accounts-fans",
    selector: "[data-tour='fans-search']",
    title: "Find a fan in seconds",
    body: "Search by username, then sort by tips, spend, or recent activity. Filter by account or tag too.",
    route: "/dashboard/fans",
    placement: "bottom",
  },
  {
    chapter: "accounts-fans",
    selector: "[data-tour='fans-list'], [data-tour='fans-search']",
    title: "Every fan, every account",
    body: "Aggregated across your whole panel. Click a row to slide open their spending breakdown and recent events.",
    route: "/dashboard/fans",
    placement: "top",
  },

  // ─── Chapter 3: Money in, money out ───
  {
    chapter: "money",
    selector: "[data-tour='earnings-chart']",
    title: "Your revenue over time",
    body: "Daily totals across your selected range. Hover any bar to see the exact day.",
    route: "/dashboard/earnings",
    placement: "top",
  },
  {
    chapter: "money",
    selector: "[data-tour='earnings-payout']",
    title: "Request a payout",
    body: "We check the minimum and your balance, then submit straight to OF. Track status in the history list below.",
    route: "/dashboard/earnings",
    placement: "left",
  },
  {
    chapter: "money",
    selector: "[data-tour='purchases-filter']",
    title: "Filter your transactions",
    body: "Pick a date range, choose cached or live, and refresh manually if you need the freshest numbers.",
    route: "/dashboard/purchases",
    placement: "bottom",
  },
  {
    chapter: "money",
    selector: "[data-tour='purchases-list'], [data-tour='purchases-filter']",
    title: "The single source of truth",
    body: "Every payment, in order. When an Earnings number ever feels off, this is the ledger that settles it.",
    route: "/dashboard/purchases",
    placement: "top",
  },

  // ─── Chapter 4: Conversations & subscribers ───
  {
    chapter: "conversations",
    selector: "[data-tour='inbox-list']",
    title: "Your conversations",
    body: "Sorted by recent activity. Search to find a thread fast; unread badges show what needs attention.",
    route: "/dashboard/inbox",
    placement: "right",
  },
  {
    chapter: "conversations",
    selector: "[data-tour='inbox-thread']",
    title: "Read messages calmly",
    body: "Day-grouped bubbles with smart timestamps so long threads still feel readable. Auto-replies live in Automations.",
    route: "/dashboard/inbox",
    placement: "left",
  },
  {
    chapter: "conversations",
    selector: "[data-tour='subscribers-source']",
    title: "Cached or live?",
    body: "Cached is instant. Live re-fetches from OF — slower, but the final word when something looks off.",
    route: "/dashboard/subscribers",
    placement: "bottom",
  },
  {
    chapter: "conversations",
    selector: "[data-tour='subscribers-list'], [data-tour='subscribers-source']",
    title: "Your subscriber roster",
    body: "Lifetime spend, sub price, expiry date — all in one place. Filter active vs expired with the dropdown above.",
    route: "/dashboard/subscribers",
    placement: "top",
  },

  // ─── Chapter 5: Growth & signals ───
  {
    chapter: "growth",
    selector: "[data-tour='campaigns-create']",
    title: "Track where fans come from",
    body: "Generate a unique link, share it on socials or ads, and see exactly which channel converts.",
    route: "/dashboard/campaigns",
    placement: "left",
  },
  {
    chapter: "growth",
    selector: "[data-tour='campaigns-list'], [data-tour='campaigns-create']",
    title: "Attribution, refreshed live",
    body: "Per-campaign clicks, subs, and earnings update in real time. Open any row to see who joined.",
    route: "/dashboard/campaigns",
    placement: "top",
  },
  {
    chapter: "growth",
    selector: "[data-tour='notifications-feed']",
    title: "Native OF notifications",
    body: "The same feed you'd see on OnlyFans, mirrored here for your active account.",
    route: "/dashboard/notifications",
    placement: "top",
  },
  {
    chapter: "growth",
    selector: "[data-tour='activity-filter']",
    title: "Drill into one event type",
    body: "Want to see only tips, only new subs? Multi-select to combine — e.g. tips + new purchases.",
    route: "/dashboard/activity",
    placement: "bottom",
  },
  {
    chapter: "growth",
    selector: "[data-tour='activity-feed'], [data-tour='activity-filter']",
    title: "Every event, typed and structured",
    body: "Newest first. Click a row to expand the same JSON your webhooks and automations receive.",
    route: "/dashboard/activity",
    placement: "top",
  },

  // ─── Chapter 6: Automate & integrate ───
  {
    chapter: "automate",
    selector: "[data-tour='automations-new']",
    title: "Build a simple automation",
    body: "Pick a trigger, add conditions, choose an action — like pinging Discord when a tip comes in.",
    route: "/dashboard/automations",
    placement: "left",
  },
  {
    chapter: "automate",
    selector: "[data-tour='automations-list'], [data-tour='automations-new']",
    title: "Run, pause, debug",
    body: "Toggle active, test-run, and inspect the run log to see why anything skipped or failed.",
    route: "/dashboard/automations",
    placement: "top",
  },
  {
    chapter: "automate",
    selector: "[data-tour='webhooks-new']",
    title: "Send events to your own server",
    body: "URL, secret, event types. We sign every delivery and retry failures — you just receive them.",
    route: "/dashboard/webhooks",
    placement: "left",
  },
  {
    chapter: "automate",
    selector: "[data-tour='webhooks-list'], [data-tour='webhooks-new']",
    title: "Watch deliveries land",
    body: "Status, recent attempts, response codes. Auto-deactivates after 5 failures so a broken endpoint can't spam you.",
    route: "/dashboard/webhooks",
    placement: "top",
  },
  {
    chapter: "automate",
    selector: "[data-tour='api-docs-list']",
    title: "Browse every endpoint",
    body: "Grouped by category. Click any one to open the live try-it panel on the right.",
    route: "/dashboard/api-docs",
    placement: "right",
  },
  {
    chapter: "automate",
    selector: "[data-tour='api-docs-tryit']",
    title: "Try it live",
    body: "Edit method, path, body, then run — using the same API key the dashboard uses. Copy as cURL when you're done.",
    route: "/dashboard/api-docs",
    placement: "left",
  },
];

/* ────────────────────────────────────────────────────────────────────────── *
 * Derived helpers — chapter math is needed in many places, centralise it.    *
 * ────────────────────────────────────────────────────────────────────────── */

export interface ChapterProgress {
  chapter: TourChapter;
  /** 1-based chapter ordinal. */
  chapterNumber: number;
  /** Total chapters in the tour. */
  chapterTotal: number;
  /** 1-based index of the current step *within* this chapter. */
  stepInChapter: number;
  /** Total steps in this chapter. */
  stepsInChapter: number;
  /** True if this is the last step inside its chapter. */
  isChapterLast: boolean;
  /** True if this is the very first step of the chapter (>0). */
  isChapterFirst: boolean;
}

export function getChapterProgress(stepIndex: number): ChapterProgress {
  const step = TOUR_STEPS[stepIndex];
  const chapter =
    TOUR_CHAPTERS.find((c) => c.id === step?.chapter) ?? TOUR_CHAPTERS[0];
  const chapterNumber =
    TOUR_CHAPTERS.findIndex((c) => c.id === chapter.id) + 1;
  const chapterTotal = TOUR_CHAPTERS.length;
  const stepsInChapter = TOUR_STEPS.filter(
    (s) => s.chapter === chapter.id
  ).length;
  // First step in this chapter, anywhere in TOUR_STEPS:
  const chapterFirstIdx = TOUR_STEPS.findIndex(
    (s) => s.chapter === chapter.id
  );
  const stepInChapter = stepIndex - chapterFirstIdx + 1;
  const isChapterLast = stepInChapter === stepsInChapter;
  const isChapterFirst = stepInChapter === 1;
  return {
    chapter,
    chapterNumber,
    chapterTotal,
    stepInChapter,
    stepsInChapter,
    isChapterLast,
    isChapterFirst,
  };
}

interface TourContextValue {
  isActive: boolean;
  stepIndex: number;
  steps: TourStep[];
  chapters: TourChapter[];
  progress: ChapterProgress;
  start: () => void;
  next: () => void;
  prev: () => void;
  goTo: (i: number) => void;
  end: (reason?: TourEndReason) => void;
  /** True iff the user just completed the last step (vs. dismissed mid-tour). */
  justCompleted: boolean;
  dismissCelebration: () => void;
}

export type TourEndReason = "completed" | "skipped";

const TourContext = createContext<TourContextValue | null>(null);

export function TourProvider({ children }: { children: React.ReactNode }) {
  const [isActive, setActive] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);
  const [justCompleted, setJustCompleted] = useState(false);
  const router = useRouter();
  const pathname = usePathname();

  // Pure state updaters — navigation handled in a side-effect below.
  const start = useCallback(() => {
    setStepIndex(0);
    setJustCompleted(false);
    setActive(true);
  }, []);

  const goTo = useCallback((i: number) => {
    if (i < 0 || i >= TOUR_STEPS.length) return;
    setStepIndex(i);
  }, []);

  const next = useCallback(() => {
    setStepIndex((i) => {
      if (i + 1 >= TOUR_STEPS.length) {
        // Reached the end — flip into celebration mode rather than just closing.
        setJustCompleted(true);
        return i;
      }
      return i + 1;
    });
  }, []);

  const prev = useCallback(() => {
    setStepIndex((i) => Math.max(0, i - 1));
  }, []);

  const end = useCallback((_reason: TourEndReason = "skipped") => {
    setActive(false);
    setStepIndex(0);
    setJustCompleted(false);
  }, []);

  const dismissCelebration = useCallback(() => {
    setActive(false);
    setStepIndex(0);
    setJustCompleted(false);
  }, []);

  // Side-effect: navigate when active step's route differs from the current
  // route. Skip if we're already on the right route to avoid spurious pushes.
  useEffect(() => {
    if (!isActive) return;
    if (justCompleted) return;
    const step = TOUR_STEPS[stepIndex];
    if (!step?.route) return;
    if (pathname === step.route) return;
    router.push(step.route);
  }, [isActive, stepIndex, pathname, router, justCompleted]);

  const progress = useMemo(() => getChapterProgress(stepIndex), [stepIndex]);

  const value = useMemo<TourContextValue>(
    () => ({
      isActive,
      stepIndex,
      steps: TOUR_STEPS,
      chapters: TOUR_CHAPTERS,
      progress,
      start,
      next,
      prev,
      goTo,
      end,
      justCompleted,
      dismissCelebration,
    }),
    [
      isActive,
      stepIndex,
      progress,
      start,
      next,
      prev,
      goTo,
      end,
      justCompleted,
      dismissCelebration,
    ]
  );

  return <TourContext.Provider value={value}>{children}</TourContext.Provider>;
}

export function useTour(): TourContextValue {
  const ctx = useContext(TourContext);
  if (!ctx) {
    throw new Error("useTour must be used inside TourProvider");
  }
  return ctx;
}
