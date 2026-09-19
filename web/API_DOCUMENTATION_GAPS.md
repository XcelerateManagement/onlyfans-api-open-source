# API Documentation Gap Analysis

Comparison of three sources:
1. **OpenAPI Spec** (`app/api/openapi.json/route.ts`) — Scalar API Reference
2. **API Docs Page** (`app/dashboard/api-docs/page.tsx`) — Interactive playground
3. **Backend** (`onlyfans-api/crm_api.py`) — Actual Flask endpoints

---

## Audit — 2026-08-05 (at commit `55d99aa`)

Re-checked every claim in this file against the code. Method: parse the
`method:`/`path:` pairs the playground declares (236 of them) and require an
**exact** method + path match, rather than a substring search that would report
`/posts` as present because `/posts/bookmarks` exists.

| Claim in this file | Verdict |
|---|---|
| 18 endpoints missing from the api-docs playground | **Wrong count, and now fully closed.** The tables list **17** rows, not 18. All 17 are present in `app/dashboard/api-docs/page.tsx` today |
| 3 backend auth endpoints undocumented | **Half closed.** All three are now in the OpenAPI spec; none are in the playground |
| `GET /payments/referrals/balance` returns `{ balance }` | **Wrong field name** — see below |
| `GET /payouts/referrals/chart` returns `{ total, delta, chartAmount, chartCount }` | **Wrong** — see below |
| 25 endpoints with bare responses | Table has 25 rows; recommendation 3 below said 26. Not re-verified against the spec |

**New gap found:** `GET /api2/v2/users/me/referrals` is called by
`list_referrals` in `crm_api.py` (added in `a9abe0c`) but does **not** appear in
the OpenAPI spec, while its two siblings
(`/api2/v2/payouts/requests/referral`, `/api2/v2/payouts/referrals/chart`) do.
The passthrough surface is therefore missing one referral endpoint.

### Provenance of the two referral response shapes

The `{"referralEarnings": 0}` and `{"gross": 0, "total": 0}` bodies below were
observed by the operator against a live OnlyFans account. **They are not
reproducible from anything in this repository:** `tests/test_referrals.py` runs
with `handle_of_request` replaced by a stub and does zero network I/O, and its
fixtures are invented placeholders (`{'balance': 12.5}`, a one-element chart
array) chosen precisely because the real shapes were unknown. The string
`referralEarnings` appears nowhere in the tree. Treat the shapes as a field
report, and re-capture before anyone maps these fields into a typed client.

---

## Endpoints in OpenAPI Spec but MISSING from API Docs Page

> **RESOLVED (2026-08-05).** All 17 rows below now appear in
> `app/dashboard/api-docs/page.tsx` with a matching method and path. The section
> is kept for provenance; the tables no longer describe a gap.

These endpoints have full OpenAPI documentation but were **not listed** in the interactive api-docs playground:

### OF API — Content (Write Operations)
| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api2/v2/posts` | Create a new post (text, media, PPV, polls, scheduling) |
| ~~`POST`~~ | ~~`/api2/v2/media`~~ | **Withdrawn 2026-08-06 — endpoint does not exist** (OF returns 404; absent from both reverse passes). Removed from the spec and the playground. |
| `PUT` | `/api2/v2/vault/media/{media_id}/attach` | Attach vault media to post/message |
| `POST` | `/api2/v2/vault/lists/{list_id}/media` | Add media to vault list |
| `POST` | `/api2/v2/posts/{post_id}/vote` | Vote on a post poll |
| `POST` | `/api2/v2/posts/pinned/sort` | Reorder pinned posts |
| `POST` | `/api2/v2/posts/stats-collect` | Report post view/interaction stats |

### OF API — Messaging (Write Operations)
| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api2/v2/messages/queue` | Create a mass message |
| `POST` | `/api2/v2/messages/queue/size` | Calculate mass message audience size |
| `POST` | `/api2/v2/messages/{message_id}/like` | Like / react to a message |

### OF API — Subscriptions
| Method | Path | Description |
|--------|------|-------------|
| `PUT` | `/api2/v2/subscriptions/{subscription_id}/discount` | Apply subscription discount |

### OF API — User
| Method | Path | Description |
|--------|------|-------------|
| `PATCH` | `/api2/v2/users/me` | Update user profile (detailed: displayName, about, tips, etc.) |

### OF API — Stories (Write Operations)
| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api2/v2/users/me/stories` | Create a new story |
| `POST` | `/api2/v2/stories/highlights` | Create a story highlight |

### OF API — Streams (Write/Action Operations)
| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api2/v2/streams` | Create / start a live stream |
| `POST` | `/api2/v2/streams/{stream_id}/vote` | Vote on a stream poll |
| `POST` | `/api2/v2/streams/{stream_id}/kick` | Kick a user from stream |

**Total: 17 endpoints** (this line previously read "18"; the tables above have
only ever contained 17 rows — 7 Content + 3 Messaging + 1 Subscriptions + 1 User
+ 2 Stories + 3 Streams). All 17 are now in the playground.

---

## Endpoints in API Docs Page but MISSING from OpenAPI Spec

*None found — all api-docs endpoints are covered in the OpenAPI spec.*

---

## Backend Endpoints Missing from Both Documentation Sources

These exist in `crm_api.py` but are **not documented anywhere**:

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/auth/register` | Register a new CRM user account |
| `POST` | `/api/auth/login` | Login to CRM panel (get API key) |
| `POST` | `/api/crm/register` | Create a new CRM panel |

---

## Endpoints with No Request Body Schema

These POST/PUT/DELETE endpoints exist but have **no body documented** (they are likely empty-body actions):

| Method | Path | Notes |
|--------|------|-------|
| `POST` | `/api2/v2/users/{user_id}/block` | No body needed |
| `POST` | `/api2/v2/users/{user_id}/restrict` | No body needed |
| `POST` | `/api2/v2/chats/{user_id}/mark-as-read` | No body needed |
| `POST` | `/api2/v2/users/notifications/read` | No body needed |
| `POST` | `/api2/v2/users/{user_id}/subscribe` | No body/payment info documented |
| `DELETE` | `/api2/v2/users/{user_id}/unsubscribe` | No body needed |
| `POST` | `/api2/v2/trials` | No creation body documented |

---

## Response Schema Coverage

### GET endpoints — all have full response schemas (49 fixed):
- `GET /users/me` — `OFUserProfile` schema
- `GET /users/me/settings` — `OFUserSettings` schema
- `GET /users/{user_id}` — `OFUserProfile` schema
- `GET /users/{user_id}/stat` — `OFUserStat` schema
- `GET /users/blocked` — paginated `OFUserProfile` list
- `GET /users/me/profile/views/qr` — `{ url }` schema
- `GET /subscriptions/subscribers/count` — `{ count }` schema
- `GET /subscriptions/subscribers/recent-expired` — paginated user list
- `GET /subscriptions/subscribers/awards` — paginated user list
- `GET /subscriptions/subscribers/awards/count` — `{ count }` schema
- `GET /subscriptions/subscribes` — paginated user list
- `GET /subscriptions/subscribes/count` — `{ count }` schema
- `GET /subscriptions/{id}/history` — paginated list
- `GET /chats` — paginated `OFChat` list
- `GET /chats/{user_id}/messages/search` — paginated `OFMessage` list
- `GET /messages/templates` — array of `OFMessageTemplate`
- `GET /posts/{post_id}` — `OFPost` schema
- `GET /posts/{post_id}/comments` — paginated comments with author
- `GET /posts/bookmarks` — paginated `OFPost` list
- `GET /posts/bookmarks/categories` — array of `OFBookmarkCategory`
- `GET /labels` — paginated `OFLabel` list
- `GET /vault/lists` — paginated `OFVaultList` list
- `GET /vault/media` — paginated `OFMedia` list
- `GET /schedules` — paginated `OFPost` list
- `GET /schedules/counters` — `{ count }` schema
- `GET /users/{user_id}/stories` — array of `OFStory`
- `GET /users/{user_id}/stories/highlights` — array of highlight objects
- `GET /stories/archive` — array of `OFStory`
- `GET /streams/active` — array of `OFStream`
- `GET /streams/{stream_id}/viewers` — paginated user list
- `GET /streams/{stream_id}/stats` — `{ viewersCount, likesCount, tipsAmount, commentsCount }`
- `GET /streams/feed` — paginated `OFStream` list
- `GET /campaigns` — paginated `OFCampaign` list *(fixed)*
- `GET /campaigns/{id}/claimers` — paginated user list
- `GET /earnings/chart` — `{ total: { total, gross, chartAmount, chartCount } }` *(fixed)*
- `GET /payouts/balances` — `{ current, pending, total }`
- `GET /payouts/transactions` — paginated list with marker pagination
- `GET /payouts/requests` — list with state/amount/rejectReason
- `GET /payouts/requests/referral` — paginated referral payout list with marker *(new)*
- `GET /payouts/chargebacks` — paginated chargeback list with marker *(new)*
- `GET /payouts/chargebacks/ratio` — `{ chargebacksRatio }` *(new)*
- `GET /payouts/chargebacks/chart` — `{ total, delta, chartAmount, chartCount }` *(new)*
- `GET /payouts/referrals/chart` — ⚠️ **spec is wrong.** A live account returned
  `{"gross": 0, "total": 0}`. The spec at
  `app/api/openapi.json/route.ts` still declares
  `{ total, delta, chartAmount, chartCount }` — so `gross` is undocumented and
  `delta` / `chartAmount` / `chartCount` were never observed. Note this also
  contradicts the browser capture the spec was written from
- `GET /payouts/account` — `{ type, isVerified }`
- `GET /payments/all/transactions` — paginated list
- `GET /payments/referrals/balance` — ⚠️ **spec is wrong, and the endpoint is
  NOT retired.** A live account returned HTTP 200 with
  `{"referralEarnings": 0}`. The spec declares `{ balance }`; the real field is
  `referralEarnings`. This matters beyond a rename: `tests/test_referrals.py`
  (`s15_earnings_tolerates_one_dead_source`) and the route docstring both treat
  this endpoint as possibly-retired because it appears in no capture. It exists
- `GET /users/notifications` — paginated list
- `GET /users/notifications/count` — `{ count }`
- `GET /promotions` — paginated `OFPromotion` list
- `GET /promotions/offers` — array of `OFPromotion`
- `GET /trials` — paginated `OFTrial` list
- `GET /helpers` — array of `OFHelper`
- `GET /helpers/permissions` — permissions config object
- `GET /init` — `OFInitPayload` schema
- `GET /lists` — paginated `OFList` list
- `GET /lists/{id}/users` — paginated user list

### Write-operation endpoints with full response schemas:
- `POST /posts` — `OFPost` schema
- `POST /media` — `OFMedia` schema
- `POST /chats/{user_id}/messages` — `OFMessage` schema
- `POST /messages/queue` — `OFMessage` schema
- `POST /users/me/stories` — `OFStory` schema
- `POST /streams` — `OFStream` schema
- `POST /campaigns` — `OFCampaign` schema *(fixed)*

### Endpoints still with bare responses (25 total):

These are mostly simple action endpoints that return a confirmation or the modified object — would need live API response capture to fill in properly.

| Method | Path | Current response |
|--------|------|-----------------|
| `PATCH` | `/api2/v2/users/me` | "Updated profile" |
| `POST` | `/api2/v2/users/{user_id}/block` | "User blocked" |
| `DELETE` | `/api2/v2/users/{user_id}/block` | "User unblocked" |
| `POST` | `/api2/v2/users/{user_id}/restrict` | "User restricted" |
| `GET` | `/api2/v2/subscriptions/subscribers` | "Subscriber list" |
| `PUT` | `/api2/v2/subscriptions/{id}/discount` | "Discount applied" |
| `POST` | `/api2/v2/users/{user_id}/subscribe` | "Subscribed" |
| `DELETE` | `/api2/v2/users/{user_id}/unsubscribe` | "Unsubscribed" |
| `POST` | `/api2/v2/chats/{user_id}/mark-as-read` | "Marked as read" |
| `POST` | `/api2/v2/messages/{message_id}/like` | "Message liked" |
| `POST` | `/api2/v2/posts/{post_id}/favorites` | "Post liked" |
| `POST` | `/api2/v2/posts/{post_id}/vote` | "Vote recorded" |
| `POST` | `/api2/v2/posts/pinned/sort` | "Pin order updated" |
| `POST` | `/api2/v2/posts/stats-collect` | "Stats collected" |
| `PUT` | `/api2/v2/vault/media/{media_id}/attach` | "Media attached" |
| `POST` | `/api2/v2/vault/lists/{list_id}/media` | "Media added to list" |
| `POST` | `/api2/v2/stories/highlights` | "Highlight created" |
| `POST` | `/api2/v2/streams/{stream_id}/vote` | "Vote recorded" |
| `POST` | `/api2/v2/streams/{stream_id}/kick` | "User kicked" |
| `POST` | `/api2/v2/payouts/requests` | "Payout requested" |
| `POST` | `/api2/v2/users/notifications/read` | "Marked as read" |
| `POST` | `/api2/v2/lists` | "List created" |
| `POST` | `/api2/v2/lists/{list_id}/users/{user_id}` | "User added" |
| `DELETE` | `/api2/v2/lists/{list_id}/users/{user_id}` | "User removed" |
| `POST` | `/api2/v2/trials` | "Trial created" |

### Reusable component schemas (15):
- `OFUserProfile` — id, name, username, displayName, avatar, avatarThumbs, isVerified, isPerformer, subscribersCount, postsCount, etc.
- `OFUserSettings` — needUpdateBanking, canReceiveManualPayout, isVerifiedReason, needVerifyPayoutData
- `OFUserStat` — earnings, revenue, views, purchases, tips, comments, likes
- `OFChat` — id, withUser, lastMessage, unreadMessagesCount
- `OFMessageTemplate` — id, name, content, createdAt, updatedAt
- `OFVaultList` — id, name, mediaCount
- `OFLabel` — id, name, postsCount, type
- `OFList` — id, name, type, postsCount, usersCount, customOrderEnabled
- `OFPromotion` — id, code, isFinished, sharedWith
- `OFTrial` — id, code, isFinished, sharedWith
- `OFHelper` — userId, user (OFUserProfile ref)
- `OFBookmarkCategory` — id, name
- `OFInitPayload` — user, chatMessagesCount, countPriorityChat, etc.
- `OFCampaign` — id, campaignName, campaignCode, countTransitions, countSubscribers, createdAt, sharedWith
- `PaginatedList` — generic `{ list, hasMore }` wrapper

---

## Summary

Counts re-verified 2026-08-05 at commit `55d99aa`.

| Category | Count |
|----------|-------|
| Endpoints in OpenAPI but missing from api-docs page | ~~18~~ → **0** (the tables held 17, not 18; all 17 now in the playground) |
| Endpoints in api-docs but missing from OpenAPI | **0** (not re-verified) |
| Backend endpoints missing from all docs | ~~3~~ → **0 in OpenAPI, 3 still missing from the playground** |
| Passthrough endpoints called by a route but absent from the spec | **1** (`GET /api2/v2/users/me/referrals`) |
| Response schemas contradicted by a live capture | **2** (both referral endpoints) |
| Endpoints with no request body schema | **7** (empty-body actions, not re-verified) |
| GET endpoints with no response schema | ~~49~~ → **0** (all fixed) |
| Endpoints with bare response schema | **25** (table has 25 rows; recommendation 3 previously said 26) |
| Reusable component schemas | **15** (not re-verified) |

### Remaining Recommendations

1. ~~**High**: Add the 18 missing write-operation endpoints to the api-docs playground~~ — **done**; all 17 verified present.
2. **High**: Correct the two referral response schemas in `app/api/openapi.json/route.ts`. `/payments/referrals/balance` returns `referralEarnings`, not `balance`; `/payouts/referrals/chart` returns `{gross, total}`, not `{total, delta, chartAmount, chartCount}`. Both are currently documented as shapes that a live account does not return.
3. **Medium**: Add the 3 auth/registration endpoints to the api-docs playground — they reached the OpenAPI spec but not the playground, so the two surfaces now disagree.
4. **Medium**: Document `GET /api2/v2/users/me/referrals` in the passthrough surface; `crm_api.list_referrals` already calls it.
5. **Medium**: Add response schemas for the 25 write-operation endpoints that still have bare descriptions (requires live API response capture).
6. **Low**: Add request body schemas for the 7 POST/DELETE endpoints that are simple empty-body actions (block, restrict, mark-as-read, etc.)
