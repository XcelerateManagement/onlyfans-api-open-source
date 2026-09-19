#!/usr/bin/env python3
"""Per-platform feature capability matrix.

Single source of truth for "what can this platform actually do". Drives both
backend route gating (return a clean 501 instead of guessing at an endpoint
that doesn't exist) and the frontend (hide/disable tabs the platform can't
serve). Exposed to the dashboard via the account payload's ``capabilities``.

Why a matrix and not just try/except: some OnlyFans features have NO Fansly
equivalent at all (e.g. the raw /api2/v2 passthrough, or writes this API never
sends to Fansly). Pretending otherwise produces confusing dead UI. The matrix
lets us say "not available on Fansly yet" honestly.

Status legend per feature:
    True   — supported and wired
    False  — no equivalent / blocked on this platform (route returns 501)
"""

import config

PLATFORM_OF = 'onlyfans'
PLATFORM_FANSLY = 'fansly'

# Feature keys are stable identifiers shared with the frontend capability gate.
FEATURES = (
    'profile',          # GET /account/me  vs /users/me
    'balances',         # wallet/earnings balance figures
    'earnings',         # earnings chart/series
    'transactions',     # money ledger (purchases/tips)
    'transactions_refresh',  # sync the ledger into transactions_cache on demand
    'backfill',         # one-shot "catch up history" sync bundle
    'subscribers',      # enumerate the creator's subscribers/fans
    'chats',            # conversation list
    'messages',         # messages within a conversation
    'send_message',     # send a DM
    'media_upload',     # POST /accounts/<id>/media — upload a file to OF
    'send_attachments', # attach media to an outgoing DM (composer wiring)
    'campaigns',        # OF campaigns / Fansly tracking links (read/list)
    'campaigns_create', # create a new campaign/tracking link (write)
    'notifications',    # REST notifications feed
    'websocket',        # real-time event socket
    'polling',          # background poller support
    'payouts',          # payout account/method + payout history (read)
    'payouts_request',  # create a withdrawal request (write)
    'subscription_price',        # read the creator's subscription price
    'subscription_price_update', # change the subscription price (write)
    'ppv_stats',        # PPV conversion stats (needs purchase state on messages)
    'referrals',        # referral program: referred-user list, balance, chart, payouts
)

# Default everything to True for OF (its routes are the reference implementation),
# then state Fansly's reality explicitly.
_OF = {f: True for f in FEATURES}
# Uploading IS supported on OnlyFans: of_upload.py drives the real signed-S3 +
# converter pipeline behind POST /accounts/<id>/media, and the result attaches
# to a post via `mediaFiles` (verified live 2026-08-06).
_OF['media_upload'] = True

# `send_attachments` is narrower and stays False: it tracks the DM composer,
# which still forwards filename strings and has not been rewired to carry an
# uploaded media reference. A "send with attachment" would silently drop the
# media (a fan could be charged for a PPV containing nothing). Flip it only
# once the composer passes `of_upload.media_reference()` through to mediaFiles.
# Do NOT read this flag as "media upload unavailable" — that is `media_upload`.
_OF['send_attachments'] = False

_FANSLY = {
    'profile': True,         # GET /api/v1/account/me
    'balances': True,        # GET /api/v1/account/wallets/earnings
    'earnings': True,        # balance + daily series bucketed from the cached ledger
    'transactions': True,    # GET /api/v1/account/wallets/transactions
    'transactions_refresh': True,  # fansly_sync walks the wallet ledger into transactions_cache
    'backfill': True,        # full wallet-tx walk + harvest_fans (fansly_sync)
    # GET /api/v1/subscribers works (live-proven; the old "403-blocked"
    # assumption was wrong) — rows carry lifecycle/pricing, identities come
    # from a batched GET /api/v1/account?ids= hydration call.
    'subscribers': True,
    'chats': True,           # GET /api/v1/messages (conversation list)
    'messages': True,        # GET /api/v1/message?groupId=
    'send_message': True,    # POST /api/v1/message
    'media_upload': False,      # Fansly upload pipeline is not reversed/wired
    'send_attachments': False,  # no upload pipeline (see _OF note)
    'campaigns': True,       # GET /api/v1/trackinglinks (confirmed live) — read-only
    'campaigns_create': False,  # creating tracking links would be a POST — never sent to Fansly
    'notifications': True,   # GET /api/v1/notifications (confirmed live)
    # Static False: the Fansly WS listener does not run unless FANSLY_WS_ENABLED
    # is set. capabilities() computes the live value from the flag so enabling
    # the validated listener flips this back honestly.
    'websocket': False,
    'polling': True,         # AND-gated with FANSLY_POLLING_ENABLED in capabilities()
    # Read side only: GET /api/v1/payments/payoutmethods (methods) + the
    # earnings wallet (available balance) + payout history from the synced
    # wallet ledger (tx type 16012 rows in transactions_cache).
    'payouts': True,
    'payouts_request': False,  # withdrawal requests would be a POST — never sent to Fansly
    # Read side only: subscriptionTiers[].plans[] from GET /api/v1/account/me.
    'subscription_price': True,
    'subscription_price_update': False,  # price change would be a POST — never sent to Fansly
    'ppv_stats': False,      # Fansly message rows carry no purchase state
    # No Fansly referral surface is known to this client: nothing in
    # fansly_data/fansly_client reads referrals, there is no reversed /api/v1
    # analogue of OF's /users/me/referrals, /payouts/requests/referral or
    # /payouts/referrals/chart, and the synced wallet ledger carries no
    # referral tx type we could bucket instead. Guessing an endpoint would
    # dead-end in a 404 dressed up as an empty referral list, which reads as
    # "you have no referrals" — worse than an honest "not available yet".
    'referrals': False,
}

PLATFORM_FEATURES = {
    PLATFORM_OF: _OF,
    PLATFORM_FANSLY: _FANSLY,
}


def normalize_platform(platform):
    """Coerce a possibly-missing/odd platform value to a known one."""
    p = (platform or PLATFORM_OF)
    if isinstance(p, str):
        p = p.strip().lower()
    return p if p in PLATFORM_FEATURES else PLATFORM_OF


def supports(platform, feature):
    """True if ``platform`` supports ``feature``. Unknown feature → False."""
    return bool(capabilities(platform).get(feature, False))


def capabilities(platform):
    """Full capability dict for a platform — handed to the frontend so the UI
    can gate without hardcoding platform names.

    Fansly's real-time keys are computed from the deployment flags rather than
    hardcoded, so the advertised capabilities never claim an event source that
    the scheduler will never start (websocket) or a poller that no-ops
    (polling)."""
    p = normalize_platform(platform)
    caps = dict(PLATFORM_FEATURES.get(p, _OF))
    if p == PLATFORM_FANSLY:
        caps['websocket'] = bool(getattr(config, 'FANSLY_WS_ENABLED', False))
        caps['polling'] = bool(caps.get('polling')) and \
            bool(getattr(config, 'FANSLY_POLLING_ENABLED', False))
    return caps


def unsupported_response(feature, platform=PLATFORM_FANSLY):
    """Canonical (body, status) for a feature a platform can't serve. Routes
    return this so the frontend can show a consistent 'not available' state."""
    return {
        'success': False,
        'error': f'"{feature}" is not available for {normalize_platform(platform)} accounts yet.',
        'code': 'platform_not_supported',
        'platform': normalize_platform(platform),
        'feature': feature,
    }, 501
