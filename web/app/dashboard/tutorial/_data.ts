export interface GuideStep {
  title: string;
  body: string;
}

export interface GuideTip {
  kind: "tip" | "gotcha";
  body: string;
}

export interface FeatureGuide {
  intro: string;
  steps: GuideStep[];
  tips?: GuideTip[];
  endpoints?: { method: "GET" | "POST" | "PATCH" | "DELETE"; path: string; what: string }[];
  related?: { label: string; href: string }[];
}

export interface FeatureMeta {
  key: string;
  title: string;
  description: string;
  iconKey: IconKey;
  href?: string;
  cta?: string;
  highlights?: { iconKey: IconKey; label: string }[];
  guide: FeatureGuide;
}

export interface SectionMeta {
  key: string;
  label: string;
  iconKey: IconKey;
  intro: string;
  features: FeatureMeta[];
}

export type IconKey =
  | "play"
  | "dashboard"
  | "users"
  | "user"
  | "userCheck"
  | "mail"
  | "dollar"
  | "receipt"
  | "megaphone"
  | "bell"
  | "activity"
  | "zap"
  | "link"
  | "book"
  | "file"
  | "settings"
  | "check"
  | "chevronRight"
  | "key"
  | "shield"
  | "globe"
  | "lock"
  | "refresh"
  | "trending"
  | "search"
  | "filter"
  | "palette"
  | "code"
  | "send";

const ONBOARDING: FeatureMeta[] = [
  {
    key: "connect",
    title: "Connect your first OnlyFans account",
    description:
      "Add your OnlyFans login from Accounts. Sessions use a Chrome 136 impersonation client; cookies stay scoped to your CRM panel.",
    iconKey: "users",
    href: "/dashboard/accounts",
    cta: "Open Accounts",
    highlights: [
      { iconKey: "lock", label: "2FA supported" },
      { iconKey: "globe", label: "Per-account proxy" },
    ],
    guide: {
      intro:
        "Linking an account is the only required step. Once a session is stored the panel can fetch fans, subscribers, earnings, and stream live events for that account.",
      steps: [
        { title: "Open Accounts", body: "Sidebar → Accounts." },
        {
          title: "Click Add account",
          body: "Enter the OF email + password. Optionally paste a SOCKS5/HTTPS proxy URL — strongly recommended if you log in from a server.",
        },
        {
          title: "Solve 2FA / captcha",
          body: "If OF prompts for a 2FA code we surface a one-time-code field. Captchas are solved automatically via 2captcha when configured.",
        },
        {
          title: "Wait for status = ready",
          body: "On success the row turns green and shows the OF username. The session is now persisted under the panel's saved_sessions/ directory.",
        },
      ],
      tips: [
        {
          kind: "tip",
          body: "Store one proxy per account, not one global proxy — different IPs reduce risk of OF rate-limit flags.",
        },
        {
          kind: "gotcha",
          body: "If OF triggers a CF challenge after login, the panel auto-retries with a Turnstile token. A manual retry is fine if it fails the first time.",
        },
      ],
      endpoints: [
        { method: "POST", path: "/api/crm/{crm_id}/accounts", what: "Add account (email/password/proxy)" },
        { method: "GET", path: "/api/crm/{crm_id}/accounts", what: "List accounts" },
      ],
    },
  },
  {
    key: "polling",
    title: "Enable polling",
    description:
      "Toggle polling per account to start streaming events: tips, subs, messages, balance changes. Default interval 60s, fully tunable.",
    iconKey: "activity",
    href: "/dashboard/accounts",
    cta: "Toggle polling",
    highlights: [{ iconKey: "refresh", label: "Auto-pause after 5 fails" }],
    guide: {
      intro:
        "Polling is what turns a static account into a live one. The poller diffs notifications + balance + subscriber count every interval and emits typed events into the system.",
      steps: [
        { title: "Open Accounts", body: "Find the row of the account you just connected." },
        {
          title: "Toggle Polling on",
          body: "The interval defaults to 60s. Lower it for more responsive automations or raise it to save quota.",
        },
        {
          title: "Watch /dashboard/activity",
          body: "Within one interval you should see new events appear. If nothing comes through after 2 minutes, check the proxy and Activity logs.",
        },
      ],
      tips: [
        {
          kind: "tip",
          body: "60s hits the sweet spot for most creators. Below 30s you start hammering OF and risk soft-flags.",
        },
        {
          kind: "gotcha",
          body: "After 5 consecutive failures the poller auto-pauses that account and emits a polling_paused event. Re-enable from the same toggle.",
        },
      ],
      endpoints: [
        {
          method: "PATCH",
          path: "/api/crm/{crm_id}/accounts/{of_user_id}/polling",
          what: "Enable / disable / change interval",
        },
      ],
    },
  },
  {
    key: "webhook",
    title: "Set up a webhook",
    description:
      "Forward events to your own server. Each delivery is HMAC-SHA256 signed; failed POSTs retry at 5s, 30s, 5m, 30m, 2h.",
    iconKey: "link",
    href: "/dashboard/webhooks",
    cta: "Create webhook",
    highlights: [
      { iconKey: "shield", label: "HMAC signed" },
      { iconKey: "refresh", label: "5-stage retry" },
    ],
    guide: {
      intro:
        "Webhooks are the simplest way to push events out of the panel. Subscribe to specific event types, get a signed POST per event, retry until success.",
      steps: [
        { title: "Open Webhooks", body: "Sidebar → Webhooks → New webhook." },
        { title: "Set the destination URL", body: "Any HTTPS endpoint that returns 2xx within 5s." },
        {
          title: "Pick event types",
          body: "Use * to receive everything, or pick specific types like new_tip, new_subscriber, balance_increased.",
        },
        {
          title: "Save and copy the secret",
          body: "Verify the X-OnlyAPI-Signature header on your end. Its value is sha256=<hex digest>, where the digest is HMAC-SHA256 over the string \"{X-OnlyAPI-Timestamp}.\" + the raw body (the timestamp, a literal dot, then the body — not the raw body alone), keyed with your webhook secret.",
        },
      ],
      tips: [
        {
          kind: "tip",
          body: "Send Test from the panel to confirm your endpoint accepts the signature before relying on it.",
        },
        {
          kind: "gotcha",
          body: "After 5 consecutive delivery failures the webhook auto-deactivates. Re-enable from the row toggle once you've fixed your endpoint.",
        },
      ],
    },
  },
  {
    key: "automation",
    title: "Build an automation",
    description:
      "Trigger → conditions → action. Ping Discord/Slack/Telegram, tag a fan, or DM them on tip. Templating: {payload.fan.username}.",
    iconKey: "zap",
    href: "/dashboard/automations",
    cta: "New automation",
    highlights: [{ iconKey: "check", label: "Test run before saving" }],
    guide: {
      intro:
        "Automations run server-side every time a matching event is emitted. They're great for routing tips to a Discord channel or auto-DM-ing new subscribers.",
      steps: [
        { title: "Pick a trigger", body: "An event type like new_tip or new_subscriber." },
        {
          title: "Add conditions",
          body: "Optional. Operators: eq, neq, gt, gte, lt, lte, contains, startswith, in. E.g. payload.amount gt 50.",
        },
        {
          title: "Pick an action",
          body: "webhook, discord, slack, telegram, send_dm, tag_fan. Param strings support {payload.x.y} templating.",
        },
        {
          title: "Run with sample",
          body: "The Test button fires the action against a synthetic event so you can verify formatting before going live.",
        },
      ],
      tips: [
        {
          kind: "tip",
          body: "Leave of_user_id NULL to apply the rule to every account in the panel — handy for global notifications.",
        },
        {
          kind: "gotcha",
          body: "send_dm requires the per-account allow_of_write_actions toggle. Off by default — opt-in only.",
        },
      ],
    },
  },
  {
    key: "api",
    title: "Use the API directly",
    description:
      "Every panel feature is also an HTTP endpoint. Authenticate with X-API-Key (find yours on Overview or Settings).",
    iconKey: "key",
    href: "/dashboard/api-docs",
    cta: "Open API Docs",
    highlights: [{ iconKey: "code", label: "200+ endpoints" }],
    guide: {
      intro:
        "The CRM panel is a thin client over the REST API. Anything you can do here you can do from your own backend with one HTTP call.",
      steps: [
        { title: "Grab your API key", body: "Overview → API credentials, or Settings." },
        {
          title: "Send the X-API-Key header",
          body: "Never put the key in the query string — only the header is accepted to avoid log leakage.",
        },
        {
          title: "Try it",
          body: "Open API Docs, pick an endpoint, fill the form, hit Run. The response renders inline.",
        },
      ],
      tips: [
        {
          kind: "tip",
          body: "Pass an X-Proxy header alongside X-API-Key to override the per-account proxy on a per-call basis.",
        },
      ],
    },
  },
];

const ACCOUNTS: FeatureMeta[] = [
  {
    key: "accounts-list",
    title: "Accounts",
    description:
      "Connected OnlyFans accounts in one place. Add a new login (with optional proxy + 2FA), set the subscription price, refresh subscriber/spending data inline.",
    iconKey: "users",
    href: "/dashboard/accounts",
    cta: "Manage accounts",
    highlights: [
      { iconKey: "globe", label: "Per-account proxy" },
      { iconKey: "activity", label: "Polling toggle" },
    ],
    guide: {
      intro:
        "The control room for every OF account on the panel. Each row exposes the most common day-to-day actions inline.",
      steps: [
        { title: "Add account", body: "Email + password + optional proxy. Stores a session you can re-use indefinitely." },
        {
          title: "Toggle polling",
          body: "Per-row switch + interval picker. Off by default; turn on to start receiving events.",
        },
        {
          title: "Refresh subs / spending",
          body: "Inline buttons trigger a fresh fetch from OF without waiting for the next poll cycle.",
        },
        {
          title: "Click a row",
          body: "Opens the per-account drilldown with charts, top fans, and recent events scoped to that account.",
        },
      ],
    },
  },
  {
    key: "account-detail",
    title: "Account drilldown",
    description:
      "Click any account to see its 30-day earnings sparkline, current balance, subscriber count, top spenders by tips, and recent events for that account only.",
    iconKey: "trending",
    href: "/dashboard/accounts",
    cta: "View detail",
    guide: {
      intro:
        "Drilldown is the per-account version of the Overview. Numbers + chart + leaderboard + activity, all scoped to one account.",
      steps: [
        { title: "Open from Accounts", body: "Click the row of the account you want to inspect." },
        {
          title: "Read the KPI strip",
          body: "Balance, subscriber count, polling status, automation count — refreshed live.",
        },
        {
          title: "Scan the sparkline",
          body: "30-day earnings trend. Hover to see daily values.",
        },
        {
          title: "Check Top fans",
          body: "Leaderboard sorted by tips for this account only — useful for prioritising DMs.",
        },
      ],
    },
  },
  {
    key: "settings",
    title: "Settings",
    description:
      "Profile + API key (copy or regenerate), theme appearance (color + ASCII background), and account disconnection.",
    iconKey: "settings",
    href: "/dashboard/settings",
    cta: "Open Settings",
    highlights: [
      { iconKey: "key", label: "API key controls" },
      { iconKey: "palette", label: "Theme picker" },
    ],
    guide: {
      intro:
        "All panel-level configuration sits here: identity, secret, theme, and the kill-switch for disconnected accounts.",
      steps: [
        { title: "Read your profile", body: "Email, plan, connected account count." },
        {
          title: "Reveal the API key",
          body: "Password-gated reveal + copy. Use this on every API request.",
        },
        {
          title: "Customise appearance",
          body: "Pick an accent color and an ASCII background. Persists in your browser.",
        },
      ],
      tips: [
        {
          kind: "gotcha",
          body: "Regenerating the API key invalidates the old one immediately. Update every integration before clicking confirm.",
        },
      ],
    },
  },
];

const FANS: FeatureMeta[] = [
  {
    key: "fans",
    title: "Fans",
    description:
      "Global fan list aggregated across all accounts: tips, total spend, engagement score. Search, sort, filter by account or tag, open a detail drawer with spending breakdown.",
    iconKey: "user",
    href: "/dashboard/fans",
    cta: "Browse fans",
    highlights: [
      { iconKey: "search", label: "Search + sort" },
      { iconKey: "filter", label: "Tag filter" },
    ],
    guide: {
      intro:
        "Fans aggregates everyone who's ever interacted with any of your accounts. The list updates as the poller emits new events.",
      steps: [
        { title: "Search by username", body: "Top-bar search filters the list as you type." },
        {
          title: "Sort by what matters",
          body: "Tips, spend, engagement, last activity. Default is tips-desc.",
        },
        {
          title: "Filter by account or tag",
          body: "Combine filters to find e.g. high-tippers tagged 'vip' on a specific account.",
        },
        {
          title: "Click for a drawer",
          body: "Slide-in detail with spending breakdown, recent events, and an inline tag editor.",
        },
      ],
    },
  },
  {
    key: "inbox",
    title: "Inbox",
    description:
      "Split-pane DM client: conversation list on the left, message thread on the right. Search threads, see unread badges, scroll to load more.",
    iconKey: "mail",
    href: "/dashboard/inbox",
    cta: "Open Inbox",
    guide: {
      intro:
        "Read-mostly DM client across all accounts. Compose is currently a stub — best for triage right now.",
      steps: [
        { title: "Pick a conversation", body: "List sorted by recent activity, unread badges visible." },
        {
          title: "Read the thread",
          body: "Day-grouped bubbles, smart timestamp formatting, scroll to load older messages.",
        },
        {
          title: "Switch accounts",
          body: "The header account selector scopes the inbox to one OF account at a time.",
        },
      ],
      tips: [
        {
          kind: "tip",
          body: "For now, automate replies via the send_dm action in Automations rather than typing here.",
        },
      ],
    },
  },
  {
    key: "subscribers",
    title: "Subscribers",
    description:
      "Subscriber roster with lifetime spend, sub price, expiry date. Filter active vs expired. Toggle cached (fast) vs live (direct OF) data.",
    iconKey: "userCheck",
    href: "/dashboard/subscribers",
    cta: "View subscribers",
    guide: {
      intro:
        "The complete subscriber list per account, with spend totals and renewal dates so you can plan retention work.",
      steps: [
        { title: "Pick an account", body: "Header account selector." },
        {
          title: "Filter active / expired",
          body: "Tabs at the top of the list.",
        },
        {
          title: "Toggle cached vs live",
          body: "Cached is instant; Live re-fetches from OF (slower but authoritative).",
        },
      ],
    },
  },
];

const MONEY: FeatureMeta[] = [
  {
    key: "earnings",
    title: "Earnings",
    description:
      "Revenue chart over a custom date range with net vs gross totals. Request a payout (with min/max validation) and watch the payout history with status tracking.",
    iconKey: "dollar",
    href: "/dashboard/earnings",
    cta: "Open Earnings",
    guide: {
      intro:
        "Earnings is the financial dashboard: chart, totals, and the payout request form.",
      steps: [
        { title: "Pick a date range", body: "Custom range or one of the presets (today / week / month)." },
        {
          title: "Read the chart",
          body: "Daily series; toggle net vs gross. Sparkline above the chart shows the same series compressed.",
        },
        {
          title: "Request a payout",
          body: "Validates against the per-account minimum and the available balance. Submits straight to OF.",
        },
        {
          title: "Watch payout history",
          body: "Status updates as OF processes the request. Failures surface a reason inline.",
        },
      ],
    },
  },
  {
    key: "purchases",
    title: "Transactions",
    description:
      "Per-transaction ledger with date filter and type tags (tip, message, sub, post, stream). Cached vs live toggle, manual refresh.",
    iconKey: "receipt",
    href: "/dashboard/purchases",
    cta: "Open Transactions",
    guide: {
      intro:
        "Authoritative ledger of every payment OF has on file for your accounts. Use this when an Earnings number looks off.",
      steps: [
        { title: "Filter by date", body: "Date range picker at the top." },
        {
          title: "Read the type tag",
          body: "tip / message / subscription / post / stream. Tells you which OF surface the payment came from.",
        },
        {
          title: "Toggle cached vs live",
          body: "Same pattern as Subscribers — cached is instant, live re-pulls from OF.",
        },
      ],
    },
  },
  {
    key: "campaigns",
    title: "Campaigns",
    description:
      "Tracking-link campaigns with click / sub / earnings attribution. Create campaigns, view claimers per campaign, copy shareable links.",
    iconKey: "megaphone",
    href: "/dashboard/campaigns",
    cta: "Open Campaigns",
    guide: {
      intro:
        "Track where new subscribers come from. Each campaign is a unique tracked link; clicks and conversions attribute back to it.",
      steps: [
        { title: "Create a campaign", body: "Name + (optional) description. The link is generated for you." },
        { title: "Copy the link", body: "Share it on socials, ads, anywhere you'd put a vanilla OF link." },
        {
          title: "Watch attribution",
          body: "Click count, sub count, earnings — refreshed live as events arrive.",
        },
        { title: "View claimers", body: "Per-campaign list of who came in through that link." },
      ],
    },
  },
];

const REALTIME: FeatureMeta[] = [
  {
    key: "activity",
    title: "Activity feed",
    description:
      "Real-time event stream from the background poller. Filter by event type (tips, subs, messages, balance changes, …) and expand any event to see its raw payload.",
    iconKey: "activity",
    href: "/dashboard/activity",
    cta: "Open Activity",
    guide: {
      intro:
        "Every event the poller has emitted, newest first. The system-of-record for what's actually happening behind the scenes.",
      steps: [
        { title: "Filter by type", body: "Toggle pills at the top." },
        {
          title: "Click a row to expand",
          body: "Reveals the full payload JSON + occurred_at + source_event_id. Same shape webhooks see.",
        },
        {
          title: "Watch the live indicator",
          body: "Green = SSE connected; gray = reconnecting (auto, exponential backoff).",
        },
      ],
    },
  },
  {
    key: "notifications",
    title: "Notifications",
    description:
      "OnlyFans-side notification feed (tips / subs / messages / purchases). Type-tagged, sorted by time, load more on demand.",
    iconKey: "bell",
    href: "/dashboard/notifications",
    cta: "View notifications",
    guide: {
      intro:
        "Mirrors the OF native notifications surface so you don't have to switch tabs to scan recent activity.",
      steps: [
        { title: "Switch accounts", body: "Header account selector scopes the feed." },
        { title: "Read or load more", body: "Infinite scroll style; older items load on demand." },
      ],
      tips: [
        {
          kind: "tip",
          body: "For programmatic access prefer the Activity page — it's the typed/normalised version.",
        },
      ],
    },
  },
  {
    key: "overview",
    title: "Overview dashboard",
    description:
      "Earnings breakdown with period toggle (today / week / month), live activity feed, quick stats (accounts, polling, balance, automations, webhooks), and an API credentials widget.",
    iconKey: "dashboard",
    href: "/dashboard",
    cta: "Open Overview",
    guide: {
      intro:
        "The home page. Read it left-to-right: total earnings → category breakdown → live feed → key counts.",
      steps: [
        { title: "Toggle period", body: "Today / This week / This month — drives every number on the page." },
        {
          title: "Hover the chart",
          body: "Inline sparkline shows the period's daily series.",
        },
        {
          title: "Click any quick stat",
          body: "Each row deep-links to the matching feature page.",
        },
      ],
    },
  },
];

const AUTOMATION: FeatureMeta[] = [
  {
    key: "automations",
    title: "Automations",
    description:
      "Visual rule builder: pick a trigger (tip, new sub, …), add conditions (eq / gt / contains / …), pick an action (webhook, Discord, Slack, Telegram, send DM, tag fan). Test-run before saving, view run history.",
    iconKey: "zap",
    href: "/dashboard/automations",
    cta: "Open Automations",
    highlights: [
      { iconKey: "check", label: "Test run" },
      { iconKey: "file", label: "Run log" },
    ],
    guide: {
      intro:
        "If you want events to do something without writing code, Automations is the right surface. Trigger → optional conditions → one action.",
      steps: [
        { title: "Trigger", body: "Pick an event type. Leave of_user_id NULL to apply to every account." },
        {
          title: "Conditions",
          body: "Add zero or more. Path supports dot-notation into payload (payload.fan.username, payload.amount, …).",
        },
        {
          title: "Action",
          body: "Discord / Slack / Telegram / webhook / send_dm / tag_fan. String params support {payload.x.y} templating.",
        },
        { title: "Test run", body: "Fires the action with a synthetic event so you can verify formatting." },
        { title: "Save + activate", body: "Toggle is_active to enable. View runs in the Runs tab to debug." },
      ],
      tips: [
        {
          kind: "tip",
          body: "Common pattern: 'When new_tip with amount > $50, send Discord alert with @here.' Two conditions, three minutes to set up.",
        },
        {
          kind: "gotcha",
          body: "send_dm requires per-account allow_of_write_actions. It is OFF by default. Without it the run fails with a clear error.",
        },
      ],
    },
  },
  {
    key: "webhooks",
    title: "Webhooks",
    description:
      "Webhook CRUD for event subscriptions. Create / edit / delete, toggle active, send a test payload, and inspect the delivery log with success/failure per attempt.",
    iconKey: "link",
    href: "/dashboard/webhooks",
    cta: "Open Webhooks",
    highlights: [
      { iconKey: "shield", label: "HMAC-SHA256" },
      { iconKey: "refresh", label: "Auto-retry" },
    ],
    guide: {
      intro:
        "Lower-level than Automations: a signed POST per event, retry policy, and full delivery history.",
      steps: [
        { title: "Create a webhook", body: "URL + secret + event_types (use * for all)." },
        {
          title: "Verify the signature",
          body: "X-OnlyAPI-Signature is sha256=<hex digest>, where the digest is HMAC-SHA256 of \"{X-OnlyAPI-Timestamp}.\" + the raw body (not the raw body alone) using the secret you stored. The timestamp comes from the X-OnlyAPI-Timestamp header on the same request.",
        },
        {
          title: "Watch deliveries",
          body: "Per-attempt log with response code + snippet. Pending rows show the next_retry_at timestamp.",
        },
        {
          title: "Send test",
          body: "Fires a synthetic event of the first subscribed type. Useful for sanity-checking the URL.",
        },
      ],
    },
  },
];

const API: FeatureMeta[] = [
  {
    key: "api-docs",
    title: "API Docs",
    description:
      "Interactive explorer for every CRM endpoint. Method, path, description, and a try-it panel that runs the request against your own panel with live response.",
    iconKey: "book",
    href: "/dashboard/api-docs",
    cta: "Try endpoints",
    guide: {
      intro:
        "Read + run the API in one place. The same X-API-Key your dashboard uses signs every try-it request.",
      steps: [
        { title: "Pick an endpoint", body: "Grouped by category in the left rail." },
        {
          title: "Fill the form",
          body: "Path params + query params + body — generated from the endpoint's schema.",
        },
        {
          title: "Run it",
          body: "Response renders inline with status code, headers, and pretty-printed JSON.",
        },
      ],
      tips: [
        {
          kind: "tip",
          body: "Copy as cURL is on the response card — paste it straight into your terminal or Postman.",
        },
      ],
    },
  },
];

export const SECTIONS: SectionMeta[] = [
  {
    key: "start",
    label: "Get started",
    iconKey: "play",
    intro: "Five steps from zero to streaming events.",
    features: ONBOARDING,
  },
  {
    key: "accounts",
    label: "Accounts & settings",
    iconKey: "users",
    intro: "Manage the OnlyFans accounts connected to your panel and your own profile.",
    features: ACCOUNTS,
  },
  {
    key: "fans",
    label: "Fans & engagement",
    iconKey: "user",
    intro: "Everything about the people on the other side of your accounts.",
    features: FANS,
  },
  {
    key: "money",
    label: "Money & analytics",
    iconKey: "dollar",
    intro: "Where the revenue comes from and where it goes.",
    features: MONEY,
  },
  {
    key: "realtime",
    label: "Real-time feeds",
    iconKey: "activity",
    intro: "Three lenses on what's happening right now across your accounts.",
    features: REALTIME,
  },
  {
    key: "automation",
    label: "Automation & integrations",
    iconKey: "zap",
    intro: "Push events out of the panel and into Discord, Slack, Telegram, or your own backend.",
    features: AUTOMATION,
  },
  {
    key: "api",
    label: "API access",
    iconKey: "code",
    intro: "Skip the UI and call every feature directly from your code.",
    features: API,
  },
];

export const ALL_FEATURE_KEYS: string[] = SECTIONS.flatMap((s) =>
  s.features.map((f) => f.key)
);
