# Data Export API — "Download your data"

Async, per-account data export. You kick off a job, it walks the selected data
(cheap cached tables first, expensive live platform walks last), packages
**CSV + JSON into a ZIP**, and reports progress live over SSE. The ZIP is
downloadable for 7 days.

There's also a UI for all of this at **`/dashboard/export`** — this doc is the
raw API behind it.

```bash
export BASE="https://your-install.example.com"
export CRM="crm_xxxxxxxxxxxxxxxx"                       # your panel id
export KEY="your-api-key-here"                          # Dashboard → Settings → API Credentials
export OFUID="123456789"                                # the connected account
AUTH=(-H "X-API-Key: $KEY")
```
> **No User-Agent gating.** Responses do not vary by client: `curl/8.5.0`,
> `python-requests` and a browser User-Agent all get byte-identical bodies.

---

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/api/crm/$CRM/accounts/$OFUID/exports` | Start a job → `202` |
| `GET`  | `/api/crm/$CRM/accounts/$OFUID/exports?limit&offset` | History `{jobs,total}` |
| `GET`  | `/api/crm/$CRM/accounts/$OFUID/exports/{job_id}` | One job's status `{job}` |
| `GET`  | `/api/crm/$CRM/accounts/$OFUID/exports/{job_id}/download` | Download the ZIP |
| `POST` | `/api/crm/$CRM/accounts/$OFUID/exports/{job_id}/cancel` | Stop a running job |
| `DELETE`| `/api/crm/$CRM/accounts/$OFUID/exports/{job_id}` | Delete the job + ZIP |
| `GET`  | `/api/crm/$CRM/events/stream` | SSE — live `export.progress` / `export.complete` |

---

## 1. Start an export

```bash
curl -s "${AUTH[@]}" -H "Content-Type: application/json" \
  -X POST "$BASE/api/crm/$CRM/accounts/$OFUID/exports" \
  -d '{
        "data_types": ["account","subscribers","transactions","fans","earnings","messages"],
        "since": "2026-06-01",
        "until": null,
        "include_media": false
      }'
```

**Body**

| Field | Type | Notes |
|---|---|---|
| `data_types` | string[] | Non-empty subset of `account, subscribers, transactions, fans, earnings, messages` |
| `since` | `"YYYY-MM-DD"` \| null | Lower bound (optional) |
| `until` | `"YYYY-MM-DD"` \| null | Upper bound (optional). Both null = all-time |
| `include_media` | bool | Download message media (OnlyFans only; much larger/slower) |

**Response `202`**
```json
{ "success": true,
  "job": { "job_id": "f01152d3…", "status": "queued", ... },
  "warning": "Messages and media are fetched live from the platform — this can take several minutes and counts against your API quota." }
```
Only **one export runs per account at a time.** A second request while one is
in flight returns `{"already_running": true, "job": <the existing one>}` — unless
that job is stale (>30 min with no terminal status), in which case it's marked
failed and yours starts fresh.

---

## 2. Track progress

**Poll** (simple):
```bash
curl -s "${AUTH[@]}" "$BASE/api/crm/$CRM/accounts/$OFUID/exports/<JOB_ID>"
```

**Live (SSE)** — the dashboard uses this. Subscribe to the account's event
stream and watch for `export.progress` / `export.complete`:
```bash
curl -sN "${AUTH[@]}" "$BASE/api/crm/$CRM/events/stream"
# event: export.progress
# data: {"job_id":"…","status":"running","phase":"messages","phase_index":6,
#        "phase_total":7,"counts":{...},"updated_at":"…"}
```

---

## 3. Download

Only when `status == "complete"`:
```bash
curl -s "${AUTH[@]}" -o export.zip \
  "$BASE/api/crm/$CRM/accounts/$OFUID/exports/<JOB_ID>/download"
```
Returns `application/zip`. `409` if the job isn't complete, `404` after it
expires (7 days) or is deleted.

## 4. Cancel / delete

```bash
curl -s "${AUTH[@]}" -X POST   "$BASE/api/crm/$CRM/accounts/$OFUID/exports/<JOB_ID>/cancel"  # 409 if not running
curl -s "${AUTH[@]}" -X DELETE "$BASE/api/crm/$CRM/accounts/$OFUID/exports/<JOB_ID>"         # removes job + ZIP
```

---

## Job object

```jsonc
{
  "job_id": "f01152d3ebf0456da0f7a3066aed8544",
  "of_user_id": "123456789",
  "crm_id": "crm_xxxxxxxxxxxxxxxx",
  "platform": "onlyfans",
  "status": "running",          // queued | running | complete | failed | canceled | expired
  "phase": "messages",          // account|subscribers|transactions|fans|earnings|messages|media|packaging|complete
  "data_types": ["account","subscribers","transactions","fans","earnings","messages"],
  "since": "2026-06-01", "until": null, "include_media": false,
  "counts": {
    "api_calls": 84,
    "account": 1, "subscribers": 0, "transactions": 0, "fans": 0, "earnings": 1,
    "messages": { "discovering": false, "discovered": 1073,
                  "chats_done": 15, "chats_total": 1073, "messages": 303 },
    "media": { "downloaded": 0, "failed": 0, "bytes": 0 }
  },
  "warnings": [ { "phase": "messages", "error": "message walk stopped at the 1200s time budget after 360/1073 conversations" } ],
  "error": null,
  "file_name": "of-export-examplecreator-2026-06-01_now.zip",
  "file_size": 78931,
  "created_at": "…", "started_at": "…", "completed_at": "…", "expires_at": "…"
}
```
- During the **messages** phase, `counts.messages` shows `discovering`/`discovered`
  while it's finding conversations, then `chats_done`/`chats_total`/`messages`
  while it walks them.
- `warnings` is non-fatal: a section that came back short or a budget-truncated
  walk is recorded here, and the job still completes. **Always check it** — a
  completed export can still be partial.

---

## What's in the ZIP

```
of-export-<username>-<range>/
  account.json
  README.txt
  manifest.json                     # counts, warnings, what was included
  data/
    subscribers.json  subscribers.csv
    transactions.json transactions.csv
    fans.json         fans.csv
    earnings.json
  messages/
    index.json                      # one entry per conversation + per-convo roll-ups
    messages.csv                    # flat, one row per message — columns below
    <fan-username>.json             # per-conversation message list
  media/                            # only when include_media=true (OnlyFans)
    <conversation>/<msg_id>-<n>.<ext>
```

---

## The worker model — how the scrape actually proceeds

There is no separate worker service. `POST …/exports` writes an `export_jobs`
row with `status=queued` and hands the job to the **in-process APScheduler**
(`scheduler.run_in_background`), which runs `export_runner.run_export` **once**
on a background thread of the same Flask process. Only string arguments are
passed, so the job survives being pickled into the SQLite jobstore.

**The DB row is the source of truth; SSE is only a nudge.** A client that drops
its stream can always `GET` the job and recover the exact same state. Never
treat a missed `export.progress` as a failure.

Phases run **strictly in sequence**, cheap-and-free first, expensive-and-live
last, and each phase is independently wrapped in try/except:

```
queued
  └─ running
       ├─ account        cached · 0 platform calls
       ├─ subscribers    cached · 0 platform calls   (paged 500/query)
       ├─ transactions   cached · 0 platform calls   (paged 1000/query)
       ├─ fans           cached · 0 platform calls   (paged 500/query)
       ├─ earnings       LIVE   · 1-2 platform calls
       ├─ messages       LIVE   · the expensive one — see below
       ├─ media          LIVE   · only when include_media=true
       └─ packaging      writes manifest.json + README.txt, zips, sets expires_at
  └─ complete | failed | canceled
```

**A failing phase does not fail the export.** The error is appended to
`warnings[]` and the remaining phases still run — which is precisely why a
`complete` job can still be partial. Always read `warnings`.

### Inside the messages phase

Two stages, and the progress payload tells you which one you are in:

1. **Discovery** — walk the conversation list. `counts.messages.discovering` is
   `true` and `discovered` climbs. OnlyFans' `/chats` endpoint **ignores the
   requested page size** (it serves 10-14 per call regardless) and its offset
   counts conversations, so the walker advances by however many the page
   actually held and stops only on an empty page, `hasMore:false`, or the
   conversation cap. A short page is *not* the end.
2. **Per-conversation walk** — `discovering` disappears and
   `chats_done`/`chats_total`/`messages` climb. Each conversation is paged by an
   **`id` cursor** (the oldest id seen so far), not an offset. Here too a short
   page is not the end of history. Pages that overlap at the cursor boundary are
   de-duplicated by message id. Progress is flushed every 5 conversations.

Both stages share one **wall-clock deadline** (`EXPORT_MAX_RUNTIME_SECONDS`,
20 min). When it trips the walk stops, records a `warnings` entry naming how far
it got (`… after 360/1073 conversations`), and the export still packages and
completes. Cancellation is cooperative: the cancel route flips the row to
`canceled` and the worker notices at the next conversation boundary.

Every live call is counted into `counts.api_calls` for this job. That number is
reporting only: there is no API quota in this build, and nothing is metered or
billed. (The `warning` string the start route returns still says "counts against
your API quota" — that wording is vestigial and can be ignored.)

> **Known limits (not yet fixed):** a job has **no resume** — a truncated walk
> must be re-run, ideally narrowed with `since`/`until`. And a job that dies
> without a terminal status is only superseded after a **30-minute** staleness
> window.

---

## Message fields

`messages/<fan>.json` omits fields that don't apply, so the file stays readable;
`messages/messages.csv` has fixed columns and writes `""` for the same cases.

| CSV column | JSON key | Type | Meaning |
|---|---|---|---|
| `conversation` | *(file/index)* | string | Fan username, or fan id if no username |
| `fan_of_user_id` | *(index)* | string | The fan's platform user id |
| `message_id` | `id` | string | Platform message id — join key for `reply_to_message_id` |
| `direction` | `direction` | `sent`\|`received` | `sent` = from the connected creator account |
| `created_at` | `at` | ISO-8601 | When the message was sent |
| `text` | `text` | string | Body, HTML stripped and entities decoded |
| `price` | `price` | number | `0`/`""` when not priced |
| `is_tip` | `is_tip` | bool | |
| `purchased` | `purchased` | bool \| `""` | Only meaningful on a **sent** PPV |
| `is_liked` | `liked` | bool \| `""` | **See "Likes" below** |
| `reply_status` | `reply_status` | `replied`\|`no_reply`\|`""` | **See "Reply status" below** |
| `replied_at` | `replied_at` | ISO-8601 \| `""` | When the qualifying reply arrived |
| `reply_latency_seconds` | `reply_latency_seconds` | int \| `""` | `replied_at − created_at` |
| `reply_to_message_id` | `reply_to_message_id` | string \| `""` | Native quote-reply target, when the message quotes another |
| `media_count` | *(len of `media`)* | int | Attachments on the message |

### Likes

OnlyFans **does** expose a like on a chat message: the message object carries a
boolean **`isLiked`**, in the same serializer as `isTip` / `isOpened` /
`canPurchase`. It is surfaced as `is_liked` (CSV) / `liked` (JSON). The matching
write endpoints are `POST` and `DELETE /api2/v2/messages/{message_id}/like` with
a `{"withUserId": …}` body — the export only ever reads.

Read the value like this:

| Value | Meaning |
|---|---|
| `true` | A like reaction exists on this message |
| `false` | No like reaction on this message |
| `""` / key absent | **Unknown** — the platform exposes no like state (all Fansly messages) |

Two caveats worth taking seriously:

- **`false` and "absent" are not the same thing**, which is why `false` is always
  written out rather than omitted as an empty value.
- **The payload names no actor.** OnlyFans ships no `likedBy`, `likedByUserId`
  or `likesCount` on messages — only the bare boolean. In a 1:1 DM either party
  can leave the like, so on a `sent` message `is_liked:true` is *in practice*
  the fan having liked your message, but the API does not attest to who left it.
  Do not present it to end users as a guaranteed "the fan liked this".

### Reply status

OnlyFans has **no "was this replied to" field**, so it is derived from the
thread order. The rule, exactly:

> An **outbound** message is `replied` if and only if the **very next message in
> the conversation is inbound** (from the fan) — the fan answered before you sent
> anything else. Otherwise it is `no_reply`. Inbound messages get `""`, since the
> question doesn't apply to them.

The consequences are deliberate:

- A fan message that arrived **before** yours never counts — only what follows a
  message can be a reply to it.
- In a run of **consecutive outbound** messages, only the **last** one can be
  `replied`; the earlier ones were superseded by your own next message.
  Crediting the whole burst would make any reply rate meaningless.
- A thread where the fan **only ever messaged first** → every outbound message
  is `no_reply`.
- The **last outbound message of a live conversation** reads `no_reply` until the
  fan actually answers. That is correct, not a bug.

One addition strengthens it: OnlyFans has a **native quote-reply**. If an inbound
message explicitly quotes one of yours (`reply_to_message_id`), that proves the
quoted message was replied to — so it is marked `replied` even if it sits mid-burst.

**Scope caveat:** the derivation runs over the messages **included in this
export**. A reply that falls outside your `since`/`until` window, or past a
truncated walk, cannot be seen — so narrow windows understate replies. Because
the flag is computed from the exact sequence written to the file, you can always
verify any `replied` by looking at the next row of the same conversation.

### `messages/index.json`

One entry per conversation, with roll-ups so you don't have to re-walk every file:

```jsonc
{ "conversation": "somefan", "fan_of_user_id": "…", "file": "somefan.json",
  "message_count": 42, "media_count": 7,
  "sent_count": 25, "received_count": 17,
  "liked_count": 3,        // messages in this thread carrying a like
  "replied_count": 11 }    // of the 25 sent, how many were replied to
```

### Media on a message

Each entry of `media` is `{type, id, can_view, url?}`.

`url` is **deliberately omitted when `can_view` is `false`** — an unpurchased PPV
has no full-resolution URL to give, and any URL that did appear would be rejected
by the CDN because the signed policy is only issued for purchased content.
Attempting it would spend an upstream request on a guaranteed failure. The durable `id` is
still recorded, so locked content remains identifiable. `can_view` exists so you
can tell "locked, nothing was lost" (`can_view:false`, no url) from "viewable but
no url was found" (`can_view:true`, no url — worth reporting).

---

## Behaviour & limits

| | |
|---|---|
| **Cached vs live** | `account/subscribers/transactions/fans` come from the CRM cache — **instant, 0 platform calls**. `earnings` = 1 live call. `messages` walks the platform live, which is many calls and the slow part; `media` downloads files. |
| **Runtime budget** | The live message walk is capped at **20 min** (`EXPORT_MAX_RUNTIME_SECONDS`). On a huge account it stops early, records a `warnings` note, and still packages what it got. Narrow with `since`/`until` for a complete run. |
| **Caps** | 2000 conversations (`EXPORT_MAX_CHATS`), 5000 messages per conversation (`EXPORT_MAX_MESSAGES_PER_CHAT`), 5000 media files / 5 GiB (`EXPORT_MAX_MEDIA_FILES`, `EXPORT_MAX_MEDIA_BYTES`). |
| **Retention** | Downloadable for **7 days** (`EXPORT_RETENTION_DAYS`), then auto-deleted. |
| **Concurrency** | One export per account at a time (stale >30 min is superseded). |

> **Empty cached sections?** A newly-created panel (or one an account was just
> moved into) has empty `subscribers/transactions/fans` caches, so those export
> as `0` rows. Run `POST …/subscribers/refresh` + `…/transactions/refresh` first
> to populate them; `messages`/`earnings` walk live regardless.

---

## Full example (Python — start → poll → download)

```python
import requests, time
BASE, CRM, KEY, OFUID = "https://your-install.example.com", "crm_xxxxxxxxxxxxxxxx", \
    "your-api-key-here", "123456789"
H = {"X-API-Key": KEY, "Content-Type": "application/json"}

r = requests.post(f"{BASE}/api/crm/{CRM}/accounts/{OFUID}/exports", headers=H, json={
    "data_types": ["account","subscribers","transactions","fans","earnings","messages"],
    "since": "2026-06-01", "until": None, "include_media": False})
job_id = r.json()["job"]["job_id"]

while True:
    j = requests.get(f"{BASE}/api/crm/{CRM}/accounts/{OFUID}/exports/{job_id}", headers=H).json()["job"]
    m = (j.get("counts") or {}).get("messages") or {}
    print(j["status"], j.get("phase"),
          f'{m.get("chats_done")}/{m.get("chats_total")}' if not m.get("discovering") else f'found {m.get("discovered")}')
    if j["status"] in ("complete","failed","canceled"): break
    time.sleep(5)

if j["status"] == "complete":
    if j.get("warnings"): print("notes:", j["warnings"])
    z = requests.get(f"{BASE}/api/crm/{CRM}/accounts/{OFUID}/exports/{job_id}/download", headers=H)
    open("export.zip","wb").write(z.content)
    print("saved export.zip", len(z.content), "bytes")
```

See also [EVENTS.md](EVENTS.md) for the event and webhook payload shapes, and
the full endpoint reference in the panel at `/dashboard/api-docs`
(OpenAPI at `/api/openapi.json`).
