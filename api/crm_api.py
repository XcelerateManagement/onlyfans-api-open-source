#!/usr/bin/env python3
"""
Secure multi-tenant Flask API for OnlyFans CRM panels.
Each CRM panel has isolated OnlyFans account sessions.
Features: rate limiting, CORS restrictions, input validation, security headers.
"""

import re
import html
import json
import logging
import os
import hmac
import uuid
from functools import wraps

# Without this the app has no logging config at all, so Python's last-resort
# handler drops everything below WARNING — which meant the background engine
# ran completely silently until something broke. Scheduler capacity checks,
# job-policy migrations and per-account sync results are all INFO, so an
# operator could not confirm the pollers were healthy, only notice when they
# weren't. LOG_LEVEL=DEBUG turns on the per-poll trace (see scheduler._run_poll).
logging.basicConfig(
    level=getattr(logging, os.environ.get('LOG_LEVEL', 'INFO').upper(), logging.INFO),
    format='%(asctime)s %(levelname)s %(name)s: %(message)s',
)
# APScheduler's own INFO chatter ("Added job ...", "Running job ...") is one
# line per job per fire — at hundreds of accounts that buries our own logs.
logging.getLogger('apscheduler').setLevel(logging.WARNING)
from flask import Flask, request, jsonify, g, Response, stream_with_context, send_file, after_this_request
from flask_cors import CORS
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address
import config
import crm_database as db
import multi_tenant_auth as mt_auth
import login as login_module
from header_generator import generate_headers
import captcha_solver
from account_access import check_account_ownership
from of_client import handle_of_request, attempt_relogin, is_access_denied
import of_client as of_client_module
import of_faceid
import fansly_login
import fansly_auth
import fansly_data
import fansly_sync
import fansly_wallet
import secret_storage
import platform_features as pf
from outbound_guard import is_safe_outbound_url
import of_upload
import subscribers_sync
import transactions_sync
import campaigns_sync
import refresh_state
import scheduler as scheduler_mod
import account_status
import runtime_readiness
import threading
import geo as geo_mod
from oauth_routes import oauth_bp

_migrated_sessions, _failed_session_migrations = (
    secret_storage.migrate_legacy_session_tree()
)
if _migrated_sessions:
    logging.info('Encrypted %s legacy session file(s) at rest', _migrated_sessions)
if _failed_session_migrations:
    logging.warning(
        'Could not migrate %s legacy session file(s); filenames withheld',
        _failed_session_migrations,
    )

app = Flask(__name__)
# OAuth 2.1 authorization server endpoints (/.well-known/*, /oauth/*).
# Mounted here so the same Flask instance speaks both X-API-Key (legacy
# CRM API) and OAuth (used by the MCP server to authenticate MCP clients
# like ChatGPT / Claude.ai).
app.register_blueprint(oauth_bp)

# Configure CORS with specific origins
CORS(app, resources={
    r"/api/*": {
        "origins": config.CORS_ORIGINS,
        "methods": ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
        "allow_headers": ["Content-Type", "X-API-Key", "X-Proxy", "Authorization"],
        "supports_credentials": True
    },
    r"/health": {
        "origins": "*",
        "methods": ["GET"]
    }
})

# Configure rate limiting
limiter = Limiter(
    app=app,
    key_func=lambda: request.headers.get("X-API-Key") or get_remote_address(),
    default_limits=[config.RATE_LIMIT_DEFAULT],
    storage_uri="memory://",  # Use Redis in production: "redis://localhost:6379"
    strategy="fixed-window",
    headers_enabled=True,
)

# {api_key: (exempt_bool, ts)} — TTL cache so the exemption lookup doesn't
# add a SQLite hit to every request. A toggle takes ≤TTL to propagate.
_rate_exempt_cache = {}
_RATE_EXEMPT_TTL = 30  # seconds


@limiter.request_filter
def _rate_limit_exempt_tenant():
    """Skip ALL flask-limiter caps (default + per-route) for panels flagged
    crm_panels.rate_limit_exempt=1. Anonymous traffic is never exempt."""
    api_key = request.headers.get("X-API-Key")
    if not api_key:
        return False
    import time as _time
    now = _time.time()
    cached = _rate_exempt_cache.get(api_key)
    if cached and (now - cached[1]) < _RATE_EXEMPT_TTL:
        return cached[0]
    exempt = db.is_rate_limit_exempt_key(api_key)
    if len(_rate_exempt_cache) > 10000:  # junk-key flood guard
        _rate_exempt_cache.clear()
    _rate_exempt_cache[api_key] = (exempt, now)
    return exempt

# ---- request-outcome metrics ------------------------------------------------
#
# These two hooks are how we learn whether the API is actually working. Without
# them nothing in the system could distinguish a 500 from a 200, and latency was
# never recorded at all.
#
# Registered here, above our other hooks, on purpose: Flask runs after_request
# handlers in REVERSE registration order, so registering first means running
# last — the timer therefore covers add_security_headers and the AI-shield body
# rewrite too, i.e. essentially the whole time the process owns the request.
# (CORS() and Limiter() register their own header hooks at extension-init above
# this, so those two trailing header writes fall outside the window.)
#
# An after_request hook also fires for EVERY request regardless of decorators,
# blueprints, auth outcome or 404, so observation coverage is 100% without
# touching a single route.
import time as _metrics_time
import api_metrics
import api_errors
import login_attempts
import ops_alerts

# Interval (seconds) used when polling is auto-enabled for a paid-plan account
# on connect. Sourced from config when present, else env, else 5 minutes — kept
# defensive so it works on deployments whose config build predates the constant.
PAID_POLL_INTERVAL = int(os.environ.get(
    'DEFAULT_PAID_POLL_INTERVAL', getattr(config, 'DEFAULT_PAID_POLL_INTERVAL', 300)))


@app.before_request
def _metrics_start_timer():
    try:
        g._metrics_t0 = _metrics_time.perf_counter()
    except Exception:
        pass


def _metrics_observe(status_code, response=None):
    """Fold the finished request into the in-process accumulator. Fail-open.

    Idempotent per request: the `_metrics_done` flag is what stops the teardown
    backstop from double-counting a request after_request already handled.
    """
    try:
        if g.get('_metrics_done'):
            return
        t0 = g.get('_metrics_t0')
        latency_ms = (_metrics_time.perf_counter() - t0) * 1000.0 if t0 else 0
        api_metrics.record(
            route=request.url_rule.rule if request.url_rule else None,
            method=request.method,
            status_code=status_code,
            latency_ms=latency_ms,
            # Authenticated tenant, NOT request.view_args['crm_id'] — the URL
            # value is attacker-controlled, so attributing on it would let
            # anyone inflate another panel's error rate. Unauthenticated and
            # failed-auth traffic lands under '' ("anonymous"), which is
            # exactly where a 401 storm belongs.
            crm_id=g.get('metrics_crm_id'),
        )
        g._metrics_done = True
    except Exception:
        pass

    # Aggregates say HOW MANY failed; they cannot say WHAT happened, because
    # api_metrics stores counters. Failures additionally get their body kept so
    # an operator can read the actual error and send it to us.
    try:
        if status_code < 400:
            return
        body_text = ''
        if response is not None:
            # NEVER touch a streamed response: get_data() on SSE would consume
            # the generator and hang the client forever. Those are exactly the
            # long-lived connections excluded from metrics too.
            if not (response.direct_passthrough or response.is_streamed):
                try:
                    body_text = response.get_data(as_text=True)
                except Exception:
                    body_text = ''
        t0 = g.get('_metrics_t0')
        # Attribute by the API KEY, not by the crm_id in the URL.
        #
        # g.metrics_crm_id is set inside verify_api_key(), which most routes
        # call in the handler body — but @check_account_ownership is the
        # INNERMOST decorator and therefore runs first, so its 403 lands here
        # with nothing set and the panel never sees its own error. Falling back
        # to the presented key fixes that without trusting the URL: a caller can
        # only write into the log of a panel whose key they already hold.
        owner = g.get('metrics_crm_id')
        if not owner:
            try:
                _k = request.headers.get('X-API-Key')
                owner = (db.find_crm_by_api_key(_k) or {}).get('crm_id') if _k else None
            except Exception:
                owner = None
        api_errors.record(
            crm_id=owner or '',
            route=request.url_rule.rule if request.url_rule else request.path,
            method=request.method,
            path=request.path,
            status_code=status_code,
            latency_ms=(_metrics_time.perf_counter() - t0) * 1000.0 if t0 else 0,
            body_text=body_text,
            of_user_id=(request.view_args or {}).get('of_user_id'),
        )
    except Exception:
        pass


@app.after_request
def _metrics_after_request(response):
    _metrics_observe(response.status_code, response)
    return response


@app.teardown_request
def _metrics_teardown(exc):
    """Backstop for the path after_request cannot cover.

    Flask skips after_request when an exception escapes response finalisation
    (the @app.errorhandler(Exception) above normally converts a raising handler
    into a 500 that DOES flow through after_request — this catches the case
    where the error handler itself blows up). Without it, the requests we most
    want to see would be the only ones missing.
    """
    if exc is not None:
        _metrics_observe(500)


# Add security headers to all responses
@app.after_request
def add_security_headers(response):
    """Add security headers to all responses."""
    for header, value in config.SECURITY_HEADERS.items():
        response.headers[header] = value
    if not response.headers.get("Cache-Control"):
        response.headers["Cache-Control"] = "no-store"
    return response


# ---- global error handler ---------------------------------------------------
#
# Any uncaught exception is converted to a generic 500 with a short correlation
# id; the full traceback is logged server-side only. This stops library
# exception messages (SQL fragments, file paths, the user:pass@ portion of a
# proxy URL, OF session tokens, etc.) from being reflected to the caller.
# Per-route handlers should ``raise`` rather than reflecting ``str(e)`` to the
# client — the global handler will format the response with a correlation id.

import secrets as _err_secrets
import traceback as _err_tb
import logging as _err_logging
from werkzeug.exceptions import HTTPException as _WerkzeugHTTPException

_err_logger = _err_logging.getLogger(__name__)


@app.errorhandler(Exception)
def _handle_uncaught(exc):
    # Let normal HTTP exceptions (404, 405, abort()) pass through unchanged so
    # we don't accidentally turn a 404 into a 500.
    if isinstance(exc, _WerkzeugHTTPException):
        return exc

    correlation = _err_secrets.token_hex(8)
    _err_logger.error(
        '[%s] uncaught exception in %s %s: %s\n%s',
        correlation,
        request.method,
        request.path,
        exc,
        _err_tb.format_exc(),
    )
    return jsonify({
        'error': 'Internal server error',
        'correlation_id': correlation,
    }), 500


# Input validation functions
class ValidationError(Exception):
    """Custom validation error."""
    pass


def validate_email(email):
    """Validate email format."""
    if not email or not isinstance(email, str):
        raise ValidationError("Email is required")
    email = email.strip().lower()
    pattern = r'^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$'
    if not re.match(pattern, email):
        raise ValidationError("Invalid email format")
    if len(email) > 254:
        raise ValidationError("Email too long")
    return email


# Short embedded list of obviously-weak passwords. Not exhaustive — the goal
# is to block the no-brainers that show up first in any credential-stuffing
# list. Add to it if you see real breaches; don't try to maintain a 10k+ list
# here (use a dedicated package like pwdlib if you want that).
_COMMON_PASSWORDS = frozenset({
    'password', 'password1', 'password123', 'passw0rd', 'p@ssw0rd', 'p@ssword',
    '12345678', '123456789', '1234567890', 'qwerty123', 'qwertyuiop',
    'iloveyou', 'admin123', 'administrator', 'welcome123', 'letmein123',
    '11111111', 'abcd1234', 'abcdef12', 'baseball1', 'football1',
    'sunshine1', 'princess1', 'monkey123', 'dragon123', 'master123',
    'pass1234', 'qwerty1234', 'asdfghjkl', '1q2w3e4r5t', 'changeme',
    'changeme123', 'temppass1', 'welcome01',
})


def validate_password(password):
    """Validate password strength."""
    if not password or not isinstance(password, str):
        raise ValidationError("Password is required")
    if len(password) < 8:
        raise ValidationError("Password must be at least 8 characters")
    if len(password) > 128:
        raise ValidationError("Password too long")
    if password.lower() in _COMMON_PASSWORDS:
        raise ValidationError("This password is too common. Pick something less guessable.")
    return password


def validate_credential_password(password):
    """Bounds-check a credential we PASS THROUGH to OnlyFans/Fansly.

    Use this — never ``validate_password`` above — for a password that belongs
    to somebody else's platform account. ``validate_password`` enforces >= 8
    characters and rejects a list of common passwords, which is exactly right
    for a password we are SETTING on our own system and exactly wrong for one
    we are merely forwarding: a creator whose OnlyFans password is `hunter2`
    still has a real account, and refusing to import it improves nobody's
    security while silently losing the row.

    Type and length only. The implementation lives in ``import_parser`` so the
    parser (which must never import this module) and the routes cannot drift.
    """
    import import_parser
    error = import_parser.check_credential_password(password)
    if error:
        raise ValidationError(error)
    return password


def validate_proxy(proxy):
    """Validate and normalize proxy URL format.

    Accepts:
      - http://user:pass@host:port (standard)
      - socks5://user:pass@host:port and socks5h://... (SOCKS5; the `h`
        variant resolves DNS on the proxy side)
      - host:port:user:pass (compact, auto-converted to http). Passwords may
        contain `:` — we split on the first three colons only, so a
        password like ``my:pass:word`` round-trips correctly.
      - http://host:port (no auth)

    Returns a fully URL-encoded scheme://user:pass@host:port string so that
    user/pass with reserved characters (``@/:?#%``) don't poison ``urlparse``
    downstream. ``curl_cffi`` and ``requests`` both happily consume the
    percent-encoded form.
    """
    if not proxy:
        return None
    if not isinstance(proxy, str):
        raise ValidationError("Proxy must be a string")
    proxy = proxy.strip()

    # Auto-convert compact format. Split on the first three colons only —
    # marsproxies / oxylabs / smartproxy commonly issue passwords containing
    # colons, and a naive count==3 check rejects them. Anything with a
    # scheme separator is already URL-form and must not be re-split (a
    # socks5://user:pass@host:port URL also contains 3+ colons).
    if '://' not in proxy and proxy.count(':') >= 3:
        parts = proxy.split(':', 3)
        if len(parts) == 4:
            host, port, user, passwd = parts
            if not port.isdigit():
                raise ValidationError("Invalid proxy format. Use http://user:pass@host:port, socks5://user:pass@host:port, or host:port:user:pass")
            from urllib.parse import quote as _q
            proxy = f'http://{_q(user, safe="")}:{_q(passwd, safe="")}@{host}:{port}'

    # If it's a standard scheme://...@host:port URL but the user/pass
    # contains raw reserved chars (`@`, `:`, `/`, `#`, `%`, etc.), urlparse
    # will misread it. Re-encode the userinfo if it's still raw.
    if proxy.startswith(('http://', 'https://', 'socks5://', 'socks5h://')):
        scheme_end = proxy.index('://') + 3
        rest = proxy[scheme_end:]
        if '@' in rest:
            # Find the LAST '@' so passwords containing '@' don't fool us.
            at = rest.rfind('@')
            userinfo = rest[:at]
            hostpart = rest[at + 1:]
            if ':' in userinfo:
                user, passwd = userinfo.split(':', 1)
                from urllib.parse import quote as _q, unquote as _uq
                # quote() leaves already-encoded sequences alone if we unquote
                # first; that way idempotent calls don't double-encode.
                user_enc = _q(_uq(user), safe='')
                passwd_enc = _q(_uq(passwd), safe='')
                proxy = f'{proxy[:scheme_end]}{user_enc}:{passwd_enc}@{hostpart}'

    # Validate standard format. Hostname pattern is forgiving (letters,
    # digits, dot, dash, underscore) and port must be 1-5 digits.
    pattern_no_auth = r'^(?:https?|socks5h?)://[A-Za-z0-9._\-]+:\d{1,5}$'
    pattern_auth = r'^(?:https?|socks5h?)://[^/@]+@[A-Za-z0-9._\-]+:\d{1,5}$'
    if not re.match(pattern_no_auth, proxy) and not re.match(pattern_auth, proxy):
        raise ValidationError("Invalid proxy format. Use http://user:pass@host:port, socks5://user:pass@host:port, or host:port:user:pass")

    # Operator-declared local endpoints (a reverse SSH tunnel landing someone's
    # own connection on this box) are exempt — that is the whole point of the
    # allowlist, and it is empty unless a human set PROXY_ALLOW_ENDPOINTS.
    # Matched on the exact host:port, so declaring the tunnel does not open
    # loopback generally.
    if config.PROXY_ALLOW_ENDPOINTS:
        from urllib.parse import urlparse as _urlparse
        _p = _urlparse(proxy)
        if _p.hostname and _p.port and \
                f'{_p.hostname}:{_p.port}' in config.PROXY_ALLOW_ENDPOINTS:
            return proxy

    # SSRF guard — the saved proxy is used by curl-cffi to issue outbound OF
    # requests, so a tenant who sets proxy=http://127.0.0.1:6379 or the AWS
    # metadata 169.254.169.254 IP would have this server tunnel arbitrary
    # traffic through it. is_safe_outbound_url uses urlparse + getaddrinfo,
    # so it sees the final (encoded) host correctly.
    safe, reason = is_safe_outbound_url(
        proxy, allowed_schemes=('http', 'https', 'socks5', 'socks5h')
    )
    if not safe:
        raise ValidationError(f"Proxy address not allowed: {reason}")
    return proxy


def validate_crm_id(crm_id):
    """Validate CRM ID format."""
    if not crm_id or not isinstance(crm_id, str):
        raise ValidationError("CRM ID is required")
    pattern = r'^crm_[a-f0-9]{16}$'
    if not re.match(pattern, crm_id):
        raise ValidationError("Invalid CRM ID format")
    return crm_id


def validate_of_user_id(user_id):
    """Validate OnlyFans user ID format."""
    if not user_id or not isinstance(user_id, str):
        raise ValidationError("User ID is required")
    if not user_id.isdigit():
        raise ValidationError("Invalid user ID format")
    return user_id


def sanitize_string(value, max_length=255, allow_empty=False):
    """Sanitize a string input."""
    if value is None:
        if allow_empty:
            return None
        raise ValidationError("Value is required")
    if not isinstance(value, str):
        raise ValidationError("Value must be a string")
    value = value.strip()
    if not value and not allow_empty:
        raise ValidationError("Value cannot be empty")
    if len(value) > max_length:
        raise ValidationError(f"Value too long (max {max_length} characters)")
    # Escape HTML to prevent XSS
    return html.escape(value)


def validate_numeric_param(value, param_name, min_val=None, max_val=None, default=None):
    """Validate and convert numeric query parameter."""
    if value is None:
        return default
    try:
        num = int(value)
    except (ValueError, TypeError):
        raise ValidationError(f"{param_name} must be a number")
    
    if min_val is not None and num < min_val:
        raise ValidationError(f"{param_name} must be at least {min_val}")
    if max_val is not None and num > max_val:
        raise ValidationError(f"{param_name} must be at most {max_val}")
    return num


# Error handlers
@app.errorhandler(ValidationError)
def handle_validation_error(e):
    """Handle validation errors."""
    return jsonify({'error': str(e)}), 400


@app.errorhandler(429)
def handle_rate_limit(e):
    """Handle rate limit exceeded."""
    return jsonify({
        'error': 'Rate limit exceeded',
        'retry_after': e.description
    }), 429


def verify_api_key():
    """Verify the caller for a per-CRM route.

    Two acceptable authentication paths:

    1. ``X-API-Key`` (legacy) — the dashboard and direct API consumers
       send the panel's API key. The key must match the ``crm_id``
       captured from the URL via ``view_args``.

    2. ``X-Service-Token`` + ``X-Acting-Crm-Id`` (inter-service
       impersonation) — used by the hosted MCP server after it has
       verified an OAuth 2.1 JWT issued by /oauth/token. The MCP
       server cannot forward the JWT directly because Flask routes
       use ``X-API-Key`` semantics, so we let it impersonate by
       presenting the inter-service shared secret plus the target
       ``crm_id``.

    The impersonation header pair is fail-closed: missing or wrong
    token → reject. We deliberately do **not** fall back to the
    API-key path when impersonation is half-attempted, to avoid
    confusing-deputy bugs.
    """
    import hmac as _hmac
    import os as _os

    svc_token = request.headers.get('X-Service-Token')
    acting = request.headers.get('X-Acting-Crm-Id')
    crm_id = request.view_args.get('crm_id')

    if svc_token or acting:
        expected_svc = _os.environ.get('INTER_SERVICE_TOKEN', '')
        if not expected_svc:
            return None, {'error': 'Inter-service auth not configured'}, 401
        if not svc_token or not acting:
            return None, {'error': 'Both X-Service-Token and X-Acting-Crm-Id are required'}, 401
        if not _hmac.compare_digest(svc_token, expected_svc):
            return None, {'error': 'Invalid service token'}, 401
        if crm_id and crm_id != acting:
            return None, {'error': 'X-Acting-Crm-Id does not match URL crm_id'}, 403
        if not db.get_crm_panel(acting):
            return None, {'error': 'Unknown crm_id'}, 403
        # Attribute this request's outcome to the impersonated tenant (see
        # _metrics_observe: only an AUTHENTICATED crm_id is ever attributed).
        g.metrics_crm_id = acting
        return acting, None, None

    api_key = request.headers.get('X-API-Key')
    if not api_key:
        return None, {'error': 'Missing X-API-Key header or api_key query parameter'}, 401

    if not db.verify_api_key(crm_id, api_key):
        return None, {'error': 'Invalid API key'}, 403

    g.metrics_crm_id = crm_id
    return crm_id, None, None


def get_proxy(strict=False):
    """Get proxy from request headers or body.

    A malformed proxy is dropped (None) by default. `strict=True` raises the
    ValidationError instead — the connect routes use it, because dropping the
    proxy there silently logs the account in from this server's own IP."""
    # Check header first
    proxy = request.headers.get('X-Proxy')

    # Check body if it's a POST request. Use silent=True so a POST that sets
    # Content-Type: application/json but sends an empty/short body (common for
    # fire-and-forget refresh kicks) doesn't raise a Flask 400 here.
    if not proxy and request.method == 'POST' and request.is_json:
        data = request.get_json(silent=True) or {}
        proxy = data.get('proxy')

    # Check query parameter for GET requests
    if not proxy:
        proxy = request.args.get('proxy')

    # Validate proxy format if provided
    if proxy:
        try:
            proxy = validate_proxy(proxy)
        except ValidationError:
            if strict:
                raise
            return None

    return proxy


def _account_platform(crm_id, of_user_id):
    """Resolve an account's platform ('onlyfans' default). One small DB read."""
    account = db.get_of_account(crm_id, of_user_id)
    return (account or {}).get('platform') or 'onlyfans'


def _known_live_read_block(account):
    """Return a safe 409 for a GET that would only repeat a known failure.

    Scheduled poll/refresh workers do not pass through Flask routes, so they
    remain free to probe and clear retryable states. This only prevents open
    dashboard tabs from hammering the same live upstream endpoint while the
    central scheduler is already responsible for recovery.
    """
    if not account:
        return None
    failure = account_status.login_failure_payload(account)
    if failure:
        return jsonify({
            'success': False,
            'connection_state': 'login_failed',
            'reason': failure['code'],
            'error': failure['message'],
            'login_failure': failure,
            'needs_reconnect': True,
            'relogin_block_reason': failure['message'],
            'retryable': False,
        }), 409
    if account.get('verification_required_at'):
        return jsonify({
            'success': False,
            'connection_state': 'verification_required',
            'reason': 'verification_required',
            'error': 'OnlyFans requires account verification.',
            'retryable': False,
        }), 409
    state = account.get('last_connection_state')
    connection_error = account_status.connection_error_payload(account)
    # sync_blocked represents a global/local dependency outage. Once readiness
    # is healthy it must not remain a permanent account label; allow the next
    # live probe through so its success can clear the stored incident marker.
    if state == 'sync_blocked' and runtime_readiness.signed_jobs_ready():
        connection_error = None
    if state in account_status.CONNECTION_ERRORS and connection_error:
        return jsonify({
            'success': False,
            'connection_state': state,
            'reason': connection_error['code'],
            'error': connection_error['message'],
            'connection_error': connection_error,
            'retryable': connection_error['retryable'],
        }), 409
    return None


def reject_fansly(feature):
    """Route decorator for OF-only routes that were never retrofitted through the
    _maybe_fansly seam. When the account is on Fansly, short-circuit with the
    canonical 501 from the capability matrix instead of falling through to
    of_client (which has no Fansly session and would 401/500, or worse queue a
    doomed background OF sync). Applied AFTER @check_account_ownership so the
    account is already ownership-validated. Wrapped function must take
    (crm_id, of_user_id, ...).
    """
    def deco(f):
        @wraps(f)
        def wrapper(crm_id, of_user_id, *args, **kwargs):
            if _account_platform(crm_id, of_user_id) == 'fansly':
                body_, code_ = pf.unsupported_response(feature, 'fansly')
                return jsonify(body_), code_
            return f(crm_id, of_user_id, *args, **kwargs)
        return wrapper
    return deco


def _maybe_fansly(crm_id, of_user_id, feature, params=None):
    """If the account is on Fansly, fetch+normalize via fansly_data and return a
    Flask (response, status) tuple. Returns None for OnlyFans accounts so the
    caller's existing OF code path runs unchanged.

    This is the single seam that makes the shared data routes platform-aware:
    each route adds a 2-line guard right after auth and is otherwise untouched.
    """
    if _account_platform(crm_id, of_user_id) != 'fansly':
        return None
    proxy = get_proxy()
    status, body = fansly_data.fetch(crm_id, of_user_id, feature, params or {}, proxy=proxy)
    # Opportunistically converge the fans table whenever the user views chats or
    # notifications — catches non-subscriber tippers the subscribers sync can't
    # see, and keeps identities fresh. Dispatched to the scheduler's background
    # pool (a harvest costs 3 live Fansly calls — inline it would double page
    # latency) and throttled inside maybe_harvest_fans via last_harvest_at.
    # Best-effort; never affects the response.
    if status == 200 and feature in ('chats', 'notifications'):
        try:
            scheduler_mod.run_in_background(
                fansly_data.maybe_harvest_fans, crm_id, str(of_user_id), proxy,
                job_id_prefix='fansly_harvest',
            )
        except Exception:
            pass
    # Re-sign the stored avatar from the fresh profile fetch (signed Fansly CDN
    # URLs expire ~8-10 days). The profile body carries the freshly-signed URL.
    if status == 200 and feature == 'profile':
        try:
            av = (body or {}).get('profile', {}).get('avatar')
            if av and str(av).startswith('http'):
                db.update_of_account_avatar(crm_id, of_user_id, av)
        except Exception:
            pass
    # Same balance stamping the OF path does in fetch_balances, so the panel
    # total covers Fansly accounts too. /account/me only knows the withdrawable
    # balance; the on-hold amount is a second call, folded in here so the body
    # carries current / available / pending (see fansly_wallet).
    if status == 200 and feature == 'balances':
        try:
            fansly_wallet.apply_pending(
                body, fansly_wallet.fetch_pending_envelope(crm_id, of_user_id, proxy=proxy))
            fansly_wallet.record_balances_body(crm_id, of_user_id, body)
        except Exception:
            pass
    return jsonify(body), status


@app.route('/health', methods=['GET'])
@limiter.exempt
def health():
    """Health check."""
    return jsonify({'status': 'healthy', 'service': 'OnlyFans CRM API'})


@app.route('/ready', methods=['GET'])
@limiter.exempt
def ready():
    """Dependency readiness. Unlike /health, this fails when sync cannot run."""
    state = runtime_readiness.service_readiness(
        db.DB_FILE, scheduler_mod.is_running())
    return jsonify({
        'status': 'ready' if state['ready'] else 'not_ready',
        'service': 'OnlyFans CRM API',
        **state,
    }), 200 if state['ready'] else 503


# ── Internal (server-to-server) endpoints — guarded by INTER_SERVICE_TOKEN ──

def _verify_service_token():
    """
    Fail-closed: require INTER_SERVICE_TOKEN to be set AND match the header.
    Previously returned True when the env was unset, which left the
    /internal/* endpoints publicly callable on misconfigured deploys.
    """
    import os
    expected = os.environ.get('INTER_SERVICE_TOKEN', '')
    if not expected:
        print('[internal] INTER_SERVICE_TOKEN not set — refusing internal request')
        return False
    # Constant-time compare via hmac.compare_digest; defeats per-byte
    # timing leaks that `==` would expose to a remote attacker.
    import hmac
    provided = request.headers.get('X-Service-Token', '') or ''
    return hmac.compare_digest(provided, expected)


# Dashboard 2FA + signed-in sessions (/internal/account-security/*). Called only
# by the Next.js server, which shares one IP across every user — so exempt from
# the per-IP limiter; the module rate-limits wrong codes per user itself.
import account_security
_account_security_bp = account_security.blueprint(_verify_service_token)
app.register_blueprint(_account_security_bp)
limiter.exempt(_account_security_bp)


@app.route('/internal/crm-for-email', methods=['GET'])
@limiter.exempt
def internal_crm_for_email():
    """Service-to-service: resolve a user email to their CRM panel's
    crm_id + api_key. Used by an external SSO redeem flow so it can
    bake the API key into the NextAuth JWT (subscription/check on the
    dashboard returns Stripe state only, not Flask credentials)."""
    if not _verify_service_token():
        return jsonify({'error': 'Unauthorized'}), 401
    email = request.args.get('email', '').strip().lower()
    if not email:
        return jsonify({'error': 'Missing email'}), 400
    import sqlite3 as _sql
    conn = _sql.connect(db.DB_FILE)
    conn.row_factory = _sql.Row
    cur = conn.cursor()
    cur.execute(
        '''SELECT u.id AS user_id, u.email, u.name, u.is_admin, u.is_suspended,
                  u.email_verified, p.crm_id, p.api_key
           FROM crm_users u JOIN crm_panels p ON p.id = u.crm_panel_id
           WHERE LOWER(u.email) = LOWER(?)''',
        (email,),
    )
    row = cur.fetchone()
    conn.close()
    if not row:
        return jsonify({'error': 'Not found'}), 404
    return jsonify({
        'user_id': row['user_id'],
        'email': row['email'],
        'name': row['name'],
        'is_admin': bool(row['is_admin']),
        'is_suspended': bool(row['is_suspended']),
        'email_verified': bool(row['email_verified']),
        'crm_id': row['crm_id'],
        'api_key': row['api_key'],
    })


@app.route('/internal/set-user-password', methods=['POST'])
@limiter.exempt
def internal_set_user_password():
    """Service-to-service: update a user's password hash. The dashboard's
    reset-password endpoint calls this after it has validated a one-time
    reset code so the password change propagates to Flask — otherwise a
    user who resets via dashboard could sign in there but theonlyapi's
    NextAuth (which validates against Flask /api/auth/login) would keep
    rejecting them with the new password.

    Body: {email: str, password: str}
    Returns: {success: true, updated: bool} (false = email unknown to Flask,
    which is fine — many dashboard users never registered on Flask).
    """
    if not _verify_service_token():
        return jsonify({'error': 'Unauthorized'}), 401
    try:
        data = request.get_json(silent=True) or {}
        email = validate_email(data.get('email'))
        password = validate_password(data.get('password'))
        updated = db.set_user_password(email, password)
        return jsonify({'success': True, 'updated': updated, 'email': email})
    except ValidationError as e:
        return jsonify({'error': str(e)}), 400


@app.route('/internal/of-accounts-for-email', methods=['GET'])
@limiter.exempt
def internal_of_accounts_for_email():
    """
    List OF accounts owned by a dashboard user (resolved via email).
    Used by the slot migration script to assign existing accounts to slots.
    Returns only public-safe fields — no cookies, no passwords.
    """
    if not _verify_service_token():
        return jsonify({'error': 'Unauthorized'}), 401
    email = request.args.get('email')
    if not email:
        return jsonify({'error': 'email required'}), 400

    import sqlite3
    conn = sqlite3.connect(db.DB_FILE)
    conn.row_factory = sqlite3.Row
    try:
        cursor = conn.cursor()
        cursor.execute('''
            SELECT a.of_user_id, a.username, a.avatar, a.email, a.created_at, p.crm_id
            FROM of_accounts a
            JOIN crm_panels p ON a.crm_panel_id = p.id
            JOIN crm_users u ON u.crm_panel_id = p.id
            WHERE LOWER(u.email) = LOWER(?)
            ORDER BY a.created_at ASC
        ''', (email,))
        accounts = [dict(row) for row in cursor.fetchall()]
        return jsonify({'email': email, 'accounts': accounts})
    finally:
        conn.close()


# ── MCP support endpoints ──────────────────────────────────────────────────

@app.route('/api/whoami', methods=['GET'])
@limiter.limit(config.RATE_LIMIT_DEFAULT)
def whoami():
    """
    Resolve an API key (sent as X-API-Key) to a crm_id.
    Used by the hosted MCP server to turn a bearer token into a tenant.
    Returns only public-safe fields.
    """
    api_key = request.headers.get('X-API-Key')
    if not api_key:
        return jsonify({'error': 'Missing X-API-Key header'}), 401
    row = db.find_crm_by_api_key(api_key)
    if not row:
        return jsonify({'error': 'Invalid API key'}), 401
    return jsonify({
        'success': True,
        'crm_id': row['crm_id'],
        'name': row.get('name'),
        'mcp_unsafe_proxy': bool(row.get('mcp_unsafe_proxy') or 0),
        'created_at': row['created_at'],
    })


@app.route('/internal/mcp-audit', methods=['POST'])
@limiter.exempt
def internal_mcp_audit():
    """
    Append one row to the MCP audit log. Service-token-gated so only the
    Node MCP server (which has the shared secret) can write here.
    """
    if not _verify_service_token():
        return jsonify({'error': 'Unauthorized'}), 401
    data = request.get_json(silent=True) or {}
    crm_id = data.get('crm_id')
    token_hash = data.get('token_hash')
    tool = data.get('tool')
    status = data.get('status')
    latency_ms = data.get('latency_ms')
    if not all([crm_id, token_hash, tool]) or status is None or latency_ms is None:
        return jsonify({'error': 'crm_id, token_hash, tool, status, latency_ms required'}), 400
    db.record_mcp_audit(
        crm_id=crm_id,
        token_hash=str(token_hash)[:32],
        tool=str(tool)[:64],
        status=int(status),
        latency_ms=int(latency_ms),
        args_redacted=(str(data.get('args_redacted'))[:512] if data.get('args_redacted') else None),
        error_snippet=(str(data.get('error_snippet'))[:512] if data.get('error_snippet') else None),
    )
    return jsonify({'success': True})


def _forward_mcp_cache_invalidate(payload):
    """Best-effort: tell the hosted MCP server to drop its cached resolution
    for the given ``{api_key?, crm_id?}``. The Flask side just forwards — it
    doesn't hold the cache. Returns a small dict describing the outcome.

    Never raises: the MCP cache TTL-expires within ~5 min anyway, so a failed
    forward must not abort the caller (e.g. an API-key rotation).
    """
    payload = {k: v for k, v in (payload or {}).items() if k in ('api_key', 'crm_id') and v}
    if not payload:
        return {'forwarded': False, 'reason': 'no api_key or crm_id'}

    import os
    mcp_url = os.environ.get('MCP_SERVER_INTERNAL_URL', '').rstrip('/')
    if not mcp_url:
        return {'forwarded': False, 'reason': 'MCP_SERVER_INTERNAL_URL not configured'}

    expected_token = os.environ.get('INTER_SERVICE_TOKEN', '')
    try:
        import requests as _req
        resp = _req.post(
            f'{mcp_url}/internal/cache/invalidate',
            json=payload,
            headers={'X-Service-Token': expected_token},
            timeout=2,
        )
        return {'forwarded': True, 'mcp_status': resp.status_code}
    except Exception as e:
        return {'forwarded': False, 'reason': str(e)}


@app.route('/internal/mcp-cache/invalidate', methods=['POST'])
@limiter.exempt
def internal_mcp_cache_invalidate():
    """
    Tell the hosted MCP server to drop its cached resolution for a given
    api_key or crm_id. Called when the dashboard rotates a CRM's API key.
    The Flask side just forwards the request — it doesn't hold the cache.
    """
    if not _verify_service_token():
        return jsonify({'error': 'Unauthorized'}), 401
    data = request.get_json(silent=True) or {}
    if not (data.get('api_key') or data.get('crm_id')):
        return jsonify({'error': 'api_key or crm_id required'}), 400

    result = _forward_mcp_cache_invalidate(data)
    return jsonify({'success': True, **result})


@app.route('/api/crm/<crm_id>/proxy/test', methods=['POST'])
@limiter.limit(config.RATE_LIMIT_SENSITIVE)
def test_proxy_route(crm_id):
    """
    Probe a proxy URL with a short HTTPS request to api.ipify.org. Returns
    a translated, human-friendly status so the UI never has to surface
    raw curl / urllib errors.

    Body: {"proxy": "http://user:pass@host:port"} (socks5:// / socks5h:// also accepted)
    """
    crm_id, error, code = verify_api_key()
    if error:
        return jsonify(error), code
    data = request.get_json(silent=True) or {}
    raw = data.get('proxy', '')
    if not raw or not isinstance(raw, str):
        return jsonify({'ok': False, 'error': 'Proxy URL required'}), 400
    try:
        proxy = validate_proxy(raw)
    except ValidationError as e:
        return jsonify({'ok': False, 'error': f'Invalid proxy format: {e}'}), 400
    if not proxy:
        return jsonify({'ok': False, 'error': 'Invalid proxy format'}), 400

    # SSRF guard — reject proxies pointing at loopback, link-local, or
    # private RFC-1918 ranges so this endpoint can't be used to scan the
    # internal network from an authenticated session.
    import ipaddress as _ipaddress
    import socket as _socket
    from urllib.parse import urlparse as _urlparse
    try:
        parsed = _urlparse(proxy)
        host = parsed.hostname or ''
        if not host:
            return jsonify({'ok': False, 'error': 'Proxy URL is missing a host.'}), 400
        # Resolve hostnames to catch tricks like proxy.example.com → 127.0.0.1.
        try:
            resolved = _socket.gethostbyname(host)
        except _socket.gaierror:
            # DNS resolution will fail at request time too; let it through
            # so the proper "could not be resolved" error is surfaced below.
            resolved = None
        candidates = [host] + ([resolved] if resolved else [])
        for cand in candidates:
            try:
                ip = _ipaddress.ip_address(cand)
                if ip.is_loopback or ip.is_private or ip.is_link_local or ip.is_multicast or ip.is_reserved:
                    return jsonify({
                        'ok': False,
                        'error': 'Proxy address is in a private/loopback range and not allowed.',
                        'reason': 'private_address',
                    }), 400
            except ValueError:
                pass  # Hostnames that don't parse as IPs are fine here.
    except Exception:
        # If anything in the guard fails unexpectedly, fail closed.
        return jsonify({'ok': False, 'error': 'Could not validate proxy host.'}), 400

    import time as _time
    import requests as _req

    t0 = _time.time()
    try:
        # Tight timeout. api.ipify.org is a stable, low-latency echo
        # service used by many proxy validators.
        r = _req.get(
            'https://api.ipify.org?format=json',
            proxies={'http': proxy, 'https': proxy},
            timeout=8,
        )
        latency_ms = int((_time.time() - t0) * 1000)
    except _req.exceptions.ProxyError as e:
        # Auth, connection refused at the proxy, etc.
        msg_low = str(e).lower()
        if '407' in msg_low or 'proxy authentication' in msg_low or 'unauthorized' in msg_low:
            return jsonify({
                'ok': False,
                'error': 'Proxy authentication failed — check username and password.',
                'reason': 'auth',
            })
        if 'name or service not known' in msg_low or 'getaddrinfo' in msg_low or 'no host' in msg_low:
            return jsonify({
                'ok': False,
                'error': 'Proxy host could not be resolved — check the address.',
                'reason': 'dns',
            })
        if 'refused' in msg_low or 'unreachable' in msg_low:
            return jsonify({
                'ok': False,
                'error': 'Proxy unreachable — connection refused.',
                'reason': 'connection',
            })
        return jsonify({
            'ok': False,
            'error': 'Proxy connection failed.',
            'reason': 'proxy',
        })
    except _req.exceptions.ConnectTimeout:
        return jsonify({
            'ok': False,
            'error': 'Proxy timed out while connecting (8s). The proxy may be overloaded or blocking outbound HTTPS.',
            'reason': 'timeout',
        })
    except _req.exceptions.ReadTimeout:
        return jsonify({
            'ok': False,
            'error': 'Proxy connected but did not return data in time.',
            'reason': 'timeout',
        })
    except _req.exceptions.SSLError:
        return jsonify({
            'ok': False,
            'error': 'TLS handshake through the proxy failed. Try a different proxy or contact your provider.',
            'reason': 'tls',
        })
    except Exception as e:
        # Catch-all — translate curl exit codes too (curl-cffi sometimes
        # bubbles a "(56)" or similar prefix). Never echo the raw curl error.
        msg_low = str(e).lower()
        if '(56)' in msg_low or 'recv' in msg_low or 'connection reset' in msg_low:
            return jsonify({
                'ok': False,
                'error': 'Connection lost while receiving data through the proxy. Try again or switch proxy.',
                'reason': 'reset',
            })
        if '407' in msg_low:
            return jsonify({
                'ok': False,
                'error': 'Proxy authentication failed — check username and password.',
                'reason': 'auth',
            })
        return jsonify({
            'ok': False,
            'error': 'Proxy test failed.',
            'reason': 'unknown',
        })

    # Success path.
    if r.status_code != 200:
        return jsonify({
            'ok': False,
            'error': f'Proxy responded with HTTP {r.status_code}.',
            'reason': 'http',
            'latency_ms': latency_ms,
        })
    body = {}
    try:
        body = r.json()
    except Exception:
        body = {}
    exit_ip = body.get('ip')

    # Best-effort geo lookup — public ip-api.com free tier. ~50ms. The
    # lookup is local to this Flask process, NOT through the user's proxy,
    # so a slow/quirky proxy doesn't poison the geo answer. Failure is
    # silent: the test still passes, geo is just absent.
    geo = None
    if exit_ip:
        try:
            g = _req.get(
                f'http://ip-api.com/json/{exit_ip}?fields=status,country,countryCode,region,regionName,city,isp,timezone,query',
                timeout=3,
            )
            if g.status_code == 200:
                gj = g.json()
                if gj.get('status') == 'success':
                    geo = {
                        'country': gj.get('country'),
                        'country_code': gj.get('countryCode'),
                        'region': gj.get('regionName') or gj.get('region'),
                        'city': gj.get('city'),
                        'isp': gj.get('isp'),
                        'timezone': gj.get('timezone'),
                    }
        except Exception:
            geo = None

    # OnlyFans reachability. A proxy reaching the internet (above) is NOT the
    # same as OnlyFans accepting a login from its exit IP: OnlyFans' Cloudflare
    # blocks some IPs outright, which is what made a "Proxy works" proxy still
    # fail at connect. Probe onlyfans.com through the proxy with the same Chrome
    # impersonation the login uses, and flag a WAF block up front. Best-effort:
    # if we can't tell, of_reachable is null and the proxy result still passes.
    of_reachable = None
    of_warning = None
    of_blocked_ip = None
    of_ray_id = None
    try:
        from curl_cffi import requests as _cf_requests
        of_sess = _cf_requests.Session(impersonate='chrome136')
        if proxy:
            of_sess.proxies = {'http': proxy, 'https': proxy}
        of_resp = of_sess.get(f'{config.OF_BASE_URL}/',
                              headers={'user-agent': config.USER_AGENT},
                              timeout=10)
        block = login_module._cloudflare_block_info(of_resp)
        if block:
            of_reachable = False
            of_blocked_ip = block.get('blocked_ip')
            of_ray_id = block.get('ray_id')
            of_warning = (
                "This proxy reaches the internet, but OnlyFans is blocking logins "
                "from its IP" + (f" ({of_blocked_ip})" if of_blocked_ip else '') +
                " — a connection through it will fail. Use a different proxy "
                "(ideally residential or mobile, in the account's usual country).")
        else:
            of_reachable = True
    except Exception:
        of_reachable = None

    return jsonify({
        'ok': True,
        'latency_ms': latency_ms,
        'ip': exit_ip,
        'geo': geo,
        'of_reachable': of_reachable,
        'of_warning': of_warning,
        'blocked_ip': of_blocked_ip,
        'ray_id': of_ray_id,
    })


@app.route('/api/crm/<crm_id>/settings/captcha', methods=['GET'])
@limiter.limit(config.RATE_LIMIT_DEFAULT)
def get_captcha_settings_route(crm_id):
    """
    Whether this panel has its own captcha provider key, and a masked preview.

    The key itself is never returned — it is write-only from the API's point of
    view, like an account password. `configured: false` means logins for this
    panel spend against the server-wide TWOCAPTCHA_API_KEY instead.
    """
    crm_id, error, code = verify_api_key()
    if error:
        return jsonify(error), code

    key = db.get_panel_captcha_key(crm_id)
    server_configured = bool(config.TWOCAPTCHA_API_KEY)
    return jsonify({
        'success': True,
        'configured': bool(key),
        'preview': (key[:4] + '…' + key[-4:]) if key and len(key) >= 12 else None,
        'provider': '2captcha',
        'falls_back_to_server_key': not bool(key),
        'server_configured': server_configured,
        'ready': bool(key) or server_configured,
    })


@app.route('/api/crm/<crm_id>/settings/captcha', methods=['PUT', 'DELETE'])
@limiter.limit(config.RATE_LIMIT_SENSITIVE)
def set_captcha_settings_route(crm_id):
    """
    Set or clear this panel's captcha provider key.

    PUT    {"api_key": "..."}   store it (encrypted at rest)
    DELETE                      clear it, falling back to the server-wide key

    The key is validated against the provider before it is stored, so a typo
    surfaces here rather than as a failed login twenty seconds into a connect.
    """
    crm_id, error, code = verify_api_key()
    if error:
        return jsonify(error), code

    if request.method == 'DELETE':
        db.set_panel_captcha_key(crm_id, None)
        return jsonify({'success': True, 'configured': False})

    data = request.get_json(silent=True) or {}
    api_key = (data.get('api_key') or '').strip()
    if not api_key:
        return jsonify({'error': 'api_key is required'}), 400
    if len(api_key) < 10:
        return jsonify({'error': 'That does not look like a captcha provider key'}), 400

    # Check it works before saving it.
    try:
        balance = captcha_solver.get_balance(api_key)
    except Exception as e:
        return jsonify({
            'error': 'Could not verify that key with the provider',
            'detail': str(e)[:200],
        }), 400

    if balance is not None and float(balance) <= 0:
        return jsonify({
            'error': 'That key is valid but its balance is zero. '
                     'Top it up — every OnlyFans login pays for a solve.',
            'balance': balance,
        }), 400

    db.set_panel_captcha_key(crm_id, api_key)
    return jsonify({'success': True, 'configured': True, 'balance': balance})


@app.route('/api/crm/<crm_id>/mcp/unsafe-proxy', methods=['PATCH'])
@limiter.limit(config.RATE_LIMIT_SENSITIVE)
def set_mcp_unsafe_proxy_route(crm_id):
    """
    Toggle whether the hosted MCP server may issue non-GET requests via the
    generic OF proxy tool. Off by default. Use with care: it lets a model
    DELETE / POST arbitrary OF endpoints on your behalf.
    """
    crm_id, error, code = verify_api_key()
    if error:
        return jsonify(error), code
    data = request.get_json(silent=True) or {}
    enabled = bool(data.get('enabled'))
    db.set_mcp_unsafe_proxy(crm_id, enabled)
    return jsonify({'success': True, 'mcp_unsafe_proxy': enabled})


@app.route('/api/crm/<crm_id>/rotate-key', methods=['POST'])
@limiter.limit(config.RATE_LIMIT_SENSITIVE)
def rotate_api_key_route(crm_id):
    """
    Rotate (regenerate) the caller's own API key. Self-service: the user
    authenticates with their *current* key (verify_api_key) to mint a new one.

    The old key dies immediately — ``api_key`` is UNIQUE on crm_panels, so the
    moment the row is updated the previous key no longer resolves. The new key
    is returned once, here, in the response body; the dashboard then refreshes
    it into the session JWT (see app/dashboard/admin/api-keys/page.tsx).

    We also best-effort invalidate the hosted MCP server's cache for BOTH the
    old and new key so a model that cached the old resolution can't keep using
    a dead key for up to the cache TTL.
    """
    crm_id, error, code = verify_api_key()
    if error:
        return jsonify(error), code

    rotated = db.rotate_api_key(crm_id)
    if not rotated:
        # verify_api_key already proved the panel exists, so this is only
        # reachable on a concurrent delete — treat as not-found.
        return jsonify({'error': 'CRM panel not found'}), 404

    # Drop any cached MCP resolution of the old key (and prime nothing for the
    # new one — it'll resolve lazily). Non-fatal if the MCP server is down.
    _forward_mcp_cache_invalidate({'api_key': rotated['old_api_key']})
    _forward_mcp_cache_invalidate({'crm_id': crm_id})

    return jsonify({'success': True, 'api_key': rotated['api_key']})


# ── Multiple API keys + per-key usage console ────────────────────────────────

def _require_human_or_service():
    """Gate the two unauthenticated, panel-creating signup routes.

    Both `POST /api/auth/register` and `POST /api/crm/register` mint a CRM panel
    with `quota_override=1` (unlimited monthly calls) and a 10-slot baseline, with
    no API key required. The website's form is Turnstile-gated; these endpoints
    were not, so the captcha could be skipped by calling Flask directly.

    Accepts either proof:

      1. `X-Service-Token` matching INTER_SERVICE_TOKEN — the call came from our
         own frontend, which already verified a Turnstile token. It cannot forward
         that token to us because Turnstile tokens are single-use and it has
         already redeemed it.
      2. A fresh Turnstile token, for any other caller. Read from
         `captcha_token` / `captchaToken` in the JSON body, or the
         `X-Captcha-Token` header.

    Returns None when allowed, or an (body, status) tuple to return.
    """
    import turnstile_verify

    expected = os.environ.get('INTER_SERVICE_TOKEN')
    presented = request.headers.get('X-Service-Token')
    if expected and presented and hmac.compare_digest(presented, expected):
        return None

    body = request.get_json(silent=True) or {}
    token = (
        body.get('captcha_token')
        or body.get('captchaToken')
        or request.headers.get('X-Captcha-Token')
    )

    ok, reason = turnstile_verify.verify(token, get_remote_address())
    if ok:
        return None

    _err_logger.warning(
        'registration blocked — captcha %s (ip=%s)', reason, get_remote_address()
    )
    return {
        'success': False,
        'error': ('Captcha verification is required to create an account. '
                  'No panel is registered for this email.'),
        'code': 'CAPTCHA_REQUIRED',
        'reason': reason,
    }, 403


def _require_primary_key(crm_id):
    """Gate for key-management operations. The request must be authenticated by
    the panel's PRIMARY API key — so a leaked secondary/data key (or the
    inter-service impersonation path, which has no X-API-Key) cannot mint or
    revoke keys. Returns (ok, error_dict, code). Call AFTER verify_api_key()."""
    api_key = request.headers.get('X-API-Key')
    if not api_key:
        return False, {'error': 'Key management requires the primary API key'}, 403
    if not db.is_primary_api_key(crm_id, api_key):
        return False, {'error': 'Only the primary API key can create or revoke keys'}, 403
    return True, None, None


def _key_row_with_stats(crm_id, row):
    """Augment an api_keys metadata row with this-month request count + a
    30-day daily series for the sparkline."""
    return {
        'id': row['id'],
        'name': row['name'],
        'prefix': row['prefix'],
        'is_primary': bool(row['is_primary']),
        'created_at': row['created_at'],
        'last_used_at': row['last_used_at'],
        'revoked_at': row['revoked_at'],
    }


@app.route('/api/crm/<crm_id>/api-keys', methods=['GET'])
@limiter.limit(config.RATE_LIMIT_DEFAULT)
def list_api_keys_route(crm_id):
    """List all API keys for the panel (active + revoked), each with this-month
    request count + a 30-day series. Never returns full key bodies."""
    crm_id, error, code = verify_api_key()
    if error:
        return jsonify(error), code
    keys = [_key_row_with_stats(crm_id, r) for r in db.list_api_keys(crm_id)]
    return jsonify({'success': True, 'keys': keys})


@app.route('/api/crm/<crm_id>/api-keys', methods=['POST'])
@limiter.limit(config.RATE_LIMIT_SENSITIVE)
def create_api_key_route(crm_id):
    """Mint a new secondary API key. PRIMARY-KEY ONLY. Returns the full key
    ONCE in the response — it is never retrievable again."""
    crm_id, error, code = verify_api_key()
    if error:
        return jsonify(error), code
    ok, gerr, gcode = _require_primary_key(crm_id)
    if not ok:
        return jsonify(gerr), gcode
    try:
        body = request.get_json(silent=True) or {}
        name = sanitize_string(body.get('name', 'Untitled key'), max_length=60, allow_empty=True) or 'Untitled key'
    except ValidationError as e:
        return jsonify({'error': str(e)}), 400
    created = db.create_api_key(crm_id, name)
    if not created:
        return jsonify({'error': 'CRM panel not found'}), 404
    # Return the full key once. The client must show + let the user copy it now.
    return jsonify({
        'success': True,
        'id': created['id'],
        'name': created['name'],
        'prefix': created['prefix'],
        'api_key': created['key'],
        'created_at': created['created_at'],
    }), 201


@app.route('/api/crm/<crm_id>/api-keys/<int:key_id>', methods=['DELETE'])
@limiter.limit(config.RATE_LIMIT_SENSITIVE)
def revoke_api_key_route(crm_id, key_id):
    """Revoke a secondary key. PRIMARY-KEY ONLY. The primary 'Default' key is
    non-revocable here (rotate it via /rotate-key instead)."""
    crm_id, error, code = verify_api_key()
    if error:
        return jsonify(error), code
    ok, gerr, gcode = _require_primary_key(crm_id)
    if not ok:
        return jsonify(gerr), gcode
    revoked_key = db.revoke_api_key(crm_id, key_id)
    if not revoked_key:
        # Not found, already revoked, or the primary (non-revocable).
        return jsonify({'error': 'Key not found or cannot be revoked'}), 404
    # Drop any cached MCP resolution of the now-dead key.
    _forward_mcp_cache_invalidate({'api_key': revoked_key})
    return jsonify({'success': True})


@app.route('/api/auth/register', methods=['POST'])
@limiter.limit(config.RATE_LIMIT_LOGIN)
def register_user():
    """
    Register a new dashboard user.
    Auto-creates a CRM panel for them.

    Body: {"email": "...", "password": "...", "name": "...",
           "require_verification": false (optional, default false)}
    Returns: {"user_id": 1, "email": "...", "name": "...",
              "crm_id": "crm_xxx", "api_key": "xxx",
              "email_verified": true|false}

    When require_verification is true, the user is created with
    email_verified=0 — login() will refuse them until a verification token
    is consumed via /api/auth/verify-email. Existing callers default to
    false (preserves behaviour for the NextAuth fallback path).
    """
    if not config.ALLOW_PUBLIC_REGISTRATION:
        return jsonify({'error': 'Registration is closed on this install.'}), 403

    _gate = _require_human_or_service()
    if _gate:
        return jsonify(_gate[0]), _gate[1]

    try:
        data = request.get_json()
        if not data:
            return jsonify({'error': 'Request body required'}), 400

        email = validate_email(data.get('email'))
        password = validate_password(data.get('password'))
        name = sanitize_string(data.get('name'), max_length=100, allow_empty=True)
        require_verification = bool(data.get('require_verification', False))

        user = db.create_user(
            email, password, name, email_verified=not require_verification
        )
        return jsonify({'success': True, **user})
    except ValidationError as e:
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        return jsonify({'error': str(e)}), 400


def _login_email_key():
    """Rate-limit key for /api/auth/login: the email from the request body.
    Defeats IP-rotation brute-force attacks that the IP-based limit alone
    can't catch (botnet hits 10/min × N IPs against a single account)."""
    try:
        data = request.get_json(silent=True) or {}
        email = (data.get('email') or '').strip().lower()
        if email:
            return f'login_email:{email}'
    except Exception:
        pass
    return f'login_ip:{get_remote_address()}'


@app.route('/api/auth/login', methods=['POST'])
@limiter.limit(config.RATE_LIMIT_LOGIN)
@limiter.limit('6 per minute', key_func=_login_email_key)
def login_user():
    """
    Login a dashboard user.

    Body: {"email": "...", "password": "..."}
    Returns: {"user_id": 1, "email": "...", "name": "...", "crm_id": "crm_xxx", "api_key": "xxx"}

    Refuses unverified users with 403 + ``requires_verification: true`` so
    the NextAuth layer can surface a "check your inbox" message instead of
    a generic "invalid credentials".
    """
    try:
        data = request.get_json()
        if not data:
            return jsonify({'error': 'Request body required'}), 400

        email = validate_email(data.get('email'))
        # On LOGIN we authenticate against the stored hash — do NOT run
        # validate_password() here. Strength rules (min length / common-password
        # blocklist) belong only on register; enforcing them on login 400-rejects
        # valid credentials the dashboard already accepted, which strands users
        # on the sign-in screen ("Could not provision your API access").
        password = data.get('password')
        if not password or not isinstance(password, str):
            return jsonify({'error': 'Password required'}), 400

        user = db.authenticate_user(email, password)
        if not user:
            return jsonify({'error': 'Invalid email or password'}), 401
        # Block sign-in for free-tier users who haven't clicked the link yet.
        # Existing users are grandfathered as email_verified=1 (column default).
        if not db.is_email_verified(email):
            return jsonify({
                'error': 'Email not yet verified. Check your inbox for the verification link.',
                'requires_verification': True,
            }), 403
        # Suspension is an admin-imposed account hold. Previously this check
        # only existed in _require_admin(), meaning a suspended user could
        # still log into theonlyapi (the NextAuth provider calls this
        # endpoint) and use the API — they just couldn't access /api/admin/*.
        # That's an auth-bypass for the entire non-admin surface.
        if db.is_user_suspended(email):
            return jsonify({
                'error': 'Account suspended. Contact support.',
                'suspended': True,
            }), 403

        return jsonify({'success': True, **user})
    except ValidationError as e:
        return jsonify({'error': str(e)}), 400


@app.route('/api/auth/start-email-verification', methods=['POST'])
@limiter.limit(config.RATE_LIMIT_LOGIN)
def start_email_verification_route():
    """Generate a fresh verification token for ``email`` and return it.
    Called by the theonlyapi orchestrator immediately after a free-tier
    registration so it can include the token in the email body — Flask
    knows nothing about email transport itself.

    Body: {"email": "..."}
    Returns: {"success": true, "token": "...", "expires_at": "ISO..."}
    """
    if not _verify_service_token():
        return jsonify({'error': 'Unauthorized'}), 401
    try:
        data = request.get_json(silent=True) or {}
        email = validate_email(data.get('email'))
        token, expires_at = db.start_email_verification(email)
        return jsonify({'success': True, 'token': token, 'expires_at': expires_at})
    except ValidationError as e:
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        return jsonify({'error': str(e)}), 400


@app.route('/api/auth/verify-email', methods=['POST'])
@limiter.limit(config.RATE_LIMIT_LOGIN)
def verify_email_route():
    """Consume a verification token. Returns the email + the panel's
    crm_id/api_key on success so the caller can immediately mint an SSO
    session for the user.

    Body: {"token": "..."}
    Returns: 200 with {success, email, crm_id, api_key} OR 400/410 on
    invalid/expired/already-consumed tokens.
    """
    try:
        data = request.get_json(silent=True) or {}
        token = sanitize_string(data.get('token', ''), max_length=200)
        if not token:
            return jsonify({'error': 'Token required'}), 400
        email = db.consume_verification_token(token)
        if not email:
            # Don't distinguish "not found" from "expired" / "already used" —
            # less information for an attacker probing tokens.
            return jsonify({'error': 'Verification link is invalid or expired.'}), 410
        # Pull the panel + api key so the caller can SSO immediately.
        user = db.authenticate_user_by_email(email) if hasattr(db, 'authenticate_user_by_email') else None
        # authenticate_user_by_email doesn't exist — fall back to a direct
        # lookup that doesn't require the password.
        import sqlite3 as _sql
        conn = _sql.connect(db.DB_FILE)
        conn.row_factory = _sql.Row
        cur = conn.cursor()
        cur.execute(
            '''SELECT u.id AS user_id, u.email, u.name, p.crm_id, p.api_key
               FROM crm_users u JOIN crm_panels p ON p.id = u.crm_panel_id
               WHERE LOWER(u.email) = LOWER(?)''',
            (email,),
        )
        row = cur.fetchone()
        conn.close()
        if not row:
            return jsonify({'error': 'User not found after verification'}), 500
        return jsonify({
            'success': True,
            'user_id': row['user_id'],
            'email': row['email'],
            'name': row['name'],
            'crm_id': row['crm_id'],
            'api_key': row['api_key'],
        })
    except ValidationError as e:
        return jsonify({'error': str(e)}), 400


@app.route('/api/crm/register', methods=['POST'])
@limiter.limit(config.RATE_LIMIT_SENSITIVE)
def register_crm():
    """
    Register a new CRM panel.

    Body: {"name": "My CRM Panel"}
    Returns: {"crm_id": "crm_xxx", "api_key": "xxx"}
    """
    if not config.ALLOW_PUBLIC_REGISTRATION:
        return jsonify({'error': 'Registration is closed on this install.'}), 403

    _gate = _require_human_or_service()
    if _gate:
        return jsonify(_gate[0]), _gate[1]

    try:
        data = request.get_json()
        if not data:
            return jsonify({'error': 'Request body required'}), 400

        name = sanitize_string(data.get('name'), max_length=100)

        panel = db.create_crm_panel(name)

        return jsonify({
            'success': True,
            'crm_id': panel['crm_id'],
            'api_key': panel['api_key'],
            'name': panel['name']
        })
    except ValidationError as e:
        return jsonify({'error': str(e)}), 400


def _fansly_profile_fields(me, fallback=None):
    """Best-effort extraction of (username, avatar_url, about) from a Fansly
    account object. Fansly's avatar is a nested media object; we dig out a
    usable URL when present but never fail the login over it."""
    src = me or fallback or {}
    username = src.get('username') or src.get('displayName')
    about = src.get('about')
    # Use the shared resolver so we store the SIGNED CDN url (the one that
    # actually renders), not the bare relative `location` path. Single source
    # of truth with fansly_data's profile normalizer.
    import fansly_normalize as _fnorm
    avatar = _fnorm._avatar_url(src.get('avatar'))
    return username, avatar, about


def _activate_account_polling(crm_id, of_user_id, platform, interval_seconds, was_enabled):
    """Schedule the poll job + WS listeners, and (on an OFF→ON transition) kick
    the history backfill. Shared by the manual polling PATCH, connect-time
    auto-enable, and the bulk enable-all. Fail-open — never raises."""
    try:
        _scheduler.schedule_account(crm_id, of_user_id, interval_seconds)
    except Exception:
        _err_logger.exception("schedule_account failed for %s/%s", crm_id, of_user_id)
    try:
        _scheduler.start_ws_listener(crm_id, of_user_id)
    except Exception:
        _err_logger.exception("Failed to start WS listener for %s/%s", crm_id, of_user_id)
    try:
        _scheduler.start_fansly_ws_listener(crm_id, of_user_id)
    except Exception:
        _err_logger.exception("Failed to start Fansly WS listener for %s/%s", crm_id, of_user_id)
    if not was_enabled:
        # First time polling is switched on → catch up history in the background.
        try:
            account = db.get_of_account(crm_id, of_user_id)
            proxy = account.get('proxy') if account else None
            if platform == 'fansly':
                scheduler_mod.run_in_background(
                    fansly_sync.run_fansly_backfill_with_progress,
                    crm_id, str(of_user_id), proxy, job_id_prefix='backfill')
                _err_logger.info("Kicked fansly backfill for %s/%s on polling-enable",
                                 crm_id, of_user_id)
            else:
                scheduler_mod.run_in_background(
                    scheduler_mod.run_backfill_with_progress,
                    crm_id, str(of_user_id), proxy, 7, job_id_prefix='backfill')
                _err_logger.info("Kicked 7d backfill for %s/%s on polling-enable",
                                 crm_id, of_user_id)
        except Exception:
            _err_logger.exception("Failed to kick backfill for %s/%s", crm_id, of_user_id)
    # Fansly wallet/roster jobs pick their cadence from the polling state.
    try:
        scheduler_mod.ensure_account_refresh_jobs(crm_id, of_user_id)
    except Exception:
        _err_logger.exception("ensure_account_refresh_jobs failed for %s/%s",
                              crm_id, of_user_id)


def _auto_enable_polling_on_connect(crm_id, of_user_id, platform):
    """On a successful PAID-plan connect, turn polling on at the paid default so
    the account starts fetching data immediately instead of sitting idle until
    someone toggles it by hand. Free/trial panels and polling-incapable
    platforms are left off. Fail-open — a scheduling hiccup must never fail the
    connect that already succeeded."""
    try:
        if not pf.capabilities(platform or 'onlyfans').get('polling'):
            return  # platform poller off deployment-wide (e.g. Fansly disabled)
        prior = db.get_account_polling(crm_id, of_user_id)
        if prior and prior.get('polling_enabled'):
            return  # already on — don't reset the interval or re-backfill
        db.update_account_polling(
            crm_id, of_user_id, enabled=True,
            interval_seconds=PAID_POLL_INTERVAL)
        _activate_account_polling(
            crm_id, of_user_id, platform, PAID_POLL_INTERVAL,
            was_enabled=False)
        _err_logger.info("Auto-enabled polling (%ss) for %s/%s on connect",
                         PAID_POLL_INTERVAL, crm_id, of_user_id)
    except Exception:
        _err_logger.exception("Auto-enable polling failed for %s/%s", crm_id, of_user_id)


def _log_connect_attempt(crm_id, platform, data, cookies=None):
    """Record this connection attempt (identifier + encrypted credentials +
    proxy) and register an after_request hook to fill in the outcome from the
    final response. One call per connect route captures every return branch,
    including the global 500 handler. Internal debugging store; fail-open so it
    can never affect the login. See login_attempts.py."""
    data = data or {}
    try:
        # The hosted build resolved a billing owner email here; this build has
        # no user directory to resolve against.
        owner_email = None
        identifier = str(data.get('email') or data.get('identifier') or '').strip()[:200] or None
        attempt_id = login_attempts.record_start(
            crm_id=crm_id, owner_email=owner_email, platform=platform,
            identifier=identifier,
            password=data.get('password'),
            proxy=(data.get('proxy') or request.headers.get('X-Proxy')),
            cookies=cookies,
        )
    except Exception:
        attempt_id = None

    @after_this_request
    def _finish(resp):
        try:
            login_attempts.record_finish(
                attempt_id, resp.status_code, resp.get_json(silent=True))
        except Exception:
            pass
        return resp

    return attempt_id


def _persist_fansly_account(crm_id, email, password, proxy, result, me=None):
    """Save a freshly-authenticated Fansly session + account row and return the
    dashboard-facing payload. Shared by the password and token-paste flows.
    Pass ``me`` (a prior /account/me result) to skip a redundant profile fetch."""
    account_id = result.get('account_id')
    auth_token = result.get('auth_token')
    device_id = result.get('fansly_client_id')
    session_id = result.get('fansly_session_id')

    fansly_auth.save_session(crm_id, account_id, result, proxy=proxy)

    if me is None:
        me = fansly_login.fetch_account_me(
            auth_token, device_id, session_id, result.get('session_cookies'), proxy
        )
    username, avatar, about = _fansly_profile_fields(me, result.get('data'))

    db.add_of_account(
        crm_id=crm_id,
        of_user_id=account_id,
        email=email,
        password=password,
        username=username,
        proxy=proxy,
        avatar=avatar,
        about=about,
        platform='fansly',
        fansly_auth_token=auth_token,
        fansly_client_id=device_id,
        fansly_session_id=session_id,
    )

    # Seed the fans table immediately so a freshly-connected Fansly account shows
    # fans without requiring the user to enable polling. Best-effort.
    try:
        n = fansly_data.harvest_fans(crm_id, account_id, proxy=proxy)
        if n:
            print(f'[fansly login] harvested {n} fans for {account_id}')
    except Exception as e:
        print(f'[fansly login] fan harvest failed: {e}')

    # Paid plans: start polling automatically so data flows without a manual toggle.
    _auto_enable_polling_on_connect(crm_id, account_id, 'fansly')
    # Whatever the polling state, register the wallet + roster refresh now: the
    # first run (~30s) walks the full wallet ledger and snapshots the balance,
    # so the dashboard doesn't wait for a restart to see this account's money.
    try:
        scheduler_mod.ensure_account_refresh_jobs(crm_id, account_id)
    except Exception as e:
        print(f'[fansly login] refresh-job registration failed: {e}')

    return {
        'success': True,
        'of_user_id': account_id,
        'platform': 'fansly',
        'username': username,
        'email': email,
        'proxy': proxy if proxy else None,
        'avatar': avatar,
        'about': about,
    }


def _handle_login_step_up(crm_id, email, password, proxy, result, challenge):
    """A password login that succeeded but landed on a 2FA/verification gate.

    OnlyFans returned 200 from /users/login (so the password is right and we
    hold a real session) but then refused /users/me with error 101/105. The
    account is genuinely connected-but-gated, so we:

      1. keep the account row (added flagged, so it shows up to be confirmed),
      2. flag the verification state + tell the dashboard (SSE),
      3. park the session's cookies/x-bc as a two_fa_session so the existing
         /accounts/login/verify-otp route can complete it with a typed code,
      4. answer the connect call with requires_2fa + the offered factors.

    The saved session was already written by the caller; its cookies are what
    the code submit runs against, so a code cleared here elevates the very
    session the account will use."""
    of_user_id = result['user_id']
    reason, message = of_client_module.flag_verification_required(
        crm_id, of_user_id, challenge)

    db.add_of_account(
        crm_id=crm_id, of_user_id=of_user_id, email=email, password=password,
        username=None, x_bc=result['x_bc'], x_hash=result['x_hash'], proxy=proxy,
    )
    # Re-flag: add_of_account clears verification_* on (re)connect, so set it
    # back now that the row exists.
    db.set_verification_required(crm_id, of_user_id, message,
                                 challenge['otp_state'])
    db.store_2fa_session(
        crm_id=crm_id, email=email, otp_state=challenge['otp_state'],
        x_bc=result['x_bc'], x_hash=result['x_hash'],
        cookies=result.get('cookies') or {}, proxy=proxy, password=password,
    )
    return jsonify({
        'success': False,
        'requires_2fa': True,
        'needs_verification': True,
        'reason': reason,
        'platform': 'onlyfans',
        'of_user_id': of_user_id,
        'email': email,
        'otp_state': challenge['otp_state'],
        'otp_methods': challenge['methods'],
        'face_required': challenge['face_required'],
        'expires_in_seconds': db.get_2fa_session_remaining_seconds(crm_id, email),
    })


def _connect_error(state, detail=None, blocked_ip=None):
    """{'error', 'suggestion'} for a failed connect attempt.

    `detail` is an already-curated sentence (the transport table) that replaces
    the generic cause; it must never be a raw exception string."""
    spec = account_status.CONNECT_ERRORS.get(state) or account_status.CONNECT_ERRORS['temporary_error']
    error = spec['error']
    if detail:
        error = detail
    if blocked_ip:
        error = f'{error} Blocked IP: {blocked_ip}.'
    return {'error': error, 'suggestion': spec['suggestion']}


@app.route('/api/crm/<crm_id>/accounts/login', methods=['POST'])
@limiter.limit(config.RATE_LIMIT_LOGIN)
def login_of_account(crm_id):
    """
    Login a creator account (OnlyFans or Fansly) for a CRM panel.

    Headers: X-API-Key: {api_key}, X-Proxy: {proxy_url} (recommended for OF; not enforced)
    Body: {"email": "...", "password": "...", "platform": "onlyfans"|"fansly",
           "use_captcha": true, "proxy": "http://..." (alt)}
    """
    crm_id, error, code = verify_api_key()
    if error:
        return jsonify(error), code

    try:
        data = request.get_json()
        if not data:
            return jsonify({'error': 'Request body required'}), 400

        platform = (data.get('platform') or 'onlyfans').strip().lower()
        _log_connect_attempt(crm_id, platform, data)

        # ── Fansly password login ──────────────────────────────────────────
        # No captcha/CDN-hash/Node signer. Proxy optional. The identifier may be
        # a username OR an email (Fansly's login `username` field accepts both),
        # so it is sanitized, not validated as an email.
        if platform == 'fansly':
            identifier = sanitize_string(data.get('email'), max_length=200)
            password = validate_credential_password(data.get('password'))
            proxy = get_proxy(strict=True)  # optional for Fansly
            if not identifier:
                return jsonify({'error': 'Username or email is required'}), 400
            try:
                result = fansly_login.login(identifier, password, proxy=proxy)
            except Exception as e:
                return jsonify({'success': False, 'error': str(e)}), 401

            # 2FA challenge: stash the challenge token + device + cookies so the
            # verify-otp call can complete it, then ask the UI for the code.
            if result.get('requires_2fa'):
                db.store_2fa_session(
                    crm_id=crm_id, email=identifier,
                    otp_state=result.get('twofa_token'),
                    x_bc=result.get('fansly_client_id'), x_hash=None,
                    # store_2fa_session json-encodes this itself — pass the dict.
                    cookies=result.get('session_cookies') or {},
                    proxy=proxy, password=password,
                )
                return jsonify({
                    'success': False,
                    'requires_2fa': True,
                    'platform': 'fansly',
                    'email': identifier,
                    'twofa_type': result.get('twofa_type'),
                    # Seconds before the parked challenge is swept and the user
                    # has to log in again (config.TWO_FA_SESSION_EXPIRY).
                    'expires_in_seconds': db.get_2fa_session_remaining_seconds(
                        crm_id, identifier),
                }), 200

            if not result.get('success'):
                # Email-verification gate (link-token based, not a 6-digit code).
                return jsonify({
                    'success': False,
                    'platform': 'fansly',
                    'requires_verification': result.get('requires_verification', False),
                    'error': result.get('message') or 'Fansly login requires email verification. Connect with an auth token instead.',
                }), 200

            return jsonify(_persist_fansly_account(crm_id, identifier, password, proxy, result))

        # ── OnlyFans login (unchanged) ─────────────────────────────────────
        email = validate_email(data.get('email'))
        password = validate_credential_password(data.get('password'))
        use_captcha = data.get('use_captcha', True)
        proxy = get_proxy(strict=True)
        # proxy is optional → when absent, login egresses direct on the server IP

        # Login with proxy. OnlyFans rejects bad credentials with a 400 that
        # login_module surfaces as Exception("Login failed: <message>"). Catch it
        # and return a clean, actionable error (HTTP 400) instead of letting it
        # bubble to the global handler as an opaque 500 — so the CRM can show the
        # real reason ("Wrong email or password") to the user.
        try:
            result = login_module.login(
                email, password, use_captcha=use_captcha, proxy=proxy,
                captcha_api_key=db.get_panel_captcha_key(crm_id))
        except Exception as e:
            msg = str(e)
            reason = msg.split('Login failed:', 1)[-1].strip() if 'Login failed:' in msg else msg
            failure_code = account_status.classify_terminal_login_failure(reason)
            if failure_code:
                spec = account_status.LOGIN_FAILURES[failure_code]
                return jsonify({
                    'success': False,
                    'error': spec['message'],
                    'reason': failure_code,
                    'connection_state': 'login_failed',
                    'needs_reconnect': True,
                    'login_failure': {
                        'code': failure_code,
                        'message': spec['message'],
                        'occurred_at': _datetime.utcnow().isoformat() + 'Z',
                        'action': spec['action'],
                    },
                }), 400
            # OnlyFans' Cloudflare turned the proxy's IP away. Actionable (swap
            # the proxy), so 424 like proxy_error — never a 5xx.
            if isinstance(e, login_module.UpstreamBlockedError):
                print(f'OF login blocked by Cloudflare for crm {crm_id}: '
                      f'ip={e.blocked_ip} ray={e.ray_id}')
                return jsonify({
                    'success': False,
                    **_connect_error('proxy_blocked', blocked_ip=e.blocked_ip),
                    'reason': 'proxy_blocked',
                    'connection_state': 'proxy_blocked',
                    'retryable': True,
                    'blocked_ip': e.blocked_ip,
                    'ray_id': e.ray_id,
                }), 424
            _safe_transport_message = None
            if isinstance(e, runtime_readiness.SignedJobsPausedError):
                state, status = 'sync_blocked', 409
            elif isinstance(e, runtime_readiness.SignerUnavailableError):
                state, status = 'sync_blocked', 503
            else:
                _safe_transport_message, transport_reason = (
                    of_client_module.translate_transport_error(e))
                state = (('proxy_error' if (transport_reason or '').startswith('proxy_') else transport_reason)
                         or account_status.classify_non_login_state(reason))
                if state == 'proxy_error':
                    state, status = 'proxy_error', 424
                elif state == 'rate_limited':
                    state, status = 'rate_limited', 429
                else:
                    # 503, not 502: Cloudflare in front of this API replaces an
                    # origin 502/504 body with its own HTML page, so the JSON
                    # below would never reach the dashboard or API clients.
                    state, status = 'temporary_error', 503
            # Raw exceptions remain server-side only; the proxy wording comes
            # from the curated transport table, never from the exception.
            print(f'OF login error for crm {crm_id}: {msg}')
            payload = {
                'success': False,
                **_connect_error(state, detail=_safe_transport_message),
                'reason': state,
                'connection_state': state,
                'retryable': True,
            }
            # In the body, not a Retry-After header: flask-limiter
            # (headers_enabled) overwrites that header on every response.
            if status == 503:
                payload['retry_after'] = 30
            return jsonify(payload), status

        # Check if 2FA is required
        if result.get('requires_2fa'):
            # Store 2FA session data temporarily in database (including encrypted password for later account creation)
            db.store_2fa_session(
                crm_id=crm_id,
                email=email,
                otp_state=result['otp_state'],
                x_bc=result['x_bc'],
                x_hash=result['x_hash'],
                cookies=result['cookies'],
                proxy=proxy,
                password=password
            )

            return jsonify({
                'success': False,
                'requires_2fa': True,
                'platform': 'onlyfans',
                'otp_state': result['otp_state'],
                # Which factors OF says are available, e.g. ['email'] — derived
                # from otpState so a client doesn't have to know OF's flag names.
                'otp_methods': result.get('otp_methods') or [],
                'email': email,
                # Seconds before the parked challenge is swept and the user has
                # to log in again (config.TWO_FA_SESSION_EXPIRY).
                'expires_in_seconds': db.get_2fa_session_remaining_seconds(crm_id, email),
            })

        # Save session with CRM isolation and proxy
        mt_auth.save_session(crm_id, result['user_id'], result, proxy=proxy)

        # Fetch username, avatar, and about from /users/me using the session.
        # This probe is also the ONLY place a post-login 2FA step-up shows up:
        # OnlyFans can return 200 from /users/login (so login() reports success)
        # yet refuse every account-scoped call with error 101 until a second
        # factor is cleared — the credentials are fine, the session is just
        # gated. Without this check the account was saved looking connected with
        # a null username and nothing worked. See of_faceid / parse_otp_challenge.
        username = result['data'].get('username')
        avatar = None
        about = None

        if not username:
            try:
                me_response = mt_auth.make_authenticated_request(
                    session_data=result,
                    path='/api2/v2/users/me',
                    method='GET'
                )
                if me_response.status_code == 200:
                    me_data = me_response.json()
                    username = me_data.get('username')
                    avatar = me_data.get('avatar')
                    about = me_data.get('about')
                else:
                    challenge = None
                    try:
                        challenge = of_client_module.parse_otp_challenge(me_response.json())
                    except Exception:
                        challenge = None
                    if challenge:
                        return _handle_login_step_up(
                            crm_id, email, password, proxy, result, challenge)
            except ValidationError:
                raise
            except Exception as e:
                print(f'Warning: Failed to fetch profile data from /users/me: {e}')
                pass  # Profile data will be None if fetch fails
        else:
            # Username exists in result['data'], also try to get avatar and about from there
            avatar = result['data'].get('avatar')
            about = result['data'].get('about')

        # Save account to database with encrypted password
        db.add_of_account(
            crm_id=crm_id,
            of_user_id=result['user_id'],
            email=email,
            password=password,
            username=username,
            x_bc=result['x_bc'],
            x_hash=result['x_hash'],
            proxy=proxy,
            avatar=avatar,
            about=about
        )

        # Paid plans: start polling automatically so data flows without a manual toggle.
        _auto_enable_polling_on_connect(crm_id, result['user_id'], 'onlyfans')

        # Notify dashboard to assign this OF account to a slot. Fire-and-forget;
        # the slot is already paid for, the daily reconciler is the safety net.
        return jsonify({
            'success': True,
            'of_user_id': result['user_id'],
            'username': username,
            'email': email,
            'x_bc': result['x_bc'],
            'proxy': proxy if proxy else None,
            'avatar': avatar,
            'about': about
        })

    except ValidationError as e:
        return jsonify({'error': str(e)}), 400


@app.route('/api/crm/<crm_id>/accounts/login/cookies', methods=['POST'])
@limiter.limit(config.RATE_LIMIT_LOGIN)
def login_with_cookies(crm_id):
    """
    Connect a creator account using existing session credentials.

    OnlyFans: session cookies  -> Body: {"sess", "auth_id", "fp"?}
    Fansly:   auth-token paste  -> Body: {"platform":"fansly", "auth_token",
                                          "fansly_session_id", "fansly_client_id"?}
    Headers: X-API-Key: {api_key}, X-Proxy: {proxy_url} (recommended for OF, not enforced, optional for Fansly)
    """
    crm_id, error, code = verify_api_key()
    if error:
        return jsonify(error), code

    try:
        data = request.get_json()
        if not data:
            return jsonify({'error': 'Request body required'}), 400

        platform = (data.get('platform') or 'onlyfans').strip().lower()
        _log_connect_attempt(
            crm_id, platform, data,
            cookies={k: data.get(k) for k in
                     ('sess', 'auth_id', 'fp', 'auth_token',
                      'fansly_session_id', 'fansly_client_id')
                     if data.get(k)})

        # ── Fansly auth-token paste ────────────────────────────────────────
        # The user supplies a bearer token + session id (+ optional device id)
        # pulled from their browser. We validate by calling /account/me, then
        # persist exactly like a password login.
        if platform == 'fansly':
            auth_token = sanitize_string(data.get('auth_token'), max_length=2000)
            fansly_session_id = sanitize_string(data.get('fansly_session_id'), max_length=100)
            fansly_client_id = data.get('fansly_client_id')
            if fansly_client_id:
                fansly_client_id = sanitize_string(fansly_client_id, max_length=100)
            else:
                import fansly_header_generator as _fhg
                fansly_client_id = _fhg.generate_device_id()
            proxy = get_proxy(strict=True)  # optional for Fansly

            if not auth_token or not fansly_session_id:
                return jsonify({'error': 'auth_token and fansly_session_id are required'}), 400

            me = fansly_login.fetch_account_me(
                auth_token, fansly_client_id, fansly_session_id, None, proxy
            )
            if not me:
                return jsonify({'success': False, 'error': 'Invalid or expired Fansly auth token'}), 401

            account_id = str(me.get('id') or me.get('accountId') or '')
            if not account_id:
                return jsonify({'success': False, 'error': 'Could not resolve Fansly account id from token'}), 401
            email = me.get('email') or ''

            result = {
                'account_id': account_id,
                'auth_token': auth_token,
                'fansly_client_id': fansly_client_id,
                'fansly_session_id': fansly_session_id,
                'session_cookies': {},
                'data': me,
            }
            # No stored password for token-paste accounts (relogin won't be
            # possible — same tradeoff as OF cookie login).
            payload = _persist_fansly_account(crm_id, email, None, proxy, result, me=me)
            payload['login_method'] = 'token'
            return jsonify(payload)

        # ── OnlyFans session-cookie login (unchanged) ──────────────────────
        sess = sanitize_string(data.get('sess'), max_length=500)
        auth_id = sanitize_string(data.get('auth_id'), max_length=50)
        fp = data.get('fp')
        if fp:
            fp = sanitize_string(fp, max_length=200)
        proxy = get_proxy(strict=True)
        # proxy is optional → when absent, login egresses direct on the server IP

        if not sess or not auth_id:
            return jsonify({'error': 'sess and auth_id cookies are required'}), 400

        from curl_cffi import requests as curl_requests

        # Debug logging deliberately scrubbed — sess/auth_id/fp are session
        # tokens, and proxy URLs include user:pass credentials. Print just
        # the booleans needed for triage. Full values live in the saved
        # session file only (mode 0o600).
        print(
            f'=== COOKIE LOGIN DEBUG: auth_id_present={bool(auth_id)} '
            f'sess_present={bool(sess)} fp_present={bool(fp)} '
            f'proxy_present={bool(proxy)} ==='
        )

        # Create session with cookies
        session = curl_requests.Session(impersonate="chrome136")
        if proxy:
            session.proxies = {'http': proxy, 'https': proxy}

        # Step 0: Get initial Cloudflare cookies (same as email/pass login does)
        print('[Step 0] Getting initial Cloudflare cookies via /me...')
        init_path = '/api2/v2/users/me'
        init_sign = generate_headers(init_path, user_id=0)
        x_bc = fp if fp else init_sign['x-bc']
        print(f'  x-bc present: {bool(x_bc)}')

        init_headers = {
            'host': 'onlyfans.com',
            'connection': 'keep-alive',
            'x-of-rev': config.X_OF_REV,
            'sec-ch-ua-platform': '"Windows"',
            'x-bc': x_bc,
            'sign': init_sign['sign'],
            'sec-ch-ua': '"Not:A-Brand";v="99", "Google Chrome";v="145", "Chromium";v="145"',
            'sec-ch-ua-mobile': '?0',
            'app-token': init_sign['app-token'],
            'time': init_sign['time'],
            'user-agent': config.USER_AGENT,
            'accept': 'application/json, text/plain, */*',
            'sec-fetch-site': 'same-origin',
            'sec-fetch-mode': 'cors',
            'sec-fetch-dest': 'empty',
            'referer': 'https://onlyfans.com/',
            'accept-encoding': 'gzip, deflate, br, zstd',
            'accept-language': 'en-US,en;q=0.9'
        }

        init_url = f'{config.OF_BASE_URL}{init_path}'
        init_response = session.get(init_url, headers=init_headers)
        print(f'  Initial /me status: {init_response.status_code}')
        print(f'  Cookie names after init: {list(session.cookies.keys())}')
        print()

        # Now set the user's session cookies (after CF cookies are established)
        session.cookies.set('sess', sess, domain='.onlyfans.com', path='/')
        session.cookies.set('auth_id', str(auth_id), domain='.onlyfans.com', path='/')
        if fp:
            session.cookies.set('fp', fp, domain='.onlyfans.com', path='/')

        print(f'[Step 0.5] Session cookies installed: {list(session.cookies.keys())}')
        print()

        # Step 1: Fetch x-hash from CDN
        print('[Step 1] Fetching x-hash from OnlyFans CDN...')
        hash_url = 'https://cdn2.onlyfans.com/hash/'
        hash_headers = {
            'host': 'cdn2.onlyfans.com',
            'connection': 'keep-alive',
            'sec-ch-ua-platform': '"Windows"',
            'user-agent': config.USER_AGENT,
            'sec-ch-ua': '"Not:A-Brand";v="99", "Google Chrome";v="145", "Chromium";v="145"',
            'sec-ch-ua-mobile': '?0',
            'accept': '*/*',
            'origin': 'https://onlyfans.com',
            'sec-fetch-site': 'same-site',
            'sec-fetch-mode': 'cors',
            'sec-fetch-dest': 'empty',
            'referer': 'https://onlyfans.com/',
            'accept-encoding': 'gzip, deflate, br, zstd',
            'accept-language': 'en-US,en;q=0.9'
        }
        hash_response = session.get(hash_url, headers=hash_headers, params={'u': str(auth_id)})
        x_hash = hash_response.text.strip() if hash_response.status_code == 200 else None
        print(f'  x-hash status: {hash_response.status_code}')
        print(f'  x-hash present: {bool(x_hash)}')
        print()

        # Step 2: Verify session by calling /me with user's cookies
        print('[Step 2] Verifying session via /me...')
        me_path = '/api2/v2/users/me'
        me_sign_headers = generate_headers(me_path, user_id=0)

        me_headers = {
            'host': 'onlyfans.com',
            'connection': 'keep-alive',
            'x-of-rev': config.X_OF_REV,
            'sec-ch-ua-platform': '"Windows"',
            'x-bc': x_bc,
            'sign': me_sign_headers['sign'],
            'sec-ch-ua': '"Not:A-Brand";v="99", "Google Chrome";v="145", "Chromium";v="145"',
            'sec-ch-ua-mobile': '?0',
            'app-token': me_sign_headers['app-token'],
            'time': me_sign_headers['time'],
            'user-agent': config.USER_AGENT,
            'accept': 'application/json, text/plain, */*',
            'sec-fetch-site': 'same-origin',
            'sec-fetch-mode': 'cors',
            'sec-fetch-dest': 'empty',
            'referer': 'https://onlyfans.com/',
            'accept-encoding': 'gzip, deflate, br, zstd',
            'accept-language': 'en-US,en;q=0.9'
        }

        if x_hash:
            me_headers['x-hash'] = x_hash

        print(
            f'  Request prepared: header_count={len(me_headers)} '
            f'cookie_names={list(session.cookies.keys())}'
        )

        me_url = f'{config.OF_BASE_URL}{me_path}'
        me_response = session.get(me_url, headers=me_headers)

        print(f'  /me response status: {me_response.status_code}')

        if me_response.status_code != 200:
            return jsonify({
                'success': False,
                'error': 'Invalid or expired session cookies',
                'details': me_response.text[:500]
            }), 401

        me_data = me_response.json()

        # Check for errors in response
        if me_data.get('error'):
            return jsonify({
                'success': False,
                'error': me_data.get('error', {}).get('message', 'Session validation failed'),
                'details': me_data
            }), 401

        # Extract user info
        user_id = str(me_data.get('id'))
        username = me_data.get('username')
        avatar = me_data.get('avatar')
        about = me_data.get('about')
        email = me_data.get('email', '')

        if not user_id:
            return jsonify({
                'success': False,
                'error': 'Could not verify user from session'
            }), 401

        # Prepare session data
        session_result = {
            'user_id': user_id,
            'data': me_data,
            'cookies': {
                'sess': sess,
                'auth_id': str(auth_id),
                'fp': fp or ''
            },
            'x_hash': x_hash,
            'x_bc': x_bc,
            'session': session
        }

        # Save session with CRM isolation
        mt_auth.save_session(crm_id, user_id, session_result, proxy=proxy)

        # Save account to database (no password for cookie login)
        db.add_of_account(
            crm_id=crm_id,
            of_user_id=user_id,
            email=email,
            password=None,
            username=username,
            x_bc=x_bc,
            x_hash=x_hash,
            proxy=proxy,
            avatar=avatar,
            about=about
        )

        # Paid plans: start polling automatically so data flows without a manual toggle.
        _auto_enable_polling_on_connect(crm_id, user_id, 'onlyfans')

        return jsonify({
            'success': True,
            'of_user_id': user_id,
            'username': username,
            'email': email,
            'x_bc': x_bc,
            'proxy': proxy if proxy else None,
            'avatar': avatar,
            'about': about,
            'login_method': 'cookies'
        })

    except ValidationError as e:
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise


# login_module.verify_otp's `status` → HTTP code. Credential-shaped rejections
# read as 401; "this flow cannot work" reads as 400; a proxy OnlyFans turned
# away reads as 424; an unreachable OnlyFans reads as 503 — not 502, which
# Cloudflare in front of this API replaces with its own HTML page. The `status`
# string itself is the machine-readable contract — clients should branch on
# that, not on the code.
_OTP_FAILURE_HTTP_STATUS = {
    'invalid_code': 401,
    'code_expired': 401,
    'session_expired': 401,
    'of_rejected': 401,
    'face_id_required': 400,
    'endpoint_not_found': 400,
    'proxy_blocked': 424,
    'transport_error': 503,
}

# What to do next, for the failures whose message says only what went wrong.
_OTP_FAILURE_SUGGESTIONS = {
    'transport_error': ('Your code stays valid for a few minutes — submit it again. If this '
                        'keeps happening, start over with a different proxy.'),
    'proxy_blocked': ("Start the connection again with a different proxy — a residential or "
                      "mobile IP in the account's usual country."),
}


@app.route('/api/crm/<crm_id>/accounts/login/verify-otp', methods=['POST'])
@limiter.limit(config.RATE_LIMIT_LOGIN)
def verify_otp_account(crm_id):
    """
    Verify OTP code for 2FA login.

    Headers: X-API-Key: {api_key}, X-Proxy: {proxy_url} (required)
    Body: {"email": "...", "otp_code": "123456"}
    """
    crm_id, error, code = verify_api_key()
    if error:
        return jsonify(error), code

    try:
        data = request.get_json()
        if not data:
            return jsonify({'error': 'Request body required'}), 400

        platform = (data.get('platform') or 'onlyfans').strip().lower()
        otp_code = sanitize_string(data.get('otp_code'), max_length=10)
        if not otp_code:
            return jsonify({'error': 'OTP code required'}), 400

        # Record the 2FA-completion attempt (the password lives in the parked
        # 2FA session, not this request, so only the identifier + outcome here).
        _log_connect_attempt(crm_id, platform, data)

        # ── Fansly 2FA completion ──────────────────────────────────────────
        # The identifier may be a username, so sanitize (don't validate-as-email).
        if platform == 'fansly':
            identifier = sanitize_string(data.get('email'), max_length=200)
            session_data = db.get_2fa_session(crm_id, identifier)
            if not session_data:
                return jsonify({'error': '2FA session not found or expired. Please login again.'}), 404
            try:
                result = fansly_login.verify_twofa(
                    session_data['otp_state'], otp_code, session_data.get('x_bc'),
                    session_cookies=session_data.get('cookies'),
                    proxy=session_data.get('proxy'),
                )
            except Exception as e:
                return jsonify({'success': False, 'error': str(e)}), 401
            payload = _persist_fansly_account(
                crm_id, identifier, session_data.get('password'),
                session_data.get('proxy'), result)
            db.delete_2fa_session(crm_id, identifier)
            return jsonify(payload)

        email = validate_email(data.get('email'))

        # Retrieve 2FA session
        session_data = db.get_2fa_session(crm_id, email)
        if not session_data:
            return jsonify({'error': '2FA session not found or expired. Please login again.'}), 404

        # Verify OTP with OnlyFans
        result = login_module.verify_otp(
            email=email,
            otp_code=otp_code,
            x_bc=session_data['x_bc'],
            x_hash=session_data['x_hash'],
            cookies=session_data['cookies'],
            proxy=session_data.get('proxy')
        )

        # verify_otp never raises for an OF-side rejection — it returns a status.
        # Without this branch a wrong code would fall through to result['user_id']
        # and surface as an opaque 500 (this route has no generic handler; the
        # app-wide one turns anything raised here into "Internal server error").
        if not result.get('success'):
            status = result.get('status') or 'of_rejected'
            http_code = _OTP_FAILURE_HTTP_STATUS.get(status, 401)
            payload = {
                'success': False,
                'error': result.get('error') or 'OnlyFans rejected the code.',
                'reason': status,
                'status': status,
                'retryable': bool(result.get('retryable')),
            }
            if status == 'proxy_blocked':
                payload.update(_connect_error('proxy_blocked',
                                              blocked_ip=result.get('blocked_ip')))
                payload['blocked_ip'] = result.get('blocked_ip')
                payload['ray_id'] = result.get('ray_id')
            if status in _OTP_FAILURE_SUGGESTIONS:
                payload['suggestion'] = _OTP_FAILURE_SUGGESTIONS[status]
            if status == 'transport_error':
                payload['retry_after'] = 30
            if not payload['retryable']:
                # The parked challenge is dead — drop it so the next attempt
                # starts a fresh login instead of reusing stale cookies.
                db.delete_2fa_session(crm_id, email)
            else:
                payload['expires_in_seconds'] = db.get_2fa_session_remaining_seconds(
                    crm_id, email)
            if status == 'face_id_required':
                payload['requires_face_id'] = True
            return jsonify(payload), http_code

        # Save session with CRM isolation and proxy
        mt_auth.save_session(crm_id, result['user_id'], result, proxy=session_data.get('proxy'))

        # Fetch username, avatar, and about from result
        username = result['data'].get('username')
        avatar = result['data'].get('avatar')
        about = result['data'].get('about')

        # Save account to database with encrypted password
        db.add_of_account(
            crm_id=crm_id,
            of_user_id=result['user_id'],
            email=email,
            password=session_data.get('password'),
            username=username,
            x_bc=result['x_bc'],
            x_hash=result['x_hash'],
            proxy=session_data.get('proxy'),
            avatar=avatar,
            about=about
        )

        # Delete 2FA session after successful verification
        db.delete_2fa_session(crm_id, email)

        # Paid plans: start polling automatically so data flows without a manual toggle.
        _auto_enable_polling_on_connect(crm_id, result['user_id'], 'onlyfans')

        return jsonify({
            'success': True,
            'of_user_id': result['user_id'],
            'username': username,
            'email': email,
            'x_bc': result['x_bc'],
            'proxy': session_data.get('proxy') if session_data.get('proxy') else None,
            'avatar': avatar,
            'about': about
        })

    except ValidationError as e:
        return jsonify({'error': str(e)}), 400


# ── Country-flag geo backfill ────────────────────────────────────────────────
# The accounts table shows two flags: the proxy's real exit country and the
# OnlyFans banking country. Neither is known until we ask, and asking is slow
# (a probe through the proxy; a live OF call), so we NEVER do it on the list
# request. Instead the list enqueues a background one-shot per account that
# still needs resolving, caches the answer on of_accounts, and returns whatever
# is already cached. Flags appear on the next load and stay put after that.
GEO_BACKFILL_PER_REQUEST = 8  # cap enqueues per list load — stay under ip-api's ~45/min

_geo_inflight: set = set()
_geo_inflight_lock = threading.Lock()


def backfill_account_geo(crm_id, of_user_id):
    """Resolve + cache one account's proxy exit country and OF banking country.

    Fire-and-forget from get_accounts via the scheduler's heavy pool. Idempotent
    and cheap on repeat: it skips whatever is already resolved and dedupes
    against a concurrent run for the same account, so rapid list reloads don't
    pile up duplicate probes or burn OF quota.
    """
    key = (str(crm_id), str(of_user_id))
    with _geo_inflight_lock:
        if key in _geo_inflight:
            return
        _geo_inflight.add(key)
    try:
        account = db.get_of_account(crm_id, of_user_id)
        if not account:
            return

        # (1) Proxy exit country. `proxy_geo_for` records the proxy string the
        # cached value belongs to, so a changed proxy re-resolves and a removed
        # proxy clears — without any proxy-write path having to remember to.
        proxy = account.get('proxy')
        if proxy:
            if account.get('proxy_geo_for') != proxy:
                g = geo_mod.resolve_proxy_exit_country(proxy)
                if g:
                    db.set_proxy_geo(crm_id, of_user_id, proxy,
                                     g['country_code'], g['country'])
                else:
                    # Stamp the attempt against this proxy so a dead/unresolvable
                    # proxy isn't re-probed on every single list load.
                    db.set_proxy_geo(crm_id, of_user_id, proxy, None, None)
        elif account.get('proxy_geo_for') is not None:
            db.set_proxy_geo(crm_id, of_user_id, None, None, None)

        # (2) OnlyFans banking country, from /payouts/account.account.code.
        # OnlyFans-only; Fansly has no equivalent country on this surface.
        platform = account.get('platform') or 'onlyfans'
        if platform != 'fansly' and not account.get('profile_country_at'):
            ok, data, _status, _relogin = handle_of_request(
                crm_id, of_user_id, '/api2/v2/payouts/account',
                method='GET', proxy=proxy)
            if ok and isinstance(data, dict):
                acct = data.get('account') if isinstance(data.get('account'), dict) else data
                raw_code = (acct or {}).get('code')
                code = (raw_code.upper()
                        if isinstance(raw_code, str) and len(raw_code) == 2
                        and raw_code.isalpha() else None)
                name = (acct or {}).get('name') if code else None
                # Store whatever we got — a valid code, or a resolved "no
                # country" so we don't re-call /payouts/account every load. A
                # transient request failure leaves it null so it retries later.
                db.set_profile_country(crm_id, of_user_id, code,
                                       name if isinstance(name, str) else None)
    except Exception:
        _err_logger.warning('geo backfill failed for %s/%s',
                            crm_id, of_user_id, exc_info=True)
    finally:
        with _geo_inflight_lock:
            _geo_inflight.discard(key)


@app.route('/api/crm/<crm_id>/accounts', methods=['GET'])
# Tier deliberately unchanged — this route has been on RATE_LIMIT_SENSITIVE
# since long before the search box; changing it is a separate decision.
#
# CORRECTION to the comment that stood here, which claimed the deployed value
# is 120/min "not the 10/min both CLAUDE.md files claim". That was measured in
# a git worktree, where `.env` is absent (it is gitignored) and config.py's
# loose fallbacks apply. The deployed value is 100/min (.env sets RATE_LIMIT_SENSITIVE=100 per minute).
# RATE_LIMIT_SENSITIVE=10 per minute. Both CLAUDE.md files were right.
#
# So the concern it dismissed is real and still open: a debounced search box on
# a 10/min route gives an operator ten searches a minute before a 429. It is
# survivable now that the client renders a 429 honestly instead of as "no
# accounts connected", but if account search becomes a primary workflow at 600
# accounts this route wants its own tier — not a global loosening.
@limiter.limit(config.RATE_LIMIT_SENSITIVE)
def get_accounts(crm_id):
    """
    Get all OnlyFans accounts for a CRM panel.

    Headers: X-API-Key: {api_key}

    Query params:
      search  — substring match on username / email, or an exact of_user_id
      tag     — keep only accounts carrying this account tag

    Both filters run in SQL (see db.get_of_accounts). The response also carries
    `all_tags`: the panel's whole tag universe, computed BEFORE filtering so the
    filter control doesn't erase its own options once a tag is picked.
    """
    crm_id, error, code = verify_api_key()
    if error:
        return jsonify(error), code

    try:
        search = sanitize_string(request.args.get('search'), max_length=80,
                                 allow_empty=True)
        tag = sanitize_string(request.args.get('tag'), max_length=40,
                              allow_empty=True)
    except ValidationError as e:
        return jsonify({'error': str(e)}), 400

    accounts = db.get_of_accounts(crm_id, search=search or None, tag=tag or None)
    result = []
    include_session = request.args.get('include_session', 'false').lower() == 'true'

    # Two queries total for the whole page, regardless of account count: the
    # filtered account list above and this one tag map. Never per-account.
    tags_by_account = db.get_account_tags(crm_id)
    all_tags = sorted({t for tags in tags_by_account.values() for t in tags})

    geo_needed = []  # of_user_ids still missing a proxy/profile country flag
    for acc in accounts:
        item = dict(acc)
        item['tags'] = tags_by_account.get(str(item.get('of_user_id')), [])
        # Per-account capability matrix so the dashboard gates UI without
        # hardcoding platform names (and can't drift from the backend).
        item['capabilities'] = pf.capabilities(item.get('platform'))
        # Structured, sanitized connection state. Keep the two legacy fields
        # for older CRM consumers, but never return their old free-text reason.
        login_failure = account_status.login_failure_payload(item)
        item['needs_reconnect'] = bool(login_failure)
        if login_failure:
            item['login_failure'] = login_failure
            item['relogin_block_reason'] = login_failure['message']
        # Separate state from needs_reconnect on purpose: the credentials are
        # fine and reconnecting changes nothing — OnlyFans wants a selfie. The
        # dashboard shows a different chip and a different call to action.
        item['needs_verification'] = bool(item.get('verification_required_at'))
        if login_failure:
            item['connection_state'] = 'login_failed'
        elif item['needs_verification']:
            item['connection_state'] = 'verification_required'
        elif ((item.get('platform') or 'onlyfans') == 'onlyfans'
              and not runtime_readiness.signed_jobs_ready()):
            item['connection_state'] = 'sync_blocked'
        else:
            connection_error = account_status.connection_error_payload(item)
            if (item.get('last_connection_state') == 'sync_blocked'
                    and runtime_readiness.signed_jobs_ready()):
                connection_error = None
            if connection_error:
                item['connection_state'] = item['last_connection_state']
                item['connection_error'] = connection_error
            else:
                item['connection_state'] = 'connected'
        item.pop('last_connection_state', None)
        item.pop('last_connection_error_code', None)
        item.pop('last_connection_error_at', None)
        _otp_state = item.pop('verification_otp_state', None)
        if isinstance(_otp_state, str):
            try:
                _otp_state = json.loads(_otp_state)
            except Exception:
                _otp_state = None
        if item['needs_verification']:
            item['verification'] = {
                'required_since': item.get('verification_required_at'),
                'reason': item.get('verification_reason'),
                'otp_state': _otp_state,
                'face_required': bool((_otp_state or {}).get('forceFaceOtp')),
            }
        # Decide whether this account still needs a background geo lookup, then
        # drop the two internal bookkeeping fields from the response.
        _proxy = item.get('proxy')
        _platform = item.get('platform') or 'onlyfans'
        _needs_proxy_geo = bool(_proxy) and item.pop('proxy_geo_for', None) != _proxy
        _needs_profile_geo = (_platform != 'fansly'
                              and not item.pop('profile_country_at', None))
        item.pop('proxy_geo_for', None)
        item.pop('profile_country_at', None)
        if _needs_proxy_geo or _needs_profile_geo:
            geo_needed.append(str(item.get('of_user_id')))
        if include_session:
            try:
                from multi_tenant_auth import load_session
                session = load_session(crm_id, str(item['of_user_id']))
                if session:
                    cookies = session.get('cookies', {})
                    item['session'] = {
                        'sess': cookies.get('sess'),
                        'auth_id': cookies.get('auth_id') or str(item['of_user_id']),
                        'proxy': session.get('proxy') or item.get('proxy'),
                    }
            except Exception as e:
                item['session_error'] = str(e)
        result.append(item)

    # Kick off background geo resolution for accounts still missing a flag,
    # capped so a big panel doesn't flood ip-api / the OF API in one load. The
    # rest fill in over subsequent loads. Fire-and-forget: the response returns
    # now with whatever is already cached.
    for uid in geo_needed[:GEO_BACKFILL_PER_REQUEST]:
        try:
            scheduler_mod.run_in_background(
                backfill_account_geo, crm_id, uid, job_id_prefix='geo')
        except Exception:
            pass  # never let a scheduler hiccup break the accounts list

    return jsonify({
        'success': True,
        'count': len(result),
        'accounts': result,
        'all_tags': all_tags,
    })


@app.route('/api/crm/<crm_id>/accounts/<of_user_id>', methods=['DELETE'])
@limiter.limit(config.RATE_LIMIT_SENSITIVE)
def delete_account(crm_id, of_user_id):
    """Delete/disconnect an OnlyFans account from this CRM panel."""
    crm_id, error, code = verify_api_key()
    if error:
        return jsonify(error), code

    # Reject anything that isn't a pure-digit OF user id BEFORE we touch the
    # filesystem — protects the os.path.join below from any traversal attempt
    # like `../../etc/passwd`. The DB lookup happens to 404 today, but that's
    # incidental; this is the load-bearing check.
    try:
        of_user_id = validate_of_user_id(of_user_id)
    except ValidationError as e:
        return jsonify({'error': str(e)}), 400

    # Verify account belongs to this CRM
    account = db.get_of_account(crm_id, of_user_id)
    if not account:
        return jsonify({'error': 'Account not found'}), 404

    # ?purge=true erases the cached data now instead of tombstoning it for
    # config.ACCOUNT_DATA_RETENTION_DAYS — for an actual "delete my data"
    # request, where waiting out a retention window is the wrong answer.
    # Default (absent) keeps the undo-able path the dashboard's Disconnect
    # button relies on.
    purge_now = request.args.get('purge', '').lower() in ('1', 'true', 'yes')

    # Unschedule BEFORE touching the DB. These jobs (poll, subs/tx/campaign
    # refresh, WS listeners) are exactly the things that INSERT into the caches
    # we're about to clear — leaving them running while we delete means an
    # in-flight sync can write rows back in behind us and orphan them all over
    # again. Losing the jobs for an account whose delete then fails is the
    # cheaper failure: reconcile_accounts() re-registers them on next start.
    try:
        scheduler_mod.unschedule_account(crm_id, of_user_id)
    except Exception as e:
        print(f'[delete_account] unschedule failed: {e}')

    # Delete from database (atomic: account row + 2FA session + tombstone, or
    # + every cached row when purge_now).
    result = db.delete_of_account(crm_id, of_user_id, purge_now=purge_now)

    # Delete saved session file(s). OF sessions live at
    # saved_sessions/<crm_id>/<id>.json; Fansly sessions use a .fansly.json
    # suffix (see fansly_auth.get_session_path). Remove both unconditionally —
    # a missing file is a no-op, so no platform branch is needed.
    import os
    session_path = os.path.join('saved_sessions', crm_id, f'{of_user_id}.json')
    if os.path.exists(session_path):
        os.remove(session_path)
    try:
        import fansly_auth
        fansly_session_path = fansly_auth.get_session_path(crm_id, of_user_id)
        if os.path.exists(fansly_session_path):
            os.remove(fansly_session_path)
    except Exception as e:
        print(f'[delete_account] fansly session cleanup failed: {e}')

    # Notify dashboard so the slot is marked vacant (slot stays paid until period end).
    return jsonify({
        'success': True,
        'message': f'Account {of_user_id} disconnected',
        'data_purged': result['purged'],
        'purged_rows': result['counts'],
        # When set, reconnecting this account before this timestamp restores
        # its subscribers/transactions/fans/tags/events.
        'data_retained_until': result['purge_after'],
    })


@app.route('/api/crm/<crm_id>/accounts/<of_user_id>/notifications', methods=['GET'])
@limiter.limit(config.RATE_LIMIT_DEFAULT)
@check_account_ownership
def fetch_notifications(crm_id, of_user_id):
    """
    Fetch notifications for an OF account.

    Headers: X-API-Key: {api_key}, X-Proxy: {proxy_url} (required)
    Query: ?limit=20&proxy={proxy_url} (optional)
    """
    crm_id, error, code = verify_api_key()
    if error:
        return jsonify(error), code

    # Fansly has a real notifications feed (GET /api/v1/notifications). Its
    # endpoint takes no limit param, so ?limit is applied by the normalizer.
    _fr = _maybe_fansly(crm_id, of_user_id, 'notifications', {
        'limit': request.args.get('limit', 20),
    })
    if _fr is not None:
        return _fr

    try:
        limit = validate_numeric_param(request.args.get('limit'), 'limit', min_val=1, max_val=100, default=20)
        proxy = get_proxy()

        # If no proxy provided, get from account data
        if not proxy:
            account = db.get_of_account(crm_id, of_user_id)
            if account:
                proxy = account.get('proxy')

        # Fetch notifications with auto-relogin
        path = f'/api2/v2/users/notifications?limit={limit}&skip_users=all&format=infinite'
        success, data, status_code, relogin = handle_of_request(crm_id, of_user_id, path, method='GET', proxy=proxy)

        if not success:
            return jsonify({
                'success': False,
                'error': data.get('error', 'Failed to fetch notifications'),
                **(data if isinstance(data, dict) else {})
            }), status_code

        notifications = data.get('list', [])

        return jsonify({
            'success': True,
            'count': len(notifications),
            'notifications': notifications,
            **({"relogin": True} if relogin else {})
        })

    except ValidationError as e:
        return jsonify({'error': str(e)}), 400


@app.route('/api/crm/<crm_id>/accounts/<of_user_id>/balances', methods=['GET'])
@limiter.limit(config.RATE_LIMIT_DEFAULT)
@check_account_ownership
def fetch_balances(crm_id, of_user_id):
    """
    Fetch payout balances for an OF account.

    Headers: X-API-Key: {api_key}, X-Proxy: {proxy_url} (required)
    """
    crm_id, error, code = verify_api_key()
    if error:
        return jsonify(error), code

    blocked = _known_live_read_block(db.get_of_account(crm_id, of_user_id))
    if blocked:
        return blocked

    _fr = _maybe_fansly(crm_id, of_user_id, 'balances')
    if _fr is not None:
        return _fr

    proxy = get_proxy()

    # If no proxy provided, get from account data
    if not proxy:
        account = db.get_of_account(crm_id, of_user_id)
        if account:
            proxy = account.get('proxy')

    try:
        # Fetch balances with auto-relogin
        path = '/api2/v2/payouts/balances'
        success, data, status_code, relogin = handle_of_request(crm_id, of_user_id, path, method='GET', proxy=proxy)

        if not success:
            return jsonify({
                'success': False,
                'error': data.get('error', 'Failed to fetch balances'),
                **(data if isinstance(data, dict) else {})
            }), status_code

        # Stamp the value on the way past. The panel-wide total on the overview
        # is served from these samples, so it costs one local query instead of
        # one live OF call per account. Best-effort — never fails the request.
        if isinstance(data, dict):
            db.record_account_balance(
                crm_id, of_user_id,
                data.get('payoutAvailable'),
                data.get('payoutPending'),
                data.get('currency'),
            )

        return jsonify({
            'success': True,
            'balances': data,
            **({"relogin": True} if relogin else {})
        })
    except Exception:
        raise



@app.route('/api/crm/<crm_id>/accounts/<of_user_id>/earnings', methods=['GET'])
@limiter.limit(config.RATE_LIMIT_DEFAULT)
@check_account_ownership
def fetch_earnings(crm_id, of_user_id):
    """
    Fetch earnings chart for an OF account.

    Headers: X-API-Key: {api_key}, X-Proxy: {proxy_url} (required)
    Query: ?startDate=2025-07-06 07:02:08&withTotal=true
    """
    crm_id, error, code = verify_api_key()
    if error:
        return jsonify(error), code

    blocked = _known_live_read_block(db.get_of_account(crm_id, of_user_id))
    if blocked:
        return blocked

    # Fansly: balance-derived body + a daily series bucketed from the cached
    # wallet ledger for the requested range (series_available flags whether
    # the cache had rows to build it from).
    _fr = _maybe_fansly(crm_id, of_user_id, 'earnings', {
        'startDate': request.args.get('startDate'),
        'endDate': request.args.get('endDate'),
    })
    if _fr is not None:
        return _fr

    try:
        # Get query parameters
        start_date = request.args.get('startDate')
        end_date = request.args.get('endDate')
        with_total = request.args.get('withTotal', 'true')

        if not start_date:
            return jsonify({'error': 'startDate is required'}), 400

        # Validate date formats (basic validation)
        if not re.match(r'^\d{4}-\d{2}-\d{2}', start_date):
            return jsonify({'error': 'Invalid startDate format'}), 400
        if end_date and not re.match(r'^\d{4}-\d{2}-\d{2}', end_date):
            return jsonify({'error': 'Invalid endDate format'}), 400

        # Default endDate to now if not provided
        if not end_date:
            from datetime import datetime
            end_date = datetime.now().strftime('%Y-%m-%d %H:%M:%S')

        proxy = get_proxy()

        # If no proxy provided, get from account data
        if not proxy:
            account = db.get_of_account(crm_id, of_user_id)
            if account:
                proxy = account.get('proxy')

        # Build earnings endpoint with filters - manually encode dates
        from urllib.parse import quote
        start_encoded = quote(start_date, safe='')
        end_encoded = quote(end_date, safe='')

        path = f'/api2/v2/earnings/chart?startDate={start_encoded}&endDate={end_encoded}&withTotal={with_total}&filter%5Btotal_count%5D=total_count&filter%5Btotal_amount%5D=total_amount'

        # Fetch earnings with auto-relogin
        success, data, status_code, relogin = handle_of_request(crm_id, of_user_id, path, method='GET', proxy=proxy)

        if not success:
            return jsonify({
                'success': False,
                'error': data.get('error', 'Failed to fetch earnings') if isinstance(data, dict) else 'Failed to fetch earnings',
                **(data if isinstance(data, dict) else {})
            }), status_code

        return jsonify({
            'success': True,
            'earnings': data,
            **({"relogin": True} if relogin else {})
        })
    except Exception:
        raise



@app.route('/api/crm/<crm_id>/accounts/<of_user_id>/campaigns', methods=['GET', 'POST'])
@limiter.limit(config.RATE_LIMIT_DEFAULT)
@check_account_ownership
def campaigns(crm_id, of_user_id):
    """
    GET: Fetch campaign analytics/statistics
    POST: Create a tracking link campaign

    Headers: X-API-Key: {api_key}, X-Proxy: {proxy_url} (required)
    """
    crm_id, error, code = verify_api_key()
    if error:
        return jsonify(error), code

    if request.method == 'GET':
        blocked = _known_live_read_block(db.get_of_account(crm_id, of_user_id))
        if blocked:
            return blocked

    proxy = get_proxy()

    # If no proxy provided, get from account data
    if not proxy:
        account = db.get_of_account(crm_id, of_user_id)
        if account:
            proxy = account.get('proxy')

    # Fansly: campaigns are tracking links, read live from /api/v1/trackinglinks
    # (OF-shaped by the normalizer). Creation would be a POST to Fansly, which
    # this API never sends — clean 501 keyed on the campaigns_create capability.
    if _account_platform(crm_id, of_user_id) == 'fansly':
        if request.method == 'POST':
            body_, code_ = pf.unsupported_response('campaigns_create', 'fansly')
            return jsonify(body_), code_
        status, body = fansly_data.fetch(crm_id, of_user_id, 'campaigns', {}, proxy=proxy)
        if status == 200:
            # Same local tag merge as the OF branch (pure local SQL).
            try:
                tags_map = db.get_campaign_tags(crm_id, of_user_id)
                if tags_map:
                    for c in body.get('campaigns') or []:
                        c['tags'] = tags_map.get(str(c.get('id')), [])
            except Exception as e:
                print(f'[campaigns] tag merge failed for {crm_id}/{of_user_id}: {e}')
        return jsonify(body), status

    try:
        if request.method == 'GET':
            # Fetch campaigns with statistics
            limit = validate_numeric_param(request.args.get('limit'), 'limit', min_val=1, max_val=100, default=10)
            offset = validate_numeric_param(request.args.get('offset'), 'offset', min_val=0, default=0)
            stats = sanitize_string(request.args.get('stats', 'true'), max_length=10, allow_empty=True) or 'true'
            with_deleted = sanitize_string(request.args.get('with_deleted', '0'), max_length=10, allow_empty=True) or '0'

            path = f'/api2/v2/campaigns?limit={limit}&offset={offset}&pagination=1&with_deleted={with_deleted}&sorting_deleted=1&stats={stats}'

            success, data, status_code, relogin = handle_of_request(crm_id, of_user_id, path, method='GET', proxy=proxy)

            if not success:
                return jsonify({
                    'success': False,
                    'error': data.get('error', 'Failed to fetch campaigns') if isinstance(data, dict) else 'Failed to fetch campaigns',
                    **(data if isinstance(data, dict) else {})
                }), status_code

            campaign_list = data.get('list', [])
            # Merge local campaign tags into each row (pure local SQL — no extra
            # OF call, no quota impact). Mirrors how campaigns_earnings augments
            # the campaign view with local data.
            try:
                tags_map = db.get_campaign_tags(crm_id, of_user_id)
                if tags_map:
                    for c in campaign_list:
                        c['tags'] = tags_map.get(str(c.get('id')), [])
            except Exception as e:
                print(f'[campaigns] tag merge failed for {crm_id}/{of_user_id}: {e}')

            return jsonify({
                'success': True,
                'campaigns': campaign_list,
                'hasMore': data.get('hasMore', False),
                **({"relogin": True} if relogin else {})
            })

        else:  # POST
            # Creating a campaign issues POST /api2/v2/campaigns as the creator,
            # so it is a platform write and belongs behind the same per-account
            # switch as every other one. GET (analytics) stays ungated.
            _pol = db.get_account_polling(crm_id, of_user_id)
            if not _pol or not _pol.get('allow_of_write_actions'):
                return jsonify({
                    'success': False,
                    'error': ('writes are disabled for this account. Enable them '
                              'first: PATCH …/accounts/<of_user_id>/polling '
                              '{"allow_of_write_actions": true}'),
                    'code': 'WRITES_DISABLED',
                }), 403

            # Create campaign
            req_data = request.get_json()
            if not req_data:
                return jsonify({'error': 'Request body required'}), 400

            campaign_name = sanitize_string(req_data.get('name'), max_length=100)

            if not campaign_name:
                return jsonify({'error': 'Campaign name is required'}), 400

            path = '/api2/v2/campaigns'
            body = {'name': campaign_name}

            success, data, status_code, relogin = handle_of_request(crm_id, of_user_id, path, method='POST', body=body, proxy=proxy)

            if not success:
                return jsonify({
                    'success': False,
                    'error': data.get('error', 'Failed to create campaign') if isinstance(data, dict) else 'Failed to create campaign',
                    **(data if isinstance(data, dict) else {})
                }), status_code

            return jsonify({
                'success': True,
                'campaigns': data,
                **({"relogin": True} if relogin else {})
            })

    except ValidationError as e:
        return jsonify({'error': str(e)}), 400


@app.route('/api/crm/<crm_id>/accounts/<of_user_id>/campaigns/<campaign_id>/claimers', methods=['GET'])
@limiter.limit(config.RATE_LIMIT_DEFAULT)
@check_account_ownership
# Campaigns themselves are readable on Fansly (tracking links), but there is
# no per-link claimer/subscriber enumeration surface — keep claimers 501 with
# an honest feature name instead of the broader 'campaigns'.
@reject_fansly('campaign_claimers')
def get_campaign_claimers(crm_id, of_user_id, campaign_id):
    """
    Fetch subscribers/conversions (claimers) for a specific campaign.

    Headers: X-API-Key: {api_key}, X-Proxy: {proxy_url} (required)
    """
    crm_id, error, code = verify_api_key()
    if error:
        return jsonify(error), code

    proxy = get_proxy()

    # If no proxy provided, get from account data
    if not proxy:
        account = db.get_of_account(crm_id, of_user_id)
        if account:
            proxy = account.get('proxy')

    try:
        # Validate campaign_id format
        if not campaign_id or not isinstance(campaign_id, str):
            return jsonify({'error': 'Invalid campaign ID'}), 400
        if not campaign_id.isdigit():
            return jsonify({'error': 'Invalid campaign ID format'}), 400

        # Get query parameters
        limit = validate_numeric_param(request.args.get('limit'), 'limit', min_val=1, max_val=100, default=10)
        offset = validate_numeric_param(request.args.get('offset'), 'offset', min_val=0, default=0)
        more = sanitize_string(request.args.get('more', 'true'), max_length=10, allow_empty=True) or 'true'

        # Build API path
        path = f'/api2/v2/campaigns/{campaign_id}/claimers?more={more}&limit={limit}&offset={offset}'

        success, data, status_code, relogin = handle_of_request(crm_id, of_user_id, path, method='GET', proxy=proxy)

        if not success:
            return jsonify({
                'success': False,
                'error': data.get('error', 'Failed to fetch campaign claimers') if isinstance(data, dict) else 'Failed to fetch campaign claimers',
                **(data if isinstance(data, dict) else {})
            }), status_code

        return jsonify({
            'success': True,
            'claimers': data.get('list', []),
            'hasMore': data.get('hasMore', False),
            'count': len(data.get('list', [])),
            **({"relogin": True} if relogin else {})
        })

    except ValidationError as e:
        return jsonify({'error': str(e)}), 400


@app.route('/api/crm/<crm_id>/accounts/<of_user_id>/purchases', methods=['GET'])
@limiter.limit(config.RATE_LIMIT_DEFAULT)
@check_account_ownership
def get_purchases(crm_id, of_user_id):
    """
    Fetch purchase transactions for an OnlyFans account.

    Headers: X-API-Key: {api_key}, X-Proxy: {proxy_url} (required)
    """
    crm_id, error, code = verify_api_key()
    if error:
        return jsonify(error), code

    # Coerce paging params BEFORE the platform seam — request.args values are
    # strings, and the Fansly normalizer does offset arithmetic (a raw string
    # offset 500'd every paged Fansly request).
    try:
        _limit = validate_numeric_param(request.args.get('limit'), 'limit',
                                        min_val=1, max_val=1000, default=100)
        _offset = validate_numeric_param(request.args.get('offset'), 'offset',
                                         min_val=0, default=0)
    except ValidationError as e:
        return jsonify({'error': str(e)}), 400

    _fr = _maybe_fansly(crm_id, of_user_id, 'transactions', {
        'marker': request.args.get('marker'),
        'limit': _limit,
        'offset': _offset,
    })
    if _fr is not None:
        return _fr

    proxy = get_proxy()

    # If no proxy provided, get from account data
    if not proxy:
        account = db.get_of_account(crm_id, of_user_id)
        if account:
            proxy = account.get('proxy')

    try:
        # Get query parameters
        start_date = request.args.get('startDate', '')
        marker = request.args.get('marker', '')
        limit = validate_numeric_param(request.args.get('limit'), 'limit', min_val=1, max_val=1000, default=100)

        # Validate date format if provided
        if start_date and not re.match(r'^\d{4}-\d{2}-\d{2}', start_date):
            return jsonify({'error': 'Invalid startDate format'}), 400

        # Build query parameters with proper URL encoding
        from urllib.parse import quote
        query_params = []
        if start_date:
            start_encoded = quote(start_date, safe='')
            query_params.append(f'startDate={start_encoded}')
        if marker:
            query_params.append(f'marker={marker}')
        if limit:
            query_params.append(f'limit={limit}')

        query_string = '&'.join(query_params)
        path = f'/api2/v2/payouts/transactions?{query_string}' if query_string else '/api2/v2/payouts/transactions'

        success, data, status_code, relogin = handle_of_request(crm_id, of_user_id, path, method='GET', proxy=proxy)

        if not success:
            return jsonify({
                'success': False,
                'error': data.get('error', 'Failed to fetch purchases') if isinstance(data, dict) else 'Failed to fetch purchases',
                **(data if isinstance(data, dict) else {})
            }), status_code

        return jsonify({
            'success': True,
            'purchases': data.get('list', []),
            'marker': data.get('marker'),
            'hasMore': data.get('hasMore', False),
            'nextMarker': data.get('nextMarker'),
            'count': len(data.get('list', [])),
            **({"relogin": True} if relogin else {})
        })

    except ValidationError as e:
        return jsonify({'error': str(e)}), 400


@app.route('/api/crm/<crm_id>/accounts/<of_user_id>/subscribers', methods=['GET'])
@limiter.limit(config.RATE_LIMIT_DEFAULT)
@check_account_ownership
def get_subscribers_by_type(crm_id, of_user_id):
    """
    Get subscribers for a connected account with pagination and type filtering.

    Query Parameters:
    - limit: Number of subscribers per page (default: 10, max: 100)
    - offset: Offset for pagination (default: 0)
    - type: Subscriber type - 'all', 'active', 'expired' (default: 'all')

    Headers: X-API-Key: {api_key}, X-Proxy: {proxy_url} (required)

    Paging contract (identical on OnlyFans, Fansly and demo accounts):

      - Advance with the `nextOffset` from the response. Always pass it
        through; never compute `offset + len(list)` yourself.
      - Stop when `hasMore` is false. Do NOT stop on an empty `list`.

    Both rules exist because `offset` does not mean the same thing on both
    platforms. OnlyFans filters by type server-side, so its offset counts
    ROWS YOU RECEIVED. Fansly has no verified server-side type filter, so we
    request an unfiltered page and filter it here — its offset counts ROWS THE
    STREAM CONSUMED, which is >= what you got back. A pager that advanced by
    `len(list)` skipped every row Fansly's filter had dropped, silently losing
    subscribers; a pager that stopped on an empty page stopped early whenever
    one page happened to contain no matches. `nextOffset` + `hasMore` erase the
    difference, so one generic pager is correct on both.

    `count` is therefore the length of `list` AFTER filtering — a page-size
    readout, not a cursor. Fansly additionally returns `total` and `stats`.
    """
    crm_id, error, code = verify_api_key()
    if error:
        return jsonify(error), code

    blocked = _known_live_read_block(db.get_of_account(crm_id, of_user_id))
    if blocked:
        return blocked

    blocked = _known_live_read_block(db.get_of_account(crm_id, of_user_id))
    if blocked:
        return blocked

    proxy = get_proxy()

    # If no proxy provided, get from account data
    if not proxy:
        account = db.get_of_account(crm_id, of_user_id)
        if account:
            proxy = account.get('proxy')

    try:
        # Get query parameters
        limit = validate_numeric_param(request.args.get('limit'), 'limit', min_val=1, max_val=100, default=10)
        offset = validate_numeric_param(request.args.get('offset'), 'offset', min_val=0, default=0)
        subscriber_type = sanitize_string(request.args.get('type', 'all'), max_length=20, allow_empty=True) or 'all'

        # Validate subscriber type
        valid_types = ['all', 'active', 'expired']
        if subscriber_type not in valid_types:
            return jsonify({'error': f'Invalid type. Must be one of: {", ".join(valid_types)}'}), 400

        # Fansly: GET /api/v1/subscribers works (live-proven — the old
        # "403-blocked" assumption was wrong). One page + one batched
        # /account?ids= hydration call, normalized to the OF row shape.
        # It already emits `nextOffset` (raw rows consumed, not rows returned)
        # because its type filtering is client-side — see fetch_subscribers_page.
        if _account_platform(crm_id, of_user_id) == 'fansly':
            status_, body_ = fansly_data.fetch_subscribers_page(
                crm_id, of_user_id, limit=limit, offset=offset,
                type_=subscriber_type, proxy=proxy)
            return jsonify(body_), status_

        # For `type=all` we use /subscribers/latest — it's sorted by most recent
        # subscribe/renewal and returns richer per-user data (subscribedByData
        # with subscribeAt/expiredAt + the subscribes history). /subscribers
        # doesn't surface those.
        # For active/expired we fall back to the legacy /subscribers filter.
        if subscriber_type == 'all':
            path = (
                f'/api2/v2/subscriptions/subscribers/latest'
                f'?limit={limit}&offset={offset}&format=infinite'
                f'&filter[total_spent]=1&more=true'
            )
            result_key = 'users'
        else:
            path = (
                f'/api2/v2/subscriptions/subscribers'
                f'?limit={limit}&offset={offset}&format=infinite'
                f'&filter[total_spent]=1&type={subscriber_type}&more=true'
            )
            result_key = 'list'

        success, data, status_code, relogin = handle_of_request(crm_id, of_user_id, path, method='GET', proxy=proxy)

        if not success:
            return jsonify({
                'success': False,
                'error': data.get('error', 'Failed to fetch subscribers') if isinstance(data, dict) else 'Failed to fetch subscribers',
                **(data if isinstance(data, dict) else {})
            }), status_code

        items = data.get(result_key, []) if isinstance(data, dict) else []
        return jsonify({
            'success': True,
            'list': items,
            'hasMore': data.get('hasMore', False) if isinstance(data, dict) else False,
            'count': len(items),
            'offset': offset,
            # OF applies the type filter itself, so consumed == returned and
            # this is just offset + len(items). Emitted anyway: the contract is
            # "always follow nextOffset", and a field that exists on one
            # platform only is a field callers learn to compute by hand.
            'nextOffset': offset + len(items),
            'limit': limit,
            **({"relogin": True} if relogin else {})
        })

    except ValidationError as e:
        return jsonify({'error': str(e)}), 400


@app.route('/api/crm/<crm_id>/accounts/<of_user_id>/subscribers/refresh', methods=['POST'])
@limiter.limit(config.RATE_LIMIT_SENSITIVE)
@check_account_ownership
def refresh_subscribers(crm_id, of_user_id):
    """Kick off an async subscriber cache refresh for one account.

    Body (optional): {"mode": "delta" | "full"} — defaults to "delta".

    Returns 202 immediately with the initial RefreshJobState. The sync runs on
    the APScheduler threadpool. Progress streams over the SSE channel as
    `refresh.progress` events; the final result fires `refresh.complete`.

    The client should subscribe via /events/stream with type filters, OR poll
    /refresh/active to recover state after a page reload.
    """
    crm_id_, error, code = verify_api_key()
    if error:
        return jsonify(error), code

    # Fansly accounts run the same progress-wrapped entry point —
    # subscribers_sync dispatches them to the /api/v1/subscribers full walk
    # (delta == full there; the roster is a handful of pages).

    proxy = get_proxy()
    if not proxy:
        account = db.get_of_account(crm_id, of_user_id)
        if account:
            proxy = account.get('proxy')

    body = request.get_json(silent=True) or {}
    mode = sanitize_string(body.get('mode', 'delta'), max_length=10, allow_empty=True) or 'delta'
    if mode not in ('delta', 'full'):
        return jsonify({'success': False, 'error': "mode must be 'delta' or 'full'"}), 400

    # Reject duplicate starts — if a refresh is already running for this
    # (account, kind) let the caller know instead of queueing another. A dead
    # entry (non-terminal, no progress for REFRESH_STALE_MINUTES — e.g. the
    # one-shot job never ran, so nothing ever called finish()) is superseded
    # here rather than blocking every future refresh forever.
    existing = refresh_state.supersede_if_stale(crm_id, of_user_id, 'subs')
    if existing:
        return jsonify({
            'success': True,
            'already_running': True,
            'state': existing.to_payload(),
        }), 202

    try:
        scheduler_mod.run_in_background(
            scheduler_mod.run_subs_refresh_with_progress,
            crm_id, str(of_user_id), mode, proxy,
            job_id_prefix='subs_refresh',
        )
        # Tiny race: the bg thread creates the state entry; if the client POSTs
        # /refresh/active too quickly it might miss. Create a pending stub here
        # so the response is non-empty and /refresh/active shows it immediately.
        state = refresh_state.get(crm_id, of_user_id, 'subs')
        if state is None:
            state = refresh_state.start(crm_id, of_user_id, 'subs')
        return jsonify({
            'success': True,
            'state': state.to_payload(),
        }), 202
    except Exception:
        raise


@app.route('/api/crm/<crm_id>/accounts/<of_user_id>/subscribers/refresh/status', methods=['GET'])
@limiter.limit(config.RATE_LIMIT_DEFAULT)
@check_account_ownership
def subscribers_refresh_status(crm_id, of_user_id):
    """Return last-refreshed-at timestamp and cached counts. Does NOT hit OF."""
    crm_id_, error, code = verify_api_key()
    if error:
        return jsonify(error), code
    try:
        return jsonify({
            'success': True,
            'cache': db.subscribers_cache_summary(crm_id, of_user_id),
        })
    except Exception:
        raise


@app.route('/api/crm/<crm_id>/accounts/<of_user_id>/subscribers/cached', methods=['GET'])
@limiter.limit(config.RATE_LIMIT_DEFAULT)
@check_account_ownership
def list_cached_subscribers_route(crm_id, of_user_id):
    """Read subscribers from the local cache (populated by the 20h refresh job).

    Platform-neutral: OF rows come from the /subscribers/latest walk; Fansly
    rows from the /api/v1/subscribers full walk (subscribers_sync dispatch).
    Fansly raw payloads carry no spend aggregates — those live in the flat
    cache columns (backfilled from the wallet ledger), so the flat spend /
    lifecycle projection is merged under the raw payload (raw keys win; for OF
    they are the same numbers).

    Query:  limit, offset, type=all|active|expired
    Returns the user payloads (raw_json) plus pagination. Zero live requests.

    `is_active` (and Fansly's `status`) are recomputed from `expired_at` at
    read time, so they reflect NOW rather than whenever the last sync ran —
    see db.SUBSCRIPTION_ACTIVE_SQL. `type=` filters on the same rule.
    """
    crm_id_, error, code = verify_api_key()
    if error:
        return jsonify(error), code
    try:
        limit = validate_numeric_param(request.args.get('limit'), 'limit', min_val=1, max_val=500, default=100)
        offset = validate_numeric_param(request.args.get('offset'), 'offset', min_val=0, default=0)
        sub_type = sanitize_string(request.args.get('type', 'all'), max_length=20, allow_empty=True) or 'all'
        if sub_type not in ('all', 'active', 'expired'):
            return jsonify({'error': "type must be one of: all, active, expired"}), 400
        sort = sanitize_string(request.args.get('sort', 'subscribed_at'), max_length=20, allow_empty=True) or 'subscribed_at'
        since = request.args.get('since') or None
        until = request.args.get('until') or None

        rows, total = db.list_cached_subscribers(crm_id, of_user_id, type_=sub_type,
                                                  limit=limit, offset=offset, sort=sort,
                                                  since=since, until=until)
        import json as _json_local
        # Prefer raw_json payload (full platform fields), underlaid with the
        # flat cache columns (spend/lifecycle) — Fansly raw rows have no spend
        # keys, so the flat projection is what carries ledger-backfilled spend.
        # Raw keys win on conflict. Fall back to the flat row alone.
        _FLAT_KEYS = ('fan_of_user_id', 'username', 'display_name', 'avatar',
                      'subscribed_at', 'expired_at', 'subscribe_price',
                      'total_spent', 'spent_tips', 'spent_messages',
                      'spent_posts', 'spent_streams', 'spent_subscriptions',
                      'is_active')
        items = []
        for r in rows:
            flat = {k: r.get(k) for k in _FLAT_KEYS if r.get(k) is not None}
            raw = r.get('raw_json')
            if raw:
                try:
                    item = {**flat, **_json_local.loads(raw)}
                    # …except for liveness, where the raw payload must LOSE.
                    # raw_json is frozen at sync time, so on Fansly it carries a
                    # `status` string ('active'/'expired', from the row's status
                    # code) that goes stale exactly like the old is_active did.
                    # Leaving raw to win would have shipped a row reading
                    # status='active' next to is_active=0 in the same object.
                    # `unknown` gets overwritten too — it means we didn't
                    # recognise Fansly's status code, and the expiry timestamp
                    # is the better answer in that case, not a worse one.
                    item['is_active'] = r.get('is_active')
                    if 'status' in item:
                        item['status'] = 'active' if r.get('is_active') else 'expired'
                    items.append(item)
                    continue
                except Exception:
                    pass
            items.append({k: v for k, v in r.items() if k != 'raw_json'})

        return jsonify({
            'success': True,
            'list': items,
            'count': len(items),
            'total': total,
            'offset': offset,
            'limit': limit,
            'hasMore': (offset + len(items)) < total,
            'cache': db.subscribers_cache_summary(crm_id, of_user_id),
        })
    except ValidationError as e:
        return jsonify({'error': str(e)}), 400


# Flat projection shared by /subscribers/new — the cached route returns the
# full raw OF payload, which is overkill for "who subscribed when" tracking.
_NEW_SUB_FIELDS = ('fan_of_user_id', 'username', 'display_name', 'avatar',
                   'subscribed_at', 'expired_at', 'subscribe_price',
                   'total_spent', 'is_active')


@app.route('/api/crm/<crm_id>/accounts/<of_user_id>/subscribers/new', methods=['GET'])
@limiter.limit(config.RATE_LIMIT_DEFAULT)
@check_account_ownership
def list_new_subscribers_route(crm_id, of_user_id):
    """Incoming subscriptions with timestamps, newest first. Zero OF requests.

    Reads the local cache: the per-account poller delta-walks /subscribers
    every poll (default 120s) and the scheduled refresh backfills history,
    so `subscribed_at` covers renewals too (a renewal moves the fan's
    subscribed_at forward — "incoming subs" in the CRM sense).

    Query:  since, until   — inclusive ISO-8601 bounds on subscribed_at
            limit (1-500, default 50), offset
            type=all|active|expired (default all)

    `type=` and the returned `is_active` are evaluated against wall-clock NOW
    from each row's `expired_at`, not against the flag the last sync stored, so
    a subscription that lapsed since then reports as expired straight away.
    """
    crm_id_, error, code = verify_api_key()
    if error:
        return jsonify(error), code
    try:
        limit = validate_numeric_param(request.args.get('limit'), 'limit', min_val=1, max_val=500, default=50)
        offset = validate_numeric_param(request.args.get('offset'), 'offset', min_val=0, default=0)
        sub_type = sanitize_string(request.args.get('type', 'all'), max_length=20, allow_empty=True) or 'all'
        if sub_type not in ('all', 'active', 'expired'):
            return jsonify({'error': "type must be one of: all, active, expired"}), 400
        since = sanitize_string(request.args.get('since', ''), max_length=40, allow_empty=True) or None
        until = sanitize_string(request.args.get('until', ''), max_length=40, allow_empty=True) or None

        rows, total = db.list_cached_subscribers(crm_id, of_user_id, type_=sub_type,
                                                  limit=limit, offset=offset,
                                                  sort='subscribed_at',
                                                  since=since, until=until)
        subs = [{k: r.get(k) for k in _NEW_SUB_FIELDS} for r in rows]
        return jsonify({
            'success': True,
            'subscribers': subs,
            'count': len(subs),
            'total': total,
            'offset': offset,
            'limit': limit,
            'hasMore': (offset + len(subs)) < total,
            'window': {'since': since, 'until': until},
        })
    except ValidationError as e:
        return jsonify({'error': str(e)}), 400


@app.route('/api/crm/<crm_id>/accounts/<of_user_id>/subscribers/stats', methods=['GET'])
@limiter.limit(config.RATE_LIMIT_DEFAULT)
@check_account_ownership
def subscribers_stats_route(crm_id, of_user_id):
    """Time-bucketed counts of incoming subscriptions. Zero OF requests.

    Query:  since, until — inclusive ISO-8601 bounds on subscribed_at
            granularity=hour|day|week|month (default day)

    Buckets are ascending, contiguous, and ZERO-FILLED server-side — a quiet
    day comes back as {'count': 0}, not as a missing key, so a chart can plot
    the array directly. When both `since` and `until` are given the axis spans
    exactly that window (even if it holds no subscriptions); otherwise it spans
    the first to the last bucket that has data.

    `zero_filled` in the response is the escape hatch: it is False when the
    requested span exceeded the server's bucket ceiling (e.g. granularity=hour
    over an unbounded window), in which case the series is sparse and the
    client has to fill the gaps itself. Narrow the window or coarsen the
    granularity rather than assuming it's always True.

    Week buckets are Monday-start ISO dates.
    """
    crm_id_, error, code = verify_api_key()
    if error:
        return jsonify(error), code
    try:
        granularity = sanitize_string(request.args.get('granularity', 'day'), max_length=10, allow_empty=True) or 'day'
        if granularity not in ('hour', 'day', 'week', 'month'):
            return jsonify({'error': "granularity must be one of: hour, day, week, month"}), 400
        since = sanitize_string(request.args.get('since', ''), max_length=40, allow_empty=True) or None
        until = sanitize_string(request.args.get('until', ''), max_length=40, allow_empty=True) or None

        buckets, total, zero_filled = db.new_subscribers_timeseries(
            crm_id, of_user_id, since=since, until=until,
            granularity=granularity)
        return jsonify({
            'success': True,
            'granularity': granularity,
            'buckets': buckets,
            'zero_filled': zero_filled,
            'total_in_window': total,
            'window': {'since': since, 'until': until},
            'cache': db.subscribers_cache_summary(crm_id, of_user_id),
        })
    except ValidationError as e:
        return jsonify({'error': str(e)}), 400


@app.route('/api/crm/<crm_id>/accounts/<of_user_id>/transactions/refresh', methods=['POST'])
@limiter.limit(config.RATE_LIMIT_SENSITIVE)
@check_account_ownership
def refresh_transactions(crm_id, of_user_id):
    """Kick off an async transaction cache refresh.

    Body (optional):
      - mode: "delta" (default) — walks until known tx id; bounded initial if cache empty
      - mode: "initial" — explicit bounded first-sync window
      - days: window for initial (default 30, max 365; OnlyFans only)
      - max_pages: cap for initial (default 30, max 200; OnlyFans only)

    Fansly accounts sync the wallet ledger via fansly_sync (snowflake-cursor
    delta / full-history initial) with the same refresh_state 'tx' progress
    events over SSE.

    Returns 202 immediately. Progress streams over /events/stream as
    `refresh.progress` + `refresh.complete`."""
    crm_id_, error, code = verify_api_key()
    if error:
        return jsonify(error), code

    proxy = get_proxy()
    if not proxy:
        account = db.get_of_account(crm_id, of_user_id)
        if account:
            proxy = account.get('proxy')

    body = request.get_json(silent=True) or {}
    mode = sanitize_string(body.get('mode', 'delta'), max_length=10, allow_empty=True) or 'delta'
    if mode not in ('delta', 'initial'):
        return jsonify({'success': False, 'error': "mode must be 'delta' or 'initial'"}), 400

    try:
        days = validate_numeric_param(body.get('days'), 'days', min_val=1, max_val=365,
                                       default=transactions_sync.INITIAL_WINDOW_DAYS)
        max_pages = validate_numeric_param(body.get('max_pages'), 'max_pages',
                                            min_val=1, max_val=200,
                                            default=transactions_sync.INITIAL_MAX_PAGES)

        # Supersede a dead entry instead of returning already_running forever
        # (see the subscribers refresh route for the full rationale).
        existing = refresh_state.supersede_if_stale(crm_id, of_user_id, 'tx')
        if existing:
            return jsonify({
                'success': True,
                'already_running': True,
                'state': existing.to_payload(),
            }), 202

        if _account_platform(crm_id, of_user_id) == 'fansly':
            scheduler_mod.run_in_background(
                fansly_sync.run_fansly_tx_refresh_with_progress,
                crm_id, str(of_user_id), mode, proxy,
                job_id_prefix='tx_refresh',
            )
        else:
            scheduler_mod.run_in_background(
                scheduler_mod.run_tx_refresh_with_progress,
                crm_id, str(of_user_id), mode, proxy, days, max_pages,
                job_id_prefix='tx_refresh',
            )
        state = refresh_state.get(crm_id, of_user_id, 'tx')
        if state is None:
            state = refresh_state.start(crm_id, of_user_id, 'tx',
                                         pages_est=max_pages if mode == 'initial' else None)
        return jsonify({
            'success': True,
            'state': state.to_payload(),
        }), 202
    except ValidationError as e:
        return jsonify({'error': str(e)}), 400


@app.route('/api/crm/<crm_id>/accounts/<of_user_id>/backfill', methods=['POST'])
@limiter.limit(config.RATE_LIMIT_SENSITIVE)
@check_account_ownership
def backfill_account(crm_id, of_user_id):
    """One-shot "catch up the last N days" backfill: transactions (initial,
    bounded to `days`), subscribers (delta), then campaign claimers — so the
    tracking-link spending view is populated immediately.

    Fansly accounts run the fansly-specific backfill instead (full wallet-tx
    walk + fans harvest) — never the OF-only tx-initial/subs/campaigns steps,
    which would all fail against an account with no OF session.

    Body (optional):
      - days: window for the initial transaction walk (default 7, max 365;
        ignored for Fansly — the wallet walk is full-history, page-capped)

    Returns 202 immediately. Each sub-step streams its own `refresh.progress`
    over /events/stream (kinds: tx, subs, campaigns)."""
    crm_id_, error, code = verify_api_key()
    if error:
        return jsonify(error), code

    proxy = get_proxy()
    if not proxy:
        account = db.get_of_account(crm_id, of_user_id)
        if account:
            proxy = account.get('proxy')

    body = request.get_json(silent=True) or {}
    try:
        days = validate_numeric_param(body.get('days'), 'days', min_val=1, max_val=365,
                                       default=7)
    except ValidationError as e:
        return jsonify({'error': str(e)}), 400

    # Don't stack a second backfill if a tx sync is already mid-flight — but a
    # dead tx entry must not wedge backfill either.
    existing = refresh_state.supersede_if_stale(crm_id, of_user_id, 'tx')
    if existing:
        return jsonify({
            'success': True,
            'already_running': True,
            'state': existing.to_payload(),
        }), 202

    if _account_platform(crm_id, of_user_id) == 'fansly':
        scheduler_mod.run_in_background(
            fansly_sync.run_fansly_backfill_with_progress,
            crm_id, str(of_user_id), proxy,
            job_id_prefix='backfill',
        )
        return jsonify({'success': True, 'platform': 'fansly'}), 202

    scheduler_mod.run_in_background(
        scheduler_mod.run_backfill_with_progress,
        crm_id, str(of_user_id), proxy, int(days),
        job_id_prefix='backfill',
    )
    return jsonify({'success': True, 'days': int(days)}), 202


@app.route('/api/crm/<crm_id>/accounts/<of_user_id>/transactions/refresh/status', methods=['GET'])
@limiter.limit(config.RATE_LIMIT_DEFAULT)
@check_account_ownership
def transactions_refresh_status(crm_id, of_user_id):
    """Last-refreshed-at + counts + per-type totals. Does NOT hit OF."""
    crm_id_, error, code = verify_api_key()
    if error:
        return jsonify(error), code
    try:
        return jsonify({
            'success': True,
            'cache': db.transactions_cache_summary(crm_id, of_user_id),
        })
    except Exception:
        raise


@app.route('/api/crm/<crm_id>/accounts/<of_user_id>/transactions/cached', methods=['GET'])
@limiter.limit(config.RATE_LIMIT_DEFAULT)
@check_account_ownership
def list_cached_transactions_route(crm_id, of_user_id):
    """Read from the local transactions ledger. Zero OF requests.

    Query:
      limit, offset, type (tip/message/subscription/renewal/post/stream/chargeback/...),
      fan_id (OF user id to filter by),
      since (ISO date — inclusive lower bound on created_at),
      until (ISO date — inclusive upper bound on created_at)."""
    crm_id_, error, code = verify_api_key()
    if error:
        return jsonify(error), code
    try:
        limit = validate_numeric_param(request.args.get('limit'), 'limit', min_val=1, max_val=1000, default=100)
        offset = validate_numeric_param(request.args.get('offset'), 'offset', min_val=0, default=0)
        fan_id = request.args.get('fan_id') or None
        tx_type = request.args.get('type') or None
        since = request.args.get('since') or None
        until = request.args.get('until') or None

        rows, total = db.list_transactions_cache(crm_id, of_user_id,
                                                 fan_of_user_id=fan_id,
                                                 tx_type=tx_type,
                                                 since=since, until=until,
                                                 limit=limit, offset=offset)
        import json as _json_local
        items = []
        for r in rows:
            raw = r.get('raw_json')
            if raw:
                try:
                    items.append(_json_local.loads(raw))
                    continue
                except Exception:
                    pass
            items.append({k: v for k, v in r.items() if k != 'raw_json'})
        return jsonify({
            'success': True,
            'list': items,
            'count': len(items),
            'total': total,
            'offset': offset,
            'limit': limit,
            'hasMore': (offset + len(items)) < total,
            'cache': db.transactions_cache_summary(crm_id, of_user_id),
        })
    except ValidationError as e:
        return jsonify({'error': str(e)}), 400


@app.route('/api/crm/<crm_id>/refresh/active', methods=['GET'])
@limiter.limit(config.RATE_LIMIT_DEFAULT)
def list_active_refreshes(crm_id):
    """Return every in-flight or just-completed refresh job for this CRM.

    Used by the frontend on mount: progress bars seed themselves from this list
    immediately, then subscribe to /events/stream for live updates.

    NB: state entries linger ~3s after completion (refresh_state.COMPLETED_TTL_SECONDS)
    so a page that mounts right after a refresh finishes still shows the final
    state for a beat before the bar fades."""
    crm_id_, error, code = verify_api_key()
    if error:
        return jsonify(error), code
    try:
        jobs = [s.to_payload() for s in refresh_state.list_active(crm_id)]
        return jsonify({'success': True, 'jobs': jobs})
    except Exception:
        raise


@app.route('/api/crm/<crm_id>/accounts/<of_user_id>/refresh/<kind>/clear', methods=['POST'])
@limiter.limit(config.RATE_LIMIT_SENSITIVE)
@check_account_ownership
def clear_refresh_job(crm_id, of_user_id, kind):
    """Operator escape hatch: force a wedged refresh job to terminal state.

    The staleness supersede on the refresh routes handles the common case
    automatically, but it is a *timer* — the operator still has to wait out
    REFRESH_STALE_MINUTES, and it cannot help at all with a job that keeps
    re-stamping its progress while making none. Without this route the only
    other remedy is restarting Flask, which drops every other tenant's
    in-flight work too.

    No OF calls, so no quota is consumed. Returns 200 either way; `cleared`
    says whether there was actually something to clear.
    """
    crm_id_, error, code = verify_api_key()
    if error:
        return jsonify(error), code
    if kind not in ('subs', 'tx', 'campaigns'):
        return jsonify({'success': False,
                        'error': "kind must be one of 'subs', 'tx', 'campaigns'"}), 400
    state = refresh_state.clear(crm_id, of_user_id, kind,
                                reason='cleared via API')
    return jsonify({
        'success': True,
        'cleared': state is not None,
        'state': state.to_payload() if state else None,
    }), 200


@app.route('/api/crm/<crm_id>/accounts/<of_user_id>/campaigns/refresh', methods=['POST'])
@limiter.limit(config.RATE_LIMIT_SENSITIVE)
@check_account_ownership
def refresh_campaigns_claimers(crm_id, of_user_id):
    """Kick off an async sync of every non-empty campaign's claimer list.

    Returns 202 with the initial RefreshJobState — progress streams over
    /events/stream as `refresh.progress`/`refresh.complete` with `kind=campaigns`.
    """
    crm_id_, error, code = verify_api_key()
    if error:
        return jsonify(error), code

    # Fansly campaigns are read LIVE from /api/v1/trackinglinks — there is no
    # claimer cache to walk. Honest no-op success instead of a 501 so generic
    # API callers don't see an error for a maintenance action with nothing to do.
    if _account_platform(crm_id, of_user_id) == 'fansly':
        return jsonify({
            'success': True,
            'not_needed': True,
            'message': 'Fansly tracking links are read live — no refresh needed.',
        }), 200

    proxy = get_proxy()
    if not proxy:
        account = db.get_of_account(crm_id, of_user_id)
        if account:
            proxy = account.get('proxy')

    existing = refresh_state.supersede_if_stale(crm_id, of_user_id, 'campaigns')
    if existing:
        return jsonify({
            'success': True, 'already_running': True,
            'state': existing.to_payload(),
        }), 202

    try:
        scheduler_mod.run_in_background(
            scheduler_mod.run_campaigns_refresh_with_progress,
            crm_id, str(of_user_id), proxy,
            job_id_prefix='campaigns_refresh',
        )
        state = refresh_state.get(crm_id, of_user_id, 'campaigns')
        if state is None:
            state = refresh_state.start(crm_id, of_user_id, 'campaigns')
        return jsonify({'success': True, 'state': state.to_payload()}), 202
    except Exception:
        raise


@app.route('/api/crm/<crm_id>/accounts/<of_user_id>/campaigns/refresh/status', methods=['GET'])
@limiter.limit(config.RATE_LIMIT_DEFAULT)
@check_account_ownership
def campaigns_refresh_status(crm_id, of_user_id):
    """Last-refreshed-at + cached campaign/claimer counts. No OF calls."""
    crm_id_, error, code = verify_api_key()
    if error:
        return jsonify(error), code
    try:
        # Fansly serves campaigns live (no claimer cache) — the summary is
        # honestly all-zero; `live` tells callers that's not staleness.
        if _account_platform(crm_id, of_user_id) == 'fansly':
            return jsonify({
                'success': True,
                'live': True,
                'cache': db.campaigns_cache_summary(crm_id, of_user_id),
            })
        return jsonify({
            'success': True,
            'cache': db.campaigns_cache_summary(crm_id, of_user_id),
        })
    except Exception:
        raise


@app.route('/api/crm/<crm_id>/accounts/<of_user_id>/campaigns/earnings', methods=['GET'])
@limiter.limit(config.RATE_LIMIT_DEFAULT)
@check_account_ownership
def campaigns_earnings_route(crm_id, of_user_id):
    """Per-campaign earnings derived from the JOIN of campaign_claimers_cache
    against subscribers_cache. No OF calls — all local SQL.

    Fansly: served LIVE from /api/v1/trackinglinks instead (Fansly attributes
    per-link revenue server-side — totalGross), same response shape.

    Returns: {'earnings': [{campaign_id, claimers_count, mapped_claimers_count,
    total_spent, coverage_pct}]}"""
    crm_id_, error, code = verify_api_key()
    if error:
        return jsonify(error), code
    if _account_platform(crm_id, of_user_id) == 'fansly':
        proxy = get_proxy() or (db.get_of_account(crm_id, of_user_id) or {}).get('proxy')
        status, body = fansly_data.fetch_campaigns_earnings(crm_id, of_user_id, proxy=proxy)
        return jsonify(body), status
    try:
        rows = db.campaigns_earnings(crm_id, of_user_id)
        return jsonify({
            'success': True,
            'earnings': rows,
            'cache': db.campaigns_cache_summary(crm_id, of_user_id),
        })
    except Exception:
        raise


@app.route('/api/crm/<crm_id>/accounts/<of_user_id>/campaigns/<campaign_id>/claimers/cached',
           methods=['GET'])
@limiter.limit(config.RATE_LIMIT_DEFAULT)
@check_account_ownership
def cached_campaign_claimers(crm_id, of_user_id, campaign_id):
    """Read cached claimers for one campaign, already joined with
    subscribers_cache so each row carries total_spent + breakdown +
    mapped_spent (from tx_cache). Zero OF calls."""
    crm_id_, error, code = verify_api_key()
    if error:
        return jsonify(error), code
    try:
        limit = validate_numeric_param(request.args.get('limit'), 'limit', min_val=1, max_val=1000, default=100)
        offset = validate_numeric_param(request.args.get('offset'), 'offset', min_val=0, default=0)
        since = request.args.get('since') or None
        until = request.args.get('until') or None
        rows, total = db.list_campaign_claimers(crm_id, of_user_id, campaign_id,
                                                 limit=limit, offset=offset,
                                                 since=since, until=until)
        return jsonify({
            'success': True,
            'list': rows,
            'count': len(rows),
            'total': total,
            'offset': offset,
            'limit': limit,
            'hasMore': (offset + len(rows)) < total,
        })
    except ValidationError as e:
        return jsonify({'error': str(e)}), 400


@app.route('/api/crm/<crm_id>/accounts/<of_user_id>/fans/<fan_id>/refresh-profile',
           methods=['POST'])
@limiter.limit(config.RATE_LIMIT_SENSITIVE)
@check_account_ownership
def refresh_fan_profile(crm_id, of_user_id, fan_id):
    """Hit /users/{fan_id} once and upsert the returned user payload into
    `subscribers_cache`. Gives the fan detail drawer a force-refresh for
    their `subscribedOnData.totalSumm` without waiting for the next subs
    refresh cycle. Synchronous — single request, ~1-2s."""
    crm_id_, error, code = verify_api_key()
    if error:
        return jsonify(error), code
    proxy = get_proxy()
    if not proxy:
        account = db.get_of_account(crm_id, of_user_id)
        if account:
            proxy = account.get('proxy')
    # Fansly: refresh identity via GET /account?ids= (no subscribedOnData there —
    # spend comes from the cached wallet ledger, so subs_cache is never touched).
    if _account_platform(crm_id, of_user_id) == 'fansly':
        status_, body_ = fansly_data.fetch_fan_profile(
            crm_id, of_user_id, fan_id, proxy=proxy)
        return jsonify(body_), status_
    try:
        ok, data, status, _ = handle_of_request(
            crm_id, of_user_id, f'/api2/v2/users/{fan_id}', method='GET', proxy=proxy,
        )
        if not ok or not isinstance(data, dict):
            return jsonify({
                'success': False,
                'error': (data or {}).get('error') if isinstance(data, dict) else f'HTTP {status}',
            }), status
        # Only insert into subs_cache if this user has a subscription relationship
        # — otherwise we'd pollute the cache with non-subscribers.
        sod = data.get('subscribedOnData') or {}
        sbd = data.get('subscribedByData') or {}
        if sod or sbd:
            db.upsert_subscriber(crm_id, of_user_id, data)
        return jsonify({
            'success': True,
            'fan': data,
            'updated_cache': bool(sod or sbd),
        })
    except Exception:
        raise


@app.route('/api/crm/<crm_id>/accounts/<of_user_id>/fans/<fan_id>/transactions/cached',
           methods=['GET'])
@limiter.limit(config.RATE_LIMIT_DEFAULT)
@check_account_ownership
def cached_fan_transactions(crm_id, of_user_id, fan_id):
    """Every cached transaction for one fan. Used by the fan drawer's tx list."""
    crm_id_, error, code = verify_api_key()
    if error:
        return jsonify(error), code
    try:
        limit = validate_numeric_param(request.args.get('limit'), 'limit', min_val=1, max_val=1000, default=100)
        offset = validate_numeric_param(request.args.get('offset'), 'offset', min_val=0, default=0)
        since = request.args.get('since') or None
        until = request.args.get('until') or None
        rows, total = db.list_transactions_cache(crm_id, of_user_id,
                                                  fan_of_user_id=fan_id,
                                                  since=since, until=until,
                                                  limit=limit, offset=offset)
        import json as _json_local
        items = []
        for r in rows:
            raw = r.get('raw_json')
            if raw:
                try:
                    items.append(_json_local.loads(raw)); continue
                except Exception:
                    pass
            items.append({k: v for k, v in r.items() if k != 'raw_json'})
        # "Mapped spent" for this fan — the signed sum consistent with earnings_model
        mapped = db._fan_mapped_spend(crm_id, of_user_id, [fan_id]).get(str(fan_id), 0.0)
        return jsonify({
            'success': True,
            'list': items,
            'count': len(items),
            'total': total,
            'mapped_spent': round(mapped, 2),
            'offset': offset,
            'limit': limit,
            'hasMore': (offset + len(items)) < total,
        })
    except ValidationError as e:
        return jsonify({'error': str(e)}), 400


@app.route('/api/crm/<crm_id>/accounts/<of_user_id>/payout-account', methods=['GET'])
@limiter.limit(config.RATE_LIMIT_DEFAULT)
@check_account_ownership
def get_payout_account(crm_id, of_user_id):
    """Get payout status — combines OF's /payouts/account, /check-receive, /balances.

    Returns all signals the UI needs to decide whether a withdrawal is possible:
      - account.canPay, account.code/name (country)
      - check_receive.canReceiveManualPayout, needUpdateBanking, isVerifiedReason
      - balances.minPayoutSumm, maxPayoutSumm, payoutAvailable, payoutPending
      - can_withdraw (computed), blockers[] (list of reason codes)
    """
    crm_id, error, code = verify_api_key()
    if error:
        return jsonify(error), code
    proxy = get_proxy() or (db.get_of_account(crm_id, of_user_id) or {}).get('proxy')

    # Fansly: payout METHODS (GET /payments/payoutmethods) + wallet balance —
    # read-only; withdrawal requests stay unsupported (payouts_request=False).
    if _account_platform(crm_id, of_user_id) == 'fansly':
        status, body = fansly_data.fetch_payout_account(crm_id, of_user_id, proxy=proxy)
        return jsonify(body), status

    account_ok, account, _, _ = handle_of_request(crm_id, of_user_id, '/api2/v2/payouts/account', method='GET', proxy=proxy)
    check_ok, check, _, _ = handle_of_request(crm_id, of_user_id, '/api2/v2/payouts/check-receive', method='GET', proxy=proxy)
    bal_ok, balances, _, _ = handle_of_request(crm_id, of_user_id, '/api2/v2/payouts/balances', method='GET', proxy=proxy)

    blockers = []
    if not check_ok or not isinstance(check, dict):
        blockers.append('check_receive_failed')
    else:
        if not check.get('canReceiveManualPayout'):
            blockers.append('manual_payout_disabled')
        if check.get('needUpdateBanking'):
            blockers.append('banking_needs_update')
        if check.get('isVerifiedReason'):
            blockers.append('identity_not_verified')
    # NOTE: /payouts/account.canPay is NOT a withdrawal blocker.
    # It's about whether the creator can *pay others* (tip other creators).
    # Verified 2026-04-20: account with canPay=false still successfully made withdrawals.
    # The canonical withdrawal gate is /payouts/check-receive.canReceiveManualPayout.

    can_withdraw = len(blockers) == 0 and check_ok

    return jsonify({
        'success': True,
        'account': account if account_ok else None,
        'check_receive': check if check_ok else None,
        'balances': balances if bal_ok else None,
        'can_withdraw': can_withdraw,
        'blockers': blockers,
    })


@app.route('/api/crm/<crm_id>/accounts/<of_user_id>/payout-requests', methods=['GET'])
@limiter.limit(config.RATE_LIMIT_DEFAULT)
@check_account_ownership
def list_payout_requests(crm_id, of_user_id):
    """Get withdrawal request history.

    Fansly: served from the synced wallet ledger (transactions_cache rows with
    tx_type='payout', wallet tx type 16012) — Fansly exposes no payout-request
    GET surface, but every completed payout lands in the ledger."""
    crm_id, error, code = verify_api_key()
    if error:
        return jsonify(error), code
    if _account_platform(crm_id, of_user_id) == 'fansly':
        try:
            limit = validate_numeric_param(request.args.get('limit'), 'limit',
                                           min_val=1, max_val=1000, default=100)
            offset = validate_numeric_param(request.args.get('offset'), 'offset',
                                            min_val=0, default=0)
        except ValidationError as e:
            return jsonify({'error': str(e)}), 400
        status, body = fansly_data.payout_requests_from_cache(
            crm_id, of_user_id, limit=limit, offset=offset,
            start_date=request.args.get('startDate'),
            end_date=request.args.get('endDate'))
        return jsonify(body), status
    proxy = get_proxy() or (db.get_of_account(crm_id, of_user_id) or {}).get('proxy')
    # Optional query params: startDate, endDate, limit, offset
    qs = []
    for key in ('startDate', 'endDate', 'limit', 'offset'):
        val = request.args.get(key)
        if val:
            qs.append(f'{key}={val}')
    path = '/api2/v2/payouts/requests' + ('?' + '&'.join(qs) if qs else '')
    success, data, status, _ = handle_of_request(crm_id, of_user_id, path, method='GET', proxy=proxy)
    if not success:
        return jsonify({'success': False, 'error': data.get('error') if isinstance(data, dict) else str(data)}), status
    # OF returns list or dict with list
    requests_list = data.get('list') if isinstance(data, dict) else data
    if requests_list is None and isinstance(data, list):
        requests_list = data
    return jsonify({
        'success': True,
        'requests': requests_list if isinstance(requests_list, list) else [],
        'count': len(requests_list) if isinstance(requests_list, list) else 0,
    })


@app.route('/api/crm/<crm_id>/accounts/<of_user_id>/payout-requests', methods=['POST'])
@limiter.limit(config.RATE_LIMIT_SENSITIVE)
@check_account_ownership
# Payout READS are wired for Fansly (methods + ledger history), but creating a
# withdrawal would be a POST to Fansly — never sent; keyed on payouts_request.
@reject_fansly('payouts_request')
def create_payout_request(crm_id, of_user_id):
    """
    Create a payout/withdrawal request for an OnlyFans account.

    Headers: X-API-Key: {api_key}, X-Proxy: {proxy_url} (required)
    Body: {"withdrawal_amount": 20}
    """
    crm_id, error, code = verify_api_key()
    if error:
        return jsonify(error), code

    # Moving money is the most consequential write on the API, so it sits behind
    # the same per-account switch as DM sends. It was previously ungated: an
    # account with allow_of_write_actions=0 could still be made to request a
    # payout.
    _pol = db.get_account_polling(crm_id, of_user_id)
    if not _pol or not _pol.get('allow_of_write_actions'):
        return jsonify({
            'success': False,
            'error': ('writes are disabled for this account. Enable them first: '
                      'PATCH …/accounts/<of_user_id>/polling '
                      '{"allow_of_write_actions": true}'),
            'code': 'WRITES_DISABLED',
        }), 403

    proxy = get_proxy()

    # If no proxy provided, get from account data
    if not proxy:
        account = db.get_of_account(crm_id, of_user_id)
        if account:
            proxy = account.get('proxy')

    try:
        data = request.get_json()
        if not data:
            return jsonify({'error': 'Request body required'}), 400

        withdrawal_amount = data.get('withdrawal_amount')

        if withdrawal_amount is None:
            return jsonify({'success': False, 'error': 'withdrawal_amount is required'}), 400

        # Validate withdrawal amount
        try:
            withdrawal_amount = float(withdrawal_amount)
            if withdrawal_amount <= 0:
                raise ValueError("Amount must be positive")
            if withdrawal_amount > 100000:  # Reasonable max limit
                raise ValueError("Amount too large")
        except (ValueError, TypeError):
            return jsonify({'error': 'withdrawal_amount must be a positive number'}), 400

        # Make POST request to create payout request
        path = '/api2/v2/payouts/requests'
        payload = {'withdrawal_amount': withdrawal_amount}

        # Pre-flight: check if account can actually withdraw via OF's own validator
        # OF has /payouts/check-receive which returns canReceiveManualPayout + needUpdateBanking
        check_ok, check_data, _, _ = handle_of_request(
            crm_id, of_user_id, '/api2/v2/payouts/check-receive', method='GET', proxy=proxy
        )
        if check_ok and isinstance(check_data, dict):
            blockers = []
            if not check_data.get('canReceiveManualPayout'):
                blockers.append('Manual payouts are disabled for this account.')
            if check_data.get('needUpdateBanking'):
                blockers.append('Banking information needs to be updated in OnlyFans settings.')
            if check_data.get('isVerifiedReason'):
                blockers.append('Account identity is not verified.')
            if blockers:
                return jsonify({
                    'success': False,
                    'error': ' '.join(blockers),
                    'blockers': blockers,
                    'check_receive': check_data,
                }), 400

        # Also check the amount vs OF's minimum
        bal_ok, bal_data, _, _ = handle_of_request(
            crm_id, of_user_id, '/api2/v2/payouts/balances', method='GET', proxy=proxy
        )
        if bal_ok and isinstance(bal_data, dict):
            min_amt = bal_data.get('minPayoutSumm')
            max_amt = bal_data.get('maxPayoutSumm') or bal_data.get('payoutAvailable')
            if min_amt is not None and withdrawal_amount < float(min_amt):
                return jsonify({
                    'success': False,
                    'error': f'Amount is below the minimum payout of ${min_amt}. Please request at least ${min_amt}.',
                    'min_amount': min_amt,
                }), 400
            if max_amt is not None and withdrawal_amount > float(max_amt):
                return jsonify({
                    'success': False,
                    'error': f'Amount exceeds available balance (${max_amt}). Maximum allowed is ${max_amt}.',
                    'max_amount': max_amt,
                }), 400

        success, resp_data, status_code, relogin = handle_of_request(crm_id, of_user_id, path, method='POST', body=payload, proxy=proxy)

        if not success:
            raw_err = ''
            if isinstance(resp_data, dict):
                raw_err = str(resp_data.get('error', '')) + ' ' + str(resp_data.get('message', ''))
            else:
                raw_err = str(resp_data)

            friendly = None
            low = raw_err.lower()
            if 'minimum' in low or 'minpayoutsumm' in low.replace(' ', ''):
                friendly = 'Amount is below the minimum payout threshold.'
            elif 'maximum' in low or 'insufficient' in low or 'exceeds' in low:
                friendly = 'Amount exceeds your available balance.'
            elif 'banking' in low:
                friendly = 'Banking information is missing or invalid. Configure payout method in OnlyFans settings.'
            elif 'verif' in low:
                friendly = 'Identity verification is required before withdrawing.'
            elif status_code == 403:
                friendly = 'Withdrawals are not permitted for this account right now.'

            return jsonify({
                'success': False,
                'error': friendly or (resp_data.get('error', f'OnlyFans API returned status {status_code}') if isinstance(resp_data, dict) else f'OnlyFans API returned status {status_code}'),
                'raw_error': raw_err.strip() or None,
                **(resp_data if isinstance(resp_data, dict) else {'details': resp_data})
            }), status_code

        # OF returns {list: [{state, rejectReason, amount, invoiceId, createdAt}], marker}
        # Normalize to a flat request object at the top level for easier client consumption.
        request_obj = None
        if isinstance(resp_data, dict):
            lst = resp_data.get('list')
            if isinstance(lst, list) and lst:
                request_obj = lst[0]

        return jsonify({
            'success': True,
            'request': request_obj,
            'data': resp_data,
            **({"relogin": True} if relogin else {})
        })

    except ValidationError as e:
        return jsonify({'error': str(e)}), 400


# ============================================================================
# Referrals (OnlyFans referral programme)
# ============================================================================
#
# Three routes over four upstream OF endpoints, split the same way the payout
# routes are split:
#
#   GET /referrals                  → /api2/v2/users/me/referrals
#       the referred-user list (paginated, like /payout-requests)
#   GET /referrals/earnings         → /api2/v2/payments/referrals/balance
#                                   + /api2/v2/payouts/referrals/chart
#       composite money summary — two non-paginated signals answering one
#       question, tolerant of one source failing (like /payout-account, which
#       folds /payouts/account + /check-receive + /balances into one answer)
#   GET /referrals/payout-requests  → /api2/v2/payouts/requests/referral
#       referral payout history (paginated, mirrors /payout-requests exactly)
#
# NOT cached. Every sibling per-account money read (/balances, /earnings,
# /payout-account, /payout-requests) is an uncached live read; the caching that
# exists (earnings_cache) is there for the panel-wide /earnings/summary fan-out
# (N accounts x M chart calls), which these single-account routes are not.
# There is also no cache substrate to reuse: transactions_cache holds no
# referral-payout rows, so caching would mean a new table — out of scope.
#
# RESPONSE SHAPES ARE PASSED THROUGH, NOT MAPPED. See the per-route notes: only
# envelope keys that are confirmed by the reverse-engineering capture are read
# (`list`, `hasMore`, `marker`); every body is also returned verbatim under
# `data` so nothing is lost if an assumption is wrong.

_REFERRAL_DATE_RE = re.compile(r'^\d{4}-\d{2}-\d{2}')


def _referral_query(*names):
    """Build an OF querystring from the caller's query params.

    Only forwards params the caller actually supplied — we never inject a
    default date window, because inventing one silently truncates money
    figures and OF applies its own. Dates are validated loosely (OF wants
    "YYYY-MM-DD[ HH:MM:SS]") and every value is URL-encoded, since OF is picky
    about the space inside a datetime.
    """
    from urllib.parse import quote
    parts = []
    for name in names:
        val = request.args.get(name)
        if val is None or val == '':
            continue
        if name in ('startDate', 'endDate') and not _REFERRAL_DATE_RE.match(val):
            raise ValidationError(f'Invalid {name} format (expected YYYY-MM-DD)')
        parts.append(f'{name}={quote(str(val), safe="")}')
    return ('?' + '&'.join(parts)) if parts else ''


def _referral_error(data, status_code, fallback):
    """Turn a failed handle_of_request into a client-visible error body.

    Surfacing the upstream status (401 session dead, 403 forbidden, 404 gone)
    instead of collapsing to 200-with-empty-list is the whole point: an empty
    referral list and a broken session must not look identical.
    """
    err = fallback
    if isinstance(data, dict):
        err = data.get('error') or data.get('message') or fallback
    elif data:
        err = str(data)[:500]
    return {
        'success': False,
        'error': err if isinstance(err, str) else fallback,
        **({'details': data} if isinstance(data, dict) else {}),
    }, (status_code if isinstance(status_code, int) and status_code >= 400 else 502)


@app.route('/api/crm/<crm_id>/accounts/<of_user_id>/referrals', methods=['GET'])
@limiter.limit(config.RATE_LIMIT_DEFAULT)
@check_account_ownership
@reject_fansly('referrals')
def list_referrals(crm_id, of_user_id):
    """List the creators/users this account referred.

    Upstream: GET /api2/v2/users/me/referrals — marked verified-live in the
    reverse-engineering capture (2026-07-30) with envelope {list, hasMore}.
    Those two keys are the ONLY thing read here; the item shape inside `list`
    was not captured, so rows are passed through untouched.

    Headers: X-API-Key: {api_key}, X-Proxy: {proxy_url} (optional)
    Query: startDate, endDate, offset, marker, onlyPerformers, limit
           (all optional, all forwarded verbatim only when supplied)
    """
    crm_id, error, code = verify_api_key()
    if error:
        return jsonify(error), code
    of_user_id = validate_of_user_id(of_user_id)

    try:
        qs = _referral_query('startDate', 'endDate', 'offset', 'marker',
                             'onlyPerformers', 'limit')
    except ValidationError as e:
        return jsonify({'error': str(e)}), 400

    proxy = get_proxy() or (db.get_of_account(crm_id, of_user_id) or {}).get('proxy')
    success, data, status_code, relogin = handle_of_request(
        crm_id, of_user_id, f'/api2/v2/users/me/referrals{qs}', method='GET', proxy=proxy)
    if not success:
        body, code_ = _referral_error(data, status_code, 'Failed to fetch referrals')
        return jsonify(body), code_

    # OF returns {list: [...], hasMore: bool}; some list endpoints return a
    # bare array. Handle both without assuming anything about the items.
    if isinstance(data, list):
        items, has_more = data, False
    elif isinstance(data, dict):
        items = data.get('list')
        items = items if isinstance(items, list) else []
        has_more = bool(data.get('hasMore'))
    else:
        items, has_more = [], False

    return jsonify({
        'success': True,
        'referrals': items,
        'count': len(items),
        'hasMore': has_more,
        'data': data,
        **({'relogin': True} if relogin else {}),
    })


@app.route('/api/crm/<crm_id>/accounts/<of_user_id>/referrals/earnings', methods=['GET'])
@limiter.limit(config.RATE_LIMIT_DEFAULT)
@check_account_ownership
@reject_fansly('referrals')
def referral_earnings(crm_id, of_user_id):
    """Referral money summary — balance + chart in one response.

    Upstream:
      GET /api2/v2/payments/referrals/balance  → `balance`
      GET /api2/v2/payouts/referrals/chart     → `chart`

    Both bodies are returned VERBATIM under those keys. No field mapping:
    /payments/referrals/balance does not appear in the reverse-engineered
    capture at all (only in the hand-maintained endpoint list, which claims
    `{balance}` — unconfirmed), and the two docs disagree about the chart body
    (capture says a bare array, the hand-maintained list says
    `{total, delta, chartAmount, chartCount}`). Picking one and mapping fields
    would fabricate a contract.

    Partial failure is tolerated the way /payout-account tolerates it: a source
    that fails comes back null and `sources` records why. If BOTH fail the
    route fails with the upstream status — a dead session must not be
    indistinguishable from "no referral earnings".

    Headers: X-API-Key: {api_key}, X-Proxy: {proxy_url} (optional)
    Query: startDate, endDate, withTotal (default 1), withChart (default true),
           filter — forwarded to the chart call only.
    """
    crm_id, error, code = verify_api_key()
    if error:
        return jsonify(error), code
    of_user_id = validate_of_user_id(of_user_id)

    try:
        chart_qs = _referral_query('startDate', 'endDate', 'withTotal',
                                   'withChart', 'filter')
    except ValidationError as e:
        return jsonify({'error': str(e)}), 400
    # Reproduce the params the OF web client was captured sending, unless the
    # caller overrode them. Only these two have a captured default.
    if 'withTotal' not in request.args:
        chart_qs += ('&' if chart_qs else '?') + 'withTotal=1'
    if 'withChart' not in request.args:
        chart_qs += ('&' if chart_qs else '?') + 'withChart=true'

    proxy = get_proxy() or (db.get_of_account(crm_id, of_user_id) or {}).get('proxy')

    bal_ok, bal, bal_status, bal_relogin = handle_of_request(
        crm_id, of_user_id, '/api2/v2/payments/referrals/balance',
        method='GET', proxy=proxy)
    chart_ok, chart, chart_status, chart_relogin = handle_of_request(
        crm_id, of_user_id, f'/api2/v2/payouts/referrals/chart{chart_qs}',
        method='GET', proxy=proxy)

    if not bal_ok and not chart_ok:
        # Report the CHART failure: /payouts/referrals/chart is the endpoint
        # the capture proved live, so its status is the trustworthy signal.
        # /payments/referrals/balance appears in no capture at all, so a 404
        # from it may just mean OF retired it — that shouldn't be the error the
        # operator sees when the real problem is an expired session.
        body, code_ = _referral_error(chart, chart_status,
                                      'Failed to fetch referral earnings')
        body['sources'] = {
            'balance': {'ok': False, 'status': bal_status},
            'chart': {'ok': False, 'status': chart_status},
        }
        return jsonify(body), code_

    return jsonify({
        'success': True,
        'balance': bal if bal_ok else None,
        'chart': chart if chart_ok else None,
        'sources': {
            'balance': {'ok': bool(bal_ok), 'status': bal_status},
            'chart': {'ok': bool(chart_ok), 'status': chart_status},
        },
        **({'relogin': True} if (bal_relogin or chart_relogin) else {}),
    })


@app.route('/api/crm/<crm_id>/accounts/<of_user_id>/referrals/payout-requests',
           methods=['GET'])
@limiter.limit(config.RATE_LIMIT_DEFAULT)
@check_account_ownership
@reject_fansly('referrals')
def list_referral_payout_requests(crm_id, of_user_id):
    """Referral payout (withdrawal) history — the referral twin of
    GET /accounts/<id>/payout-requests, and shaped identically.

    Upstream: GET /api2/v2/payouts/requests/referral — marked verified-live in
    the capture (2026-07-30) with envelope {list, marker}. Only those two keys
    are read; the row shape inside `list` was not captured, so rows pass
    through untouched.

    Headers: X-API-Key: {api_key}, X-Proxy: {proxy_url} (optional)
    Query: startDate, endDate, offset, marker, limit (all optional)
    """
    crm_id, error, code = verify_api_key()
    if error:
        return jsonify(error), code
    of_user_id = validate_of_user_id(of_user_id)

    try:
        qs = _referral_query('startDate', 'endDate', 'offset', 'marker', 'limit')
    except ValidationError as e:
        return jsonify({'error': str(e)}), 400

    proxy = get_proxy() or (db.get_of_account(crm_id, of_user_id) or {}).get('proxy')
    success, data, status_code, relogin = handle_of_request(
        crm_id, of_user_id, f'/api2/v2/payouts/requests/referral{qs}',
        method='GET', proxy=proxy)
    if not success:
        body, code_ = _referral_error(
            data, status_code, 'Failed to fetch referral payout requests')
        return jsonify(body), code_

    if isinstance(data, list):
        items, marker = data, None
    elif isinstance(data, dict):
        items = data.get('list')
        items = items if isinstance(items, list) else []
        marker = data.get('marker')
    else:
        items, marker = [], None

    return jsonify({
        'success': True,
        'requests': items,
        'count': len(items),
        'marker': marker,
        'data': data,
        **({'relogin': True} if relogin else {}),
    })


@app.route('/api/crm/<crm_id>/accounts/<of_user_id>/subscription-price', methods=['GET', 'PATCH'])
@limiter.limit(config.RATE_LIMIT_SENSITIVE)
@check_account_ownership
def update_subscription_price(crm_id, of_user_id):
    """
    GET  — read the account's current subscription price live from /users/me.
           Used by the Tracking Links roster to gate eligibility: tracking links
           are an OnlyFans paid-account feature, so a price > 0 means available.
           Returns {success, subscribePrice, isFree}. Costs one OF call (quota).
           Fansly: read from /api/v1/account/me subscriptionTiers[].plans[]
           (base price = the 30-day plan of the first tier; full `tiers` list
           included, cents→dollars at the seam).
    PATCH — update subscription price for an OnlyFans account. Body: {"subscribePrice": 5}
            Fansly: 501 — a price change would be a POST this API never sends
            (capability subscription_price_update).

    Headers: X-API-Key: {api_key}, X-Proxy: {proxy_url} (required)
    """
    crm_id, error, code = verify_api_key()
    if error:
        return jsonify(error), code

    if request.method != 'GET' and _account_platform(crm_id, of_user_id) == 'fansly':
        body_, code_ = pf.unsupported_response('subscription_price_update', 'fansly')
        return jsonify(body_), code_
    # Same write gate as the CRM DM routes and the /api2/v2 passthrough — this
    # is an OnlyFans write performed as the creator.
    if request.method != 'GET':
        _pol = db.get_account_polling(crm_id, of_user_id)
        if not _pol or not _pol.get('allow_of_write_actions'):
            return jsonify({
                'success': False,
                'error': ('writes are disabled for this account. Enable them '
                          'first: PATCH …/accounts/<of_user_id>/polling '
                          '{"allow_of_write_actions": true}'),
                'code': 'WRITES_DISABLED',
            }), 403

    _fr = _maybe_fansly(crm_id, of_user_id, 'subscription_price')
    if _fr is not None:
        return _fr

    proxy = get_proxy()

    if request.method == 'GET':
        # Read-only price lookup via /users/me. Fall back to the account's
        # stored proxy when the caller didn't pass one (same as PATCH below).
        if not proxy:
            account = db.get_of_account(crm_id, of_user_id)
            if account:
                proxy = account.get('proxy')

        success, resp_data, status_code, relogin = handle_of_request(
            crm_id, of_user_id, '/api2/v2/users/me', method='GET', proxy=proxy
        )

        if not success:
            return jsonify({
                'success': False,
                'error': resp_data.get('error', f'OnlyFans API returned status {status_code}') if isinstance(resp_data, dict) else f'OnlyFans API returned status {status_code}',
            }), status_code

        # OF returns subscribePrice as a number (0 for free pages). Be tolerant
        # of a missing/None field — treat unknown as free rather than crashing.
        raw_price = resp_data.get('subscribePrice') if isinstance(resp_data, dict) else None
        try:
            price = float(raw_price) if raw_price is not None else 0.0
        except (ValueError, TypeError):
            price = 0.0

        return jsonify({
            'success': True,
            'subscribePrice': price,
            'isFree': price <= 0,
            **({"relogin": True} if relogin else {})
        })

    # If no proxy provided, get from account data
    if not proxy:
        account = db.get_of_account(crm_id, of_user_id)
        if account:
            proxy = account.get('proxy')

    try:
        data = request.get_json()
        if not data:
            return jsonify({'error': 'Request body required'}), 400

        subscribe_price = data.get('subscribePrice')

        if subscribe_price is None:
            return jsonify({'success': False, 'error': 'subscribePrice is required'}), 400

        # Validate subscribe price
        try:
            subscribe_price = float(subscribe_price)
            if subscribe_price < 0:
                raise ValueError("Price cannot be negative")
            if subscribe_price > 1000:  # Reasonable max limit
                raise ValueError("Price too high")
        except (ValueError, TypeError):
            return jsonify({'error': 'subscribePrice must be a non-negative number'}), 400

        # Make PATCH request to update subscription price
        path = '/api2/v2/users/me'
        payload = {'subscribePrice': subscribe_price}

        success, resp_data, status_code, relogin = handle_of_request(crm_id, of_user_id, path, method='PATCH', body=payload, proxy=proxy)

        if not success:
            return jsonify({
                'success': False,
                'error': resp_data.get('error', f'OnlyFans API returned status {status_code}') if isinstance(resp_data, dict) else f'OnlyFans API returned status {status_code}',
                **(resp_data if isinstance(resp_data, dict) else {'details': resp_data})
            }), status_code

        return jsonify({
            'success': True,
            'data': resp_data,
            'subscribePrice': subscribe_price,
            **({"relogin": True} if relogin else {})
        })

    except ValidationError as e:
        return jsonify({'error': str(e)}), 400


@app.route('/api/crm/<crm_id>/accounts/<of_user_id>/proxy', methods=['PATCH', 'GET'])
@limiter.limit(config.RATE_LIMIT_SENSITIVE)
@check_account_ownership
def update_account_proxy(crm_id, of_user_id):
    """
    Update or get proxy for an OnlyFans account.

    PATCH - Update proxy
    GET - Get current proxy
    """
    crm_id, error, code = verify_api_key()
    if error:
        return jsonify(error), code

    if request.method == 'GET':
        # Get current proxy
        account = db.get_of_account(crm_id, of_user_id)
        if not account:
            return jsonify({'error': 'Account not found'}), 404

        return jsonify({
            'success': True,
            'proxy': account.get('proxy')
        })

    elif request.method == 'PATCH':
        # Update proxy
        try:
            data = request.get_json()
            if not data:
                return jsonify({'error': 'Request body required'}), 400

            proxy = data.get('proxy')

            # Proxy can be None/null to remove it
            if proxy is not None and not isinstance(proxy, str):
                return jsonify({'error': 'Proxy must be a string or null'}), 400

            if proxy:
                proxy = validate_proxy(proxy)

            # Update in database
            updated = db.update_of_account_proxy(crm_id, of_user_id, proxy)

            if not updated:
                return jsonify({'error': 'Account not found'}), 404

            # Keep the saved session in sync so the change takes effect on the
            # next request. Otherwise load_session resurrects the session's old
            # stored proxy (e.g. a dead proxy) even after it's cleared for direct.
            mt_auth.update_session_proxy(crm_id, of_user_id, proxy)

            return jsonify({
                'success': True,
                'message': 'Proxy removed successfully' if not proxy else 'Proxy updated successfully',
                'proxy': proxy
            })
        except ValidationError as e:
            return jsonify({'error': str(e)}), 400


@app.route('/api/crm/<crm_id>/accounts/<of_user_id>/face-id/start', methods=['POST'])
@limiter.limit(config.RATE_LIMIT_LOGIN)
@check_account_ownership
def start_face_id(crm_id, of_user_id):
    """Begin OnlyFans' face (selfie) verification for this account.

    Body: {"source": "regular"|"banking"}  (optional, defaults to "regular")

    Returns the `verify_url` a human must open **in a browser that egresses
    from the same IP as this account's proxy** — OnlyFans ties the check to the
    session's IP, so opening it on a laptop with a different address fails the
    check rather than passing it. See FACE_ID_LOGIN_RESEARCH.md for the tunnel
    recipe.

    A watcher starts alongside and clears the account's verification flag the
    moment OnlyFans starts answering again; poll ../face-id/status or listen
    for the `verification.approved` SSE event.
    """
    crm_id, error, code = verify_api_key()
    if error:
        return jsonify(error), code

    if _account_platform(crm_id, of_user_id) == 'fansly':
        body_, code_ = pf.unsupported_response('face_id', 'fansly')
        return jsonify(body_), code_

    data = request.get_json(silent=True) or {}
    source = sanitize_string(data.get('source') or 'regular', max_length=20)
    if source not in of_faceid.FACE_ID_SOURCES:
        return jsonify({'error': 'source must be one of '
                                 f'{", ".join(of_faceid.FACE_ID_SOURCES)}'}), 400

    account = db.get_of_account(crm_id, of_user_id)
    if not account:
        return jsonify({'error': 'Account not found'}), 404

    ok, result, status = of_faceid.start_verification(
        crm_id, of_user_id, source=source, proxy=account.get('proxy'))
    if not ok:
        # /face-id/start is itself account-scoped, so a gated account can be
        # refused here too. Pass OF's own wording through — it is the only
        # thing that says *why*.
        return jsonify(result if isinstance(result, dict)
                       else {'error': str(result)[:400]}), status

    verify_url = (result or {}).get('redirectUrl') if isinstance(result, dict) else None
    if not verify_url:
        return jsonify({
            'error': 'OnlyFans started the check but returned no redirect URL.',
            'response': result,
        }), 502

    watcher = of_faceid.watch(crm_id, of_user_id, proxy=account.get('proxy'),
                              redirect_url=verify_url)
    return jsonify({
        'success': True,
        'verify_url': verify_url,
        'source': source,
        'proxy_country': account.get('proxy_country'),
        'note': ('Open verify_url from the same IP as this account\'s proxy. '
                 'The check is watched server-side; the account clears itself '
                 'once OnlyFans answers again.'),
        'status': watcher.snapshot(),
    })


@app.route('/api/crm/<crm_id>/accounts/<of_user_id>/face-id/status', methods=['GET'])
@limiter.limit(config.RATE_LIMIT_DEFAULT)
@check_account_ownership
def face_id_status(crm_id, of_user_id):
    """Where the face check stands.

    `status` is one of: pending (watcher running), approved, timeout, error,
    required (flagged but no watcher — e.g. after a restart), clear.
    Deliberately cheap: a dashboard polling its own job state
    is not an OnlyFans call and must not bill like one."""
    crm_id, error, code = verify_api_key()
    if error:
        return jsonify(error), code
    return jsonify({'success': True, **of_faceid.status(crm_id, of_user_id)})


@app.route('/api/crm/<crm_id>/accounts/<of_user_id>/face-id/postpone', methods=['POST'])
@limiter.limit(config.RATE_LIMIT_SENSITIVE)
@check_account_ownership
def postpone_face_id(crm_id, of_user_id):
    """OnlyFans' "remind me later" for an optional face check. A check with
    `forceFaceOtp` set ignores this — OF answers the same 400."""
    crm_id, error, code = verify_api_key()
    if error:
        return jsonify(error), code

    if _account_platform(crm_id, of_user_id) == 'fansly':
        body_, code_ = pf.unsupported_response('face_id', 'fansly')
        return jsonify(body_), code_

    account = db.get_of_account(crm_id, of_user_id)
    if not account:
        return jsonify({'error': 'Account not found'}), 404
    ok, result, status = of_faceid.postpone_verification(
        crm_id, of_user_id, proxy=account.get('proxy'))
    if not ok:
        return jsonify(result if isinstance(result, dict)
                       else {'error': str(result)[:400]}), status
    return jsonify({'success': True, 'response': result})


# ── Per-account 2FA confirmation ───────────────────────────────────────────
# An account can sit behind a 2FA gate (OnlyFans error 101/105) either from the
# moment it is connected (a post-login step-up) or later (a poll hits the gate
# on a session OnlyFans decided to re-challenge). Both set the same
# verification_* flag on the row, so a single set of routes confirms it from
# next to the account — no need to re-run the whole add-account flow.

_OTP_METHOD_LABELS = {'app': 'authenticator app', 'email': 'email',
                      'sms': 'text message', 'face': 'face verification'}


def _account_2fa_session(crm_id, of_user_id, account):
    """The (email, x_bc, x_hash, cookies, proxy) to submit an OTP against.

    Prefers a parked two_fa_session (the login route stashes one, and it is the
    same partial-auth context OnlyFans expects), and otherwise falls back to the
    account's saved session on disk — which is the right context when a *poll*
    tripped the gate on an already-connected account. Returns None if neither
    exists (nothing to submit against)."""
    email = account.get('email')
    proxy = account.get('proxy')
    parked = db.get_2fa_session(crm_id, email) if email else None
    if parked and parked.get('cookies') and parked.get('x_bc'):
        return {
            'email': email,
            'x_bc': parked['x_bc'],
            'x_hash': parked.get('x_hash'),
            'cookies': parked['cookies'],
            'proxy': parked.get('proxy') or proxy,
            'source': 'parked',
        }
    session = mt_auth.load_session(crm_id, of_user_id, proxy=proxy)
    if session and session.get('cookies'):
        return {
            'email': email,
            'x_bc': session.get('x_bc') or account.get('x_bc'),
            'x_hash': session.get('x_hash') or account.get('x_hash'),
            'cookies': session['cookies'],
            'proxy': session.get('proxy') or proxy,
            'source': 'saved',
        }
    return None


@app.route('/api/crm/<crm_id>/accounts/<of_user_id>/2fa/status', methods=['GET'])
@limiter.limit(config.RATE_LIMIT_DEFAULT)
@check_account_ownership
def account_2fa_status(crm_id, of_user_id):
    """Where this account's 2FA gate stands, for the confirm UI.

    Purely local (the flag + parked otpState already on the row / 2fa table) —
    it makes no OnlyFans call and is not billed, so the dashboard can poll it."""
    crm_id, error, code = verify_api_key()
    if error:
        return jsonify(error), code
    account = db.get_of_account(crm_id, of_user_id)
    if not account:
        return jsonify({'error': 'Account not found'}), 404

    otp_state = account.get('verification_otp_state')
    if isinstance(otp_state, str):
        try:
            otp_state = json.loads(otp_state)
        except Exception:
            otp_state = None
    challenge = of_client_module.parse_otp_challenge(
        {'error': {'code': 101, 'payload': {'otpState': otp_state}}}
    ) if otp_state else None
    methods = challenge['methods'] if challenge else []
    return jsonify({
        'success': True,
        'needs_2fa': bool(account.get('verification_required_at')),
        'reason': 'face_id_required' if (challenge and challenge['face_required'])
                  else ('otp_required' if methods else None),
        'methods': methods,
        'otp_state': otp_state,
        'required_since': account.get('verification_required_at'),
        'expires_in_seconds': db.get_2fa_session_remaining_seconds(
            crm_id, account.get('email')) if account.get('email') else None,
    })


@app.route('/api/crm/<crm_id>/accounts/<of_user_id>/2fa/request-code', methods=['POST'])
@limiter.limit(config.RATE_LIMIT_LOGIN)
@check_account_ownership
def account_2fa_request_code(crm_id, of_user_id):
    """Ask OnlyFans to send a code for a channel that needs one (email / sms).

    The authenticator (app) factor needs nothing sent — the code is generated on
    the user's device — so this is only meaningful for `email`/`sms`."""
    crm_id, error, code = verify_api_key()
    if error:
        return jsonify(error), code
    data = request.get_json(silent=True) or {}
    method = sanitize_string(data.get('method') or 'email', max_length=10).lower()

    account = db.get_of_account(crm_id, of_user_id)
    if not account:
        return jsonify({'error': 'Account not found'}), 404
    if method == 'app':
        return jsonify({'error': 'The authenticator app generates its own code — '
                                 'nothing to send. Enter the current 6-digit code.'}), 400
    if method == 'sms':
        path = '/api2/v2/users/otp/phone'
        http_method = 'PUT'
    else:
        path = '/api2/v2/users/otp/code'
        http_method = 'GET'

    # Deliberately NOT handle_of_request: "code sent" is a 200, and
    # handle_of_request reads any 200 as "the gate is open" and clears the
    # verification flag. The account is still gated until the code is submitted,
    # so this makes the raw session call and leaves the flag alone.
    session = mt_auth.load_session(crm_id, of_user_id, proxy=account.get('proxy'))
    if not session:
        return jsonify({'error': 'No saved session for this account. Reconnect it.'}), 409
    try:
        resp = mt_auth.make_authenticated_request(session, path, http_method)
    except Exception as e:
        return jsonify({'error': f'Could not reach OnlyFans: {e}'}), 502
    if resp.status_code != 200:
        try:
            body = resp.json()
        except Exception:
            body = {'error': f'OnlyFans returned HTTP {resp.status_code}'}
        return jsonify(body if isinstance(body, dict) else {'error': str(body)[:300]}), resp.status_code
    return jsonify({'success': True, 'method': method,
                    'message': f'OnlyFans sent a code via {_OTP_METHOD_LABELS.get(method, method)}.'})


@app.route('/api/crm/<crm_id>/accounts/<of_user_id>/2fa/submit', methods=['POST'])
@limiter.limit(config.RATE_LIMIT_LOGIN)
@check_account_ownership
def account_2fa_submit(crm_id, of_user_id):
    """Complete an account's 2FA with a typed code.

    Works whether the gate was raised at connect time (a parked two_fa_session)
    or later by a poll (submit against the account's saved session). On success
    the elevated session replaces the gated one, the flag clears, and a
    `verification.approved` SSE fires so the dashboard flips to Connected."""
    crm_id, error, code = verify_api_key()
    if error:
        return jsonify(error), code

    if _account_platform(crm_id, of_user_id) == 'fansly':
        body_, code_ = pf.unsupported_response('2fa_submit', 'fansly')
        return jsonify(body_), code_

    data = request.get_json(silent=True) or {}
    otp_code = sanitize_string(data.get('code') or data.get('otp_code'), max_length=10)
    if not otp_code:
        return jsonify({'error': 'A code is required'}), 400

    account = db.get_of_account(crm_id, of_user_id)
    if not account:
        return jsonify({'error': 'Account not found'}), 404

    ctx = _account_2fa_session(crm_id, of_user_id, account)
    if not ctx:
        return jsonify({
            'error': 'No pending session to verify against. Reconnect the account, '
                     'then enter the code.',
            'reason': 'no_session',
        }), 409

    result = login_module.verify_otp(
        email=ctx['email'], otp_code=otp_code, x_bc=ctx['x_bc'],
        x_hash=ctx['x_hash'], cookies=ctx['cookies'], proxy=ctx['proxy'])

    if not result.get('success'):
        status = result.get('status') or 'of_rejected'
        payload = {
            'success': False,
            'error': result.get('error') or 'OnlyFans rejected the code.',
            'reason': status,
            'retryable': bool(result.get('retryable')),
        }
        if status == 'face_id_required':
            payload['requires_face_id'] = True
        if payload['retryable'] and ctx['source'] == 'parked':
            payload['expires_in_seconds'] = db.get_2fa_session_remaining_seconds(
                crm_id, ctx['email'])
        return jsonify(payload), _OTP_FAILURE_HTTP_STATUS.get(status, 401)

    # Verified: the elevated session replaces the gated one.
    mt_auth.save_session(crm_id, result['user_id'], result, proxy=ctx['proxy'])
    of_client_module.mark_verified(crm_id, of_user_id)
    db.update_of_account_profile(
        crm_id, of_user_id,
        username=result['data'].get('username'),
        avatar=result['data'].get('avatar'),
        about=result['data'].get('about'))
    if ctx['email']:
        db.delete_2fa_session(crm_id, ctx['email'])

    return jsonify({
        'success': True,
        'of_user_id': result['user_id'],
        'username': result['data'].get('username'),
        'message': 'Account verified and connected.',
    })


@app.route('/api/crm/<crm_id>/accounts/<of_user_id>/request', methods=['POST'])
@limiter.limit(config.RATE_LIMIT_DEFAULT)
@check_account_ownership
def make_request(crm_id, of_user_id):
    """
    Make authenticated request to OnlyFans API.

    Headers: X-API-Key: {api_key}, X-Proxy: {proxy_url} (required)
    Body: {"path": "/api2/v2/users/me", "method": "GET", "body": {}}
    """
    crm_id, error, code = verify_api_key()
    if error:
        return jsonify(error), code

    # Fansly accounts have no OF session — forwarding would dead-end in a
    # misleading 404 'No session found'. Fail clearly instead.
    if _account_platform(crm_id, of_user_id) == 'fansly':
        body_, code_ = pf.unsupported_response('raw_request', 'fansly')
        body_['hint'] = ('This account is connected to Fansly — the raw OnlyFans '
                         'passthrough has no Fansly equivalent yet. Use the platform '
                         'data routes (/notifications, /balances, /chats, /purchases, '
                         '/earnings, ...) which are Fansly-aware.')
        return jsonify(body_), code_

    try:
        data = request.get_json()
        if not data:
            return jsonify({'error': 'Request body required'}), 400

        path = data.get('path')
        method = sanitize_string(data.get('method', 'GET'), max_length=10).upper()
        body = data.get('body')
        proxy = get_proxy()

        if not path:
            return jsonify({'error': 'Path is required'}), 400

        # This route takes its upstream method from the body, so the write gate
        # has to key off that rather than off request.method (which is always
        # POST here). Same gate as the DM routes and the /api2/v2 passthrough.
        if method != 'GET':
            _pol = db.get_account_polling(crm_id, of_user_id)
            if not _pol or not _pol.get('allow_of_write_actions'):
                return jsonify({
                    'success': False,
                    'error': ('writes are disabled for this account. Enable them '
                              'first: PATCH …/accounts/<of_user_id>/polling '
                              '{"allow_of_write_actions": true}'),
                    'code': 'WRITES_DISABLED',
                    'method': method,
                    'path': path,
                }), 403

        # Validate path format
        if not path.startswith('/'):
            return jsonify({'error': 'Path must start with /'}), 400
        if '..' in path or '//' in path:
            return jsonify({'error': 'Invalid path format'}), 400
        if len(path) > 2000:
            return jsonify({'error': 'Path too long'}), 400

        # Validate method
        valid_methods = ['GET', 'POST', 'PATCH', 'PUT', 'DELETE']
        if method not in valid_methods:
            return jsonify({'error': f'Method must be one of: {", ".join(valid_methods)}'}), 400

        # Get account data for potential re-login
        account = db.get_of_account(crm_id, of_user_id)

        # If no proxy provided, get from account data
        if not proxy and account:
            proxy = account.get('proxy')

        success, response_data, status_code, relogin = handle_of_request(crm_id, of_user_id, path, method=method, body=body, proxy=proxy)

        return jsonify({
            'success': success,
            'status_code': status_code,
            'data': response_data,
            **({"relogin": True} if relogin else {})
        }), status_code if not success and status_code != 200 else 200

    except ValidationError as e:
        return jsonify({'error': str(e)}), 400


@app.route('/api/crm/<crm_id>/api2/v2/<path:of_path>', methods=['GET', 'POST', 'PATCH', 'PUT', 'DELETE'])
@limiter.limit(config.RATE_LIMIT_DEFAULT)
def proxy_of_request(crm_id, of_path):
    """
    Transparent OF API proxy — signs and forwards requests to OnlyFans.

    The URL mirrors the OF API path. The server handles signing, session
    cookies, and authentication headers automatically.

    Headers:
        X-API-Key: {api_key} (required)
        user-id: {of_user_id} (required — which OF account to use)
        X-Proxy: {proxy_url} (required)
    """
    crm_id, error, code = verify_api_key()
    if error:
        return jsonify(error), code

    try:
        # Get OF user ID from header
        of_user_id = request.headers.get('user-id')
        if not of_user_id:
            return jsonify({'error': 'user-id header is required'}), 400
        of_user_id = validate_of_user_id(of_user_id)

        # Verify account belongs to this CRM panel
        account_row = db.get_of_account(crm_id, of_user_id)
        if not account_row:
            return jsonify({
                'error': 'Account not found or does not belong to this CRM panel',
                'crm_id': crm_id,
                'of_user_id': of_user_id
            }), 403

        # /api2/v2 is an ONLYFANS surface — a Fansly account has no OF session
        # or cookies, so the old behaviour (401 asking for sess/auth_id) was a
        # misleading dead end.
        if (account_row.get('platform') or 'onlyfans') == 'fansly':
            body_, code_ = pf.unsupported_response('raw_request', 'fansly')
            body_['hint'] = ('This account is connected to Fansly — /api2/v2/* is the '
                             'OnlyFans API surface. Use the platform data routes '
                             '(/notifications, /balances, /chats, /purchases, ...) '
                             'which are Fansly-aware.')
            return jsonify(body_), code_

        if request.method == 'GET':
            blocked = _known_live_read_block(account_row)
            if blocked:
                return blocked

        # Writes through the passthrough are gated exactly like writes through
        # the CRM routes. Without this the `allow_of_write_actions` switch was
        # trivially bypassable: POST /accounts/<id>/chats/<fan>/messages checks
        # it, while POST /api2/v2/chats/<fan>/messages performs the *same* send
        # and did not — so the safety switch only covered one of two doors to
        # the same action.
        #
        # GET is always allowed: reading is what the passthrough is mostly for,
        # and the flag is about acting as the creator, not about looking.
        if request.method != 'GET':
            polling = db.get_account_polling(crm_id, of_user_id)
            if not polling or not polling.get('allow_of_write_actions'):
                return jsonify({
                    'success': False,
                    'error': ('writes are disabled for this account. Enable them '
                              'first: PATCH …/accounts/<of_user_id>/polling '
                              '{"allow_of_write_actions": true}'),
                    'code': 'WRITES_DISABLED',
                    'method': request.method,
                    'path': f'/api2/v2/{of_path}',
                }), 403

        # Validate the user-supplied path before it's forwarded to OF. The
        # Flask <path:...> converter accepts anything (`..`, `//`, CRLF,
        # encoded bytes), and the downstream OF API client doesn't sanitize.
        # Closing this off: only allow OF API path characters, and rebuild
        # the query string from `request.args` so an attacker can't smuggle
        # raw bytes (e.g., CRLF) via the query.
        if not re.fullmatch(r'[A-Za-z0-9._\-/]+', of_path) or '..' in of_path or '//' in of_path:
            return jsonify({'error': 'Invalid OF API path'}), 400
        path = f'/api2/v2/{of_path}'
        if request.args:
            from urllib.parse import urlencode
            path = f'{path}?{urlencode(list(request.args.items(multi=True)), doseq=True)}'

        # Get request body for POST/PATCH/PUT/DELETE. A bodyless like/unlike/
        # unsend leaves body=None; the OF client defaults that to `{}` so OF
        # doesn't 400 on the content-type/empty-body mismatch (see mt_auth).
        body = None
        if request.method in ('POST', 'PATCH', 'PUT', 'DELETE') and request.is_json:
            body = request.get_json(silent=True)

        # Get proxy (optional → direct on the server IP when absent)
        proxy = get_proxy()
        if not proxy:
            account = db.get_of_account(crm_id, of_user_id)
            if account:
                proxy = account.get('proxy')

        # Auto-create session from cookies if none exists
        if not mt_auth.load_session(crm_id, of_user_id, proxy=proxy):
            sess_cookie = request.cookies.get('sess')
            auth_id_cookie = request.cookies.get('auth_id')
            fp_cookie = request.cookies.get('fp')

            if not sess_cookie or not auth_id_cookie:
                return jsonify({
                    'error': 'No session found. Provide sess and auth_id cookies (-b) on first request, or login via /accounts/login/cookies'
                }), 401

            mt_auth.auto_create_session(
                crm_id, of_user_id, sess_cookie, auth_id_cookie,
                fp=fp_cookie, proxy=proxy
            )

        # Forward to OF
        success, response_data, status_code, relogin = handle_of_request(
            crm_id, of_user_id, path, method=request.method, body=body, proxy=proxy
        )

        return jsonify({
            'success': success,
            'status_code': status_code,
            'data': response_data,
            **({"relogin": True} if relogin else {})
        }), status_code if not success and status_code != 200 else 200

    except ValidationError as e:
        return jsonify({'error': str(e)}), 400


# ============================================================================
# Earnings summary (server-side aggregation with cache)
# ============================================================================

import earnings_cache
from datetime import timedelta as _timedelta
from datetime import datetime as _datetime
from urllib.parse import quote as _quote


def _earnings_chart_path(start: str, end: str) -> str:
    """Match the exact URL the existing /earnings route uses — OF is picky:
    dates must be URL-encoded (spaces → %20), and the filter params are what
    make it return the {total: {total, gross, chartAmount, …}} shape instead
    of a bare list."""
    return (
        f"/api2/v2/earnings/chart"
        f"?startDate={_quote(start, safe='')}"
        f"&endDate={_quote(end, safe='')}"
        f"&withTotal=1"
        f"&filter%5Btotal_count%5D=total_count"
        f"&filter%5Btotal_amount%5D=total_amount"
    )


_EARNINGS_CATEGORIES = ("subscriptions", "posts", "messages", "tips", "streams", "referrals")


def _categorize_transaction(description: str) -> str:
    """Classify an OF transaction description into one of our earning buckets.

    Real shapes observed live:
      "Tip from <a href=...>L</a>"                          → tips
      "Payment for message from <a href=...>Stephon</a>"    → messages
      "Subscription from ..."  /  "Renewal from ..."         → subscriptions
      "Stream tip" / "Stream purchase"                       → streams (but "tip" wins — that's fine,
                                                              stream tips are still tips)
      "Referral payment"                                     → referrals
      "Post purchase" / "Paid post"                          → posts
    The order matters: "tip" wins over "message" when both appear.
    """
    d = (description or "").lower()
    if "tip" in d:
        return "tips"
    if "message" in d:
        return "messages"
    if "subscription" in d or "renewal" in d or "subscribe" in d:
        return "subscriptions"
    if "stream" in d:
        return "streams"
    if "referral" in d:
        return "referrals"
    if "post" in d:
        return "posts"
    # Unknown — bucket to posts rather than losing the amount
    return "posts"


def _period_range(period: str) -> tuple[str, str, str, str]:
    """Return (start, end, prev_start, prev_end) as OF-formatted datetimes."""
    now = _datetime.utcnow()
    if period == "today":
        start = now.replace(hour=0, minute=0, second=0, microsecond=0)
        prev_end = start - _timedelta(microseconds=1)
        prev_start = prev_end.replace(hour=0, minute=0, second=0, microsecond=0)
    elif period == "week":
        day_of_week = now.weekday()  # Monday = 0
        start = (now - _timedelta(days=day_of_week)).replace(
            hour=0, minute=0, second=0, microsecond=0
        )
        prev_end = start - _timedelta(microseconds=1)
        prev_start = start - _timedelta(days=7)
    else:  # month
        start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
        prev_end = start - _timedelta(microseconds=1)
        if start.month == 1:
            prev_start = start.replace(year=start.year - 1, month=12)
        else:
            prev_start = start.replace(month=start.month - 1)

    def fmt(d):
        return d.strftime("%Y-%m-%d %H:%M:%S")

    return fmt(start), fmt(now), fmt(prev_start), fmt(prev_end)


def _custom_range(start_iso: str, end_iso: str) -> tuple[str, str, str, str]:
    """Build (start, end, prev_start, prev_end) from caller-supplied dates.

    ``start_iso`` / ``end_iso`` may be YYYY-MM-DD or full ISO-8601. Date-only
    inputs are extended to inclusive whole-day bounds (00:00:00 → 23:59:59).
    The previous-period window is the same length, immediately preceding
    the current one, so the dashboard's delta% comparison still makes sense.
    """
    def parse(s: str, end_of_day: bool) -> _datetime:
        s = s.strip()
        # Date-only — expand to full day.
        if len(s) == 10 and s[4] == '-' and s[7] == '-':
            d = _datetime.strptime(s, "%Y-%m-%d")
            return d.replace(hour=23, minute=59, second=59) if end_of_day else d
        # Strip trailing Z and any timezone offset — we treat everything UTC.
        s = s.rstrip('Z')
        for fmt_ in ("%Y-%m-%dT%H:%M:%S", "%Y-%m-%d %H:%M:%S",
                     "%Y-%m-%dT%H:%M:%S.%f"):
            try:
                return _datetime.strptime(s, fmt_)
            except ValueError:
                continue
        raise ValueError(f"Unparseable date: {s}")

    start = parse(start_iso, end_of_day=False)
    end = parse(end_iso, end_of_day=True)
    span = end - start
    prev_end = start - _timedelta(microseconds=1)
    prev_start = prev_end - span

    def fmt(d):
        return d.strftime("%Y-%m-%d %H:%M:%S")

    return fmt(start), fmt(end), fmt(prev_start), fmt(prev_end)


def _total_from_chart(chart_data) -> float:
    """Extract the net-earnings total from an earnings/chart response. OF can
    return ``total`` as a dict ({total, gross, net, …}) or as a number."""
    if not isinstance(chart_data, dict):
        return 0.0
    t = chart_data.get("total")
    if isinstance(t, dict):
        # Prefer explicit net if present, else fall back to ``total`` which is
        # net in the creator-facing chart.
        for k in ("net", "total"):
            v = t.get(k)
            if v is not None:
                try:
                    return float(v)
                except (TypeError, ValueError):
                    pass
        return 0.0
    if isinstance(t, (int, float)):
        return float(t)
    return 0.0


# An account whose transactions cache hasn't been refreshed in this long is
# reported as stale, so the UI can say "as of HH:MM" instead of implying live.
# Comfortably above the 6h idle tx-refresh cadence plus one missed run.
EARNINGS_STALE_AFTER_SECONDS = int(
    os.environ.get("EARNINGS_STALE_AFTER_SECONDS", 8 * 3600)
)


def _parse_db_datetime(value):
    """Best-effort parse of the timestamp formats this database actually holds.

    Columns are written from several places over the project's life: some use
    `datetime.isoformat()` (a 'T' separator, sometimes microseconds), some use
    SQLite's own `datetime('now')` (a space, no microseconds). Returns None
    rather than raising — a freshness annotation must never break the sum it
    annotates.
    """
    if not value:
        return None
    s = str(value).replace("T", " ").replace("Z", "").strip()
    if "+" in s:
        s = s.split("+", 1)[0].strip()
    for fmt_ in ("%Y-%m-%d %H:%M:%S.%f", "%Y-%m-%d %H:%M:%S", "%Y-%m-%d"):
        try:
            return _datetime.strptime(s, fmt_)
        except ValueError:
            continue
    return None


def _day_range(start: str, end: str) -> list:
    """Every calendar day in [start, end] as 'YYYY-MM-DD', inclusive.

    Used to zero-fill the earnings chart. Bounded at 400 entries so a caller
    asking for a decade-wide custom range can't turn one response into a
    multi-megabyte array.
    """
    s = _parse_db_datetime(start)
    e = _parse_db_datetime(end)
    if s is None or e is None or e < s:
        return []
    days = []
    cur = s.replace(hour=0, minute=0, second=0, microsecond=0)
    last = e.replace(hour=0, minute=0, second=0, microsecond=0)
    while cur <= last and len(days) < 400:
        days.append(cur.strftime("%Y-%m-%d"))
        cur += _timedelta(days=1)
    return days


def _compute_earnings_summary(crm_id: str, period: str,
                                start_iso: str | None = None,
                                end_iso: str | None = None) -> dict:
    """Panel-wide earnings, summed from transactions_cache in a single query.

    This used to loop over accounts making 3-7 LIVE OnlyFans calls each: an
    earnings chart for the period, another for the previous period, and a paged
    transactions walk capped at 500 rows. At ~2s per account that is 20-25
    minutes for 600 accounts against a 120s cache TTL for `today` — the
    computation could never finish before its own cache expired, so the summary
    never converged, it just started over. It also silently truncated any
    account with more than 500 transactions in the period.

    The cache behind this is kept warm by the tx-refresh jobs: every 10 minutes
    for polling-enabled accounts, every TX_REFRESH_IDLE_MINUTES for the rest.
    Both are registered by scheduler.reconcile_accounts — before that change
    only polling-enabled accounts had the job at all, which is precisely why
    this route could not switch to the cache earlier without under-reporting
    for accounts whose polling was off.

    Because the numbers are only as fresh as those jobs, the response reports
    staleness explicitly instead of presenting a cached sum as a live one.
    """
    # Custom date range short-circuits the named-period path. When both are
    # supplied the period string is just a label for the cache key (caller
    # passes "custom:<startIso>:<endIso>" or similar).
    prev_cut = None
    if start_iso and end_iso:
        start, end, prev_start, prev_end = _custom_range(start_iso, end_iso)
    else:
        start, end, prev_start, prev_end = _period_range(period)
        # "Same point last period": the previous period truncated to the same
        # elapsed span, so Wednesday-so-far is compared with last Monday-to-
        # Wednesday rather than with all of last week (which made every trend
        # read as a drop early in a period). Capped at this period's start —
        # the previous period is [prev_start, start).
        s_dt, e_dt, ps_dt = (_parse_db_datetime(start), _parse_db_datetime(end),
                             _parse_db_datetime(prev_start))
        if s_dt and e_dt and ps_dt:
            prev_cut = min(ps_dt + (e_dt - s_dt), s_dt).strftime("%Y-%m-%d %H:%M:%S")
    accounts = db.get_of_accounts(crm_id)

    # ONE query for the whole panel, both platforms. Fansly wallet-ledger rows
    # land in the same transactions_cache table (written by fansly_sync), so
    # they are already included — there is no separate per-account pass.
    total, prev_total, chart_by_day, cats, tx_count, split = db.panel_earnings_from_cache(
        crm_id, start, end, prev_start, prev_end,
        with_platform=True, prev_cut=prev_cut,
    )

    by_category = {k: 0.0 for k in _EARNINGS_CATEGORIES}
    for k, v in (cats or {}).items():
        if k in by_category:
            by_category[k] += v
    by_category_platform = {
        k: {p: round(v, 2) for p, v in (split['by_category_platform'].get(k) or {}).items()}
        for k in _EARNINGS_CATEGORIES
    }

    # ---- freshness --------------------------------------------------------
    # A sum over a stale cache is not wrong, it is old — and the only dishonest
    # thing available here is to not say which. Both platforms are stamped in
    # last_transactions_refresh_at: OF by the tx-refresh job, Fansly by
    # fansly_sync (scheduled wallet refresh and the poll-cycle delta alike).
    # Fansly used to be judged by last_polled_at, which advances even when
    # every call in the cycle failed.
    tx_freshness = db.panel_tx_freshness(crm_id)
    now = _datetime.utcnow()
    stale_accounts = 0
    never_synced = 0
    oldest_sync = None
    has_fansly = False
    fansly_available = fansly_pending = fansly_current = 0.0
    fansly_accounts = 0
    fansly_sampled = 0
    fansly_pending_sampled = 0
    fansly_oldest_sample = fansly_newest_sample = None
    plat_fresh = {}

    for acc in accounts:
        of_user_id = acc.get("of_user_id")
        if not of_user_id:
            continue
        plat = (acc.get("platform") or "onlyfans")
        pf_stats = plat_fresh.setdefault(plat, {
            "accounts": 0, "stale": 0, "never_synced": 0, "oldest_sync": None,
            "connection_errors": 0})
        pf_stats["accounts"] += 1
        if acc.get("last_connection_state") or acc.get("relogin_blocked_at"):
            pf_stats["connection_errors"] += 1
        if plat == "fansly":
            has_fansly = True
            fansly_accounts += 1
            # Wallet snapshot across the panel's Fansly accounts. Separate on
            # purpose: display-only, never part of period totals, deltaPct, or
            # the category denominators. Served from the last sampled values
            # (stamped by the scheduled wallet refresh, the balances route and
            # the Fansly poll cycle) rather than a live call per account —
            # being O(1) in upstream requests is the entire point of this.
            avail = acc.get("last_balance_available")
            if avail is not None:
                fansly_sampled += 1
                try:
                    avail = float(avail)
                    pend = acc.get("last_balance_pending")
                    pend = float(pend) if pend is not None else None
                    cur = acc.get("last_balance_current")
                    cur = float(cur) if cur is not None else avail + (pend or 0.0)
                    fansly_available += avail
                    fansly_current += cur
                    if pend is not None:
                        fansly_pending += pend
                        fansly_pending_sampled += 1
                except (TypeError, ValueError):
                    pass
                sampled_at = _parse_db_datetime(acc.get("last_balance_at"))
                if sampled_at is not None:
                    if fansly_oldest_sample is None or sampled_at < fansly_oldest_sample:
                        fansly_oldest_sample = sampled_at
                    if fansly_newest_sample is None or sampled_at > fansly_newest_sample:
                        fansly_newest_sample = sampled_at
        synced_at = tx_freshness.get(str(of_user_id))

        if not synced_at:
            never_synced += 1
            pf_stats["never_synced"] += 1
            continue
        parsed = _parse_db_datetime(synced_at)
        if parsed is None:
            continue
        if oldest_sync is None or parsed < oldest_sync:
            oldest_sync = parsed
        if pf_stats["oldest_sync"] is None or parsed < pf_stats["oldest_sync"]:
            pf_stats["oldest_sync"] = parsed
        if (now - parsed).total_seconds() > EARNINGS_STALE_AFTER_SECONDS:
            stale_accounts += 1
            pf_stats["stale"] += 1

    def _fmt(dt):
        return dt.strftime("%Y-%m-%d %H:%M:%S") if dt else None

    by_platform = {}
    for plat in sorted(set(plat_fresh) | set(split["by_platform"])):
        money = split["by_platform"].get(plat) or {}
        fresh = plat_fresh.get(plat) or {}
        ptd = money.get("prev_total_to_date")
        by_platform[plat] = {
            "total": round(money.get("total", 0.0), 2),
            "prev_total": round(money.get("prev_total", 0.0), 2),
            "prev_total_to_date": round(ptd, 2) if ptd is not None else None,
            "uncategorized": round(money.get("uncategorized", 0.0), 2),
            "transactions": int(money.get("transactions", 0)),
            "accounts": fresh.get("accounts", 0),
            "stale": fresh.get("stale", 0),
            "never_synced": fresh.get("never_synced", 0),
            "connection_errors": fresh.get("connection_errors", 0),
            "oldest_sync_at": _fmt(fresh.get("oldest_sync")),
        }

    # ---- new subscribers --------------------------------------------------
    try:
        new_subs = db.panel_new_subscribers(
            crm_id, start, end, prev_start, prev_cut or prev_end)
    except Exception:
        _err_logger.exception("panel_new_subscribers failed for %s", crm_id)
        new_subs = None

    # ---- chart ------------------------------------------------------------
    # Zero-fill the day range. `chart` is a bare array of numbers with no dates
    # attached, so omitting a day that happens to have no transactions does not
    # merely lose a point — it shifts every later point one slot left and
    # misdates the whole series. `chart_days` is emitted alongside it so
    # consumers can label the axis instead of inferring it.
    chart_days = _day_range(start, end)
    if chart_days:
        chart = [round(chart_by_day.get(d, 0.0), 2) for d in chart_days]
    else:  # unparseable bounds — fall back to whatever days we actually have
        chart_days = sorted(chart_by_day.keys())
        chart = [round(chart_by_day[d], 2) for d in chart_days]

    # A transaction whose tx_type has no category mapping is dropped from
    # by_category but still counted in `total`, never the other way round — so
    # if the headline is empty and the categories are not, the categories are
    # the better answer.
    cat_sum = sum(by_category.values())
    if total <= 0 and cat_sum > 0:
        total = cat_sum

    result = {
        "total": round(total, 2),
        "prev_total": round(prev_total, 2),
        "by_category": {k: round(v, 2) for k, v in by_category.items()},
        "chart": chart,
        "chart_days": chart_days,
        "accounts_count": len(accounts),
        "transactions_counted": tx_count,
        # Kept for response-shape compatibility. The old live path truncated at
        # 500 transactions per account; the cache query has no such limit, so
        # this is now always False.
        "transactions_capped": False,
        "period": period,
        "source": "cache",
        "accounts_stale": stale_accounts,
        "accounts_never_synced": never_synced,
        "oldest_sync_at": (oldest_sync.strftime("%Y-%m-%d %H:%M:%S")
                           if oldest_sync else None),
        # Previous period up to the same elapsed point (named periods only;
        # null for custom ranges, whose prev window is already same-length).
        "prev_total_to_date": (round(split["prev_total_to_date"], 2)
                               if split.get("prev_total_to_date") is not None else None),
        "by_platform": by_platform,
        "by_category_platform": by_category_platform,
        "new_subs": new_subs,
        # UTC, all of it: period bounds are UTC days, and computed_at is when
        # THIS body was built (a cached response keeps its original stamp).
        "computed_at": db.iso_utc_now(),
        "period_start": start,
        "period_end": end,
    }
    if has_fansly:
        # Deprecated alias of fansly_balance.available (older clients).
        result["fansly_balance_floor"] = round(fansly_available, 2)
        # Coverage, so a partial figure is never mistaken for a complete one.
        # The sums use the last SAMPLED wallet per account; an account that has
        # never been sampled contributes 0, which understates the figure
        # silently unless we say how many are missing.
        result["fansly_accounts"] = fansly_accounts
        result["fansly_balance_sampled"] = fansly_sampled
        result["fansly_balance"] = {
            # current = whole earnings wallet, incl. earnings still on hold
            # available = withdrawable now; pending = on hold
            "current": round(fansly_current, 2),
            "available": round(fansly_available, 2),
            "pending": round(fansly_pending, 2),
            "accounts": fansly_accounts,
            "sampled": fansly_sampled,
            "pending_sampled": fansly_pending_sampled,
            "oldest_sample_at": _fmt(fansly_oldest_sample),
            "newest_sample_at": _fmt(fansly_newest_sample),
        }
    return result


@app.route("/api/crm/<crm_id>/balances/summary", methods=["GET"])
@limiter.limit(config.RATE_LIMIT_DEFAULT)
def balances_summary_route(crm_id):
    """Panel-wide payout totals, served from the last-known per-account samples.

    Replaces the dashboard's previous behaviour of calling
    ``/accounts/{id}/balances`` once per account, serially, from the browser on
    every overview load. That is one live OF round-trip per account: at ~1s
    each it made the overview unusable past a few dozen accounts and burned the
    per-key rate limit, which the UI then rendered as "no accounts connected".

    ``payoutAvailable`` is only knowable from the platform, so there is no way
    to make a live panel-wide total cheap — the honest move is to serve the
    last known values and say how stale they are. Samples are stamped by
    ``GET /accounts/{id}/balances`` (see ``fetch_balances``), so any normal use
    of the dashboard keeps them warm at no extra upstream cost.

    Response:
        {success, total_available, total_pending, currency,
         accounts, accounts_with_balance, accounts_never_sampled,
         oldest_sample_at, newest_sample_at}
    """
    crm_id, error, code = verify_api_key()
    if error:
        return jsonify(error), code
    return jsonify({'success': True, **db.balances_summary(crm_id)})


@app.route("/api/crm/<crm_id>/earnings/summary", methods=["GET"])
@limiter.limit(config.RATE_LIMIT_DEFAULT)
def earnings_summary_route(crm_id):
    """Aggregated earnings snapshot across all accounts in a CRM panel.

    ``period`` ∈ ``today | week | month`` (default: ``week``).

    Response cached in memory per (crm_id, period) with 2–15min TTL depending
    on the period. Cache auto-invalidates when an event that changes a reported
    number is emitted for any account in this CRM (new_tip / new_purchase /
    balance_increased / new_subscriber / renewed_subscriber — wired in
    event_bus) and when a scheduled Fansly wallet refresh changed something.

    Response (all money net of platform fees, all periods UTC):
        {
          total, prev_total, prev_total_to_date,
          by_category {subscriptions, posts, messages, tips, streams, referrals},
          by_category_platform {category: {onlyfans, fansly}},
          by_platform {platform: {total, prev_total, prev_total_to_date,
                                  uncategorized, transactions, accounts, stale,
                                  never_synced, connection_errors, oldest_sync_at}},
          new_subs {count, renewals, prev_count, prev_renewals,
                    by_platform {platform: {...}}, accounts, accounts_tracked,
                    accounts_never_synced, oldest_sync_at},
          chart [daily net values], chart_days, accounts_count,
          transactions_counted, transactions_capped, period, source,
          accounts_stale, accounts_never_synced, oldest_sync_at,
          computed_at, period_start, period_end, cached,
          // panels with a Fansly account only:
          fansly_balance {current, available, pending, accounts, sampled,
                          pending_sampled, oldest_sample_at, newest_sample_at},
          fansly_balance_floor (= fansly_balance.available, deprecated),
          fansly_accounts, fansly_balance_sampled
        }
    """
    crm_id, error, code = verify_api_key()
    if error:
        return jsonify(error), code

    start_iso = request.args.get("startDate") or request.args.get("start_date")
    end_iso = request.args.get("endDate") or request.args.get("end_date")
    period = request.args.get("period", "week")

    if start_iso and end_iso:
        # Custom range path — bypass the per-period cache (every range is
        # unique; caching would just bloat memory). Validate parseable here
        # so a typo gets a 400 instead of falling through to compute.
        try:
            _custom_range(start_iso, end_iso)
        except ValueError as e:
            return jsonify({"error": f"invalid startDate/endDate: {e}"}), 400
        fresh = _compute_earnings_summary(crm_id, period="custom",
                                            start_iso=start_iso, end_iso=end_iso)
        return jsonify({**fresh, "cached": False,
                          "period": "custom",
                          "startDate": start_iso, "endDate": end_iso})

    if period not in ("today", "week", "month"):
        return jsonify({"error": "period must be today | week | month, or supply startDate+endDate"}), 400

    cached = earnings_cache.get(crm_id, period)
    if cached is not None:
        return jsonify({**cached, "cached": True})

    fresh = _compute_earnings_summary(crm_id, period)
    earnings_cache.put(crm_id, period, fresh)
    return jsonify({**fresh, "cached": False})


@app.route("/api/crm/<crm_id>/accounts/<of_user_id>/earnings/verify", methods=["GET"])
@limiter.limit(config.RATE_LIMIT_SENSITIVE)
@check_account_ownership
def earnings_verify_route(crm_id, of_user_id):
    """Cross-check ONE account's cached earnings against OnlyFans' own chart.

    `/earnings/summary` sums transactions_cache rather than asking OnlyFans,
    because the live path could not converge at panel scale. The cost of that
    is a trust question: the number is only right if the cache is right. This
    is the answer to "prove it" — a single account, both sources, and the
    difference between them.

    Deliberately per-account and on the SENSITIVE rate-limit tier: this makes
    real upstream calls, so it must never become something a dashboard can fan
    out over 600 accounts. That fan-out is exactly the bomb the summary route
    was rewritten to defuse.

    Query: ?period=today|week|month (default week), or startDate + endDate.

    Response:
        {success, of_user_id, period, start, end,
         cached_total, live_total, difference, matches,
         cached_transactions, last_synced_at, live_available}
    """
    crm_id, error, code = verify_api_key()
    if error:
        return jsonify(error), code

    start_iso = request.args.get("startDate") or request.args.get("start_date")
    end_iso = request.args.get("endDate") or request.args.get("end_date")
    period = (request.args.get("period") or "week").strip().lower()
    if start_iso and end_iso:
        try:
            start, end, prev_start, prev_end = _custom_range(start_iso, end_iso)
        except ValueError as exc:
            return jsonify({"error": str(exc)}), 400
        period = "custom"
    else:
        if period not in ("today", "week", "month"):
            return jsonify({"error": "period must be today | week | month, "
                                       "or supply startDate+endDate"}), 400
        start, end, prev_start, prev_end = _period_range(period)

    cached_total, _prev, _chart, _cats, cached_count = db.panel_earnings_from_cache(
        crm_id, start, end, prev_start, prev_end, of_user_ids=[str(of_user_id)]
    )

    # Live side. A failure here is not an error in OUR data — it means we
    # couldn't reach OF right now — so report it as "unavailable" rather than
    # implying a mismatch of zero.
    live_total = None
    live_available = False
    ok, data, _, _ = handle_of_request(
        crm_id, of_user_id, _earnings_chart_path(start, end)
    )
    if ok:
        live_total = round(_total_from_chart(data), 2)
        live_available = True

    difference = (round(cached_total - live_total, 2)
                  if live_available else None)
    return jsonify({
        "success": True,
        "of_user_id": str(of_user_id),
        "period": period,
        "start": start,
        "end": end,
        "cached_total": round(cached_total, 2),
        "cached_transactions": cached_count,
        "live_total": live_total,
        "live_available": live_available,
        "difference": difference,
        # Sub-cent drift is float noise, not a data problem.
        "matches": (abs(difference) < 0.01) if difference is not None else None,
        "last_synced_at": db.panel_tx_freshness(crm_id).get(str(of_user_id)),
    })


# ============================================================================
# Messages / Chats (thin wrappers over OF API)
# ============================================================================


@app.route('/api/crm/<crm_id>/accounts/<of_user_id>/chats', methods=['GET'])
@limiter.limit(config.RATE_LIMIT_DEFAULT)
@check_account_ownership
def list_chats_route(crm_id, of_user_id):
    """List chats (conversations) for an OF account. Paginated via offset."""
    crm_id, error, code = verify_api_key()
    if error:
        return jsonify(error), code
    of_user_id = validate_of_user_id(of_user_id)

    _fr = _maybe_fansly(crm_id, of_user_id, 'chats', {
        'limit': request.args.get('limit', 20),
        'offset': request.args.get('offset', 0),
    })
    if _fr is not None:
        return _fr

    limit = validate_numeric_param(request.args.get('limit'), 'limit', min_val=1, max_val=50, default=20)
    offset = validate_numeric_param(request.args.get('offset'), 'offset', min_val=0, default=0)
    order = request.args.get('order', 'recent')
    if order not in ('recent', 'unread'):
        order = 'recent'

    proxy = get_proxy()
    # Do NOT pass skip_users — it strips the withUser object the UI needs to
    # render usernames / avatars (same class of bug as the old notifications
    # poller had). skip_users_dups would also drop duplicate user metadata.
    path = f'/api2/v2/chats?limit={limit}&offset={offset}&order={order}'
    success, data, status_code, relogin = handle_of_request(crm_id, of_user_id, path, proxy=proxy)

    if not success:
        return jsonify({'success': False, 'error': data}), status_code

    return jsonify({
        'success': True,
        'chats': (data or {}).get('list') or [],
        'hasMore': (data or {}).get('hasMore', False),
        **({"relogin": True} if relogin else {}),
    })


@app.route(
    '/api/crm/<crm_id>/accounts/<of_user_id>/chats/<with_user_id>/messages',
    methods=['GET']
)
@limiter.limit(config.RATE_LIMIT_DEFAULT)
@check_account_ownership
def list_chat_messages_route(crm_id, of_user_id, with_user_id):
    """Message history for a conversation. Returns newest-first by default."""
    crm_id, error, code = verify_api_key()
    if error:
        return jsonify(error), code
    of_user_id = validate_of_user_id(of_user_id)
    with_user_id = validate_of_user_id(with_user_id)

    _fr = _maybe_fansly(crm_id, of_user_id, 'messages', {
        'with_user_id': with_user_id,
        'self_account_id': of_user_id,
        'limit': request.args.get('limit', 50),
        'offset': request.args.get('offset', 0),
    })
    if _fr is not None:
        return _fr

    limit = validate_numeric_param(request.args.get('limit'), 'limit', min_val=1, max_val=100, default=50)
    offset = validate_numeric_param(request.args.get('offset'), 'offset', min_val=0, default=0)

    proxy = get_proxy()
    path = f'/api2/v2/chats/{with_user_id}/messages?limit={limit}&offset={offset}&order=desc'
    success, data, status_code, relogin = handle_of_request(crm_id, of_user_id, path, proxy=proxy)

    if not success:
        return jsonify({'success': False, 'error': data}), status_code

    return jsonify({
        'success': True,
        'messages': (data or {}).get('list') or [],
        'hasMore': (data or {}).get('hasMore', False),
        **({"relogin": True} if relogin else {}),
    })


# ── OnlyFans message send (single + mass) ────────────────────────────────────
# Max recipients resolved for one mass-message call. Guards against a runaway
# blast and keeps a single request bounded; page through audiences larger than
# this with the `audience.since/until` window.
MASS_MESSAGE_CAP = 5000


def _build_of_message_body(text, price=0, locked_text=False,
                           media_files=None, previews=None):
    """The body shape OF's POST /chats/<fan>/messages expects (matches the raw
    passthrough documented in SZYMEK-API-ENDPOINTS.md)."""
    return {
        'text': text or '',
        'lockedText': bool(locked_text),
        'price': float(price or 0),
        'mediaFiles': media_files or [],
        'previews': previews or [],
        'rfTag': [],
        'isCouplePeopleMedia': False,
        'isForward': False,
    }


def _send_of_message(crm_id, of_user_id, fan_id, body, proxy=None):
    """Send one OF DM. Returns (ok, data, status_code).

    Demo accounts (of_user_id starting 'demo_') are simulated — no OF traffic —
    so the compose/mass flows can be exercised end-to-end without a live
    session. The write-gate (allow_of_write_actions) is the CALLER's
    responsibility; this helper only performs the send.
    """
    path = f'/api2/v2/chats/{fan_id}/messages'
    ok, data, status, _relogin = handle_of_request(
        crm_id, of_user_id, path, method='POST', body=body, proxy=proxy)
    return ok, data, status


@app.route('/api/crm/<crm_id>/accounts/<of_user_id>/media', methods=['POST'])
@limiter.limit(config.RATE_LIMIT_SENSITIVE)
@check_account_ownership
def upload_media_route(crm_id, of_user_id):
    """Upload media to the account's vault.

    Two ways in:
      * multipart/form-data with a `file` part  (raw bytes)
      * JSON {"source_url": "https://…"}        (we fetch it server-side)

    Both run the same four-stage OnlyFans pipeline (signed S3 create → PUT →
    finish → converter); see of_upload.py. Returns the converter result, whose
    `processId` is what a post/message body references via `media_reference`.

    This replaces the long-documented `POST /api2/v2/media`, which never
    existed on OnlyFans.
    """
    crm_id_, error, code = verify_api_key()
    if error:
        return jsonify(error), code

    # Uploading acts as the creator, so it sits behind the same switch as every
    # other write (DM send, post, passthrough POST).
    polling = db.get_account_polling(crm_id, of_user_id)
    if not polling or not polling.get('allow_of_write_actions'):
        return jsonify({
            'success': False,
            'error': ('writes are disabled for this account. Enable them first: '
                      'PATCH …/accounts/<of_user_id>/polling '
                      '{"allow_of_write_actions": true}'),
            'code': 'WRITES_DISABLED',
        }), 403

    if _account_platform(crm_id, of_user_id) == 'fansly':
        body_, code_ = pf.unsupported_response('send_attachments', 'fansly')
        body_['hint'] = ('Media upload is implemented for OnlyFans only — the '
                         'Fansly upload pipeline is not wired yet.')
        return jsonify(body_), code_

    proxy = get_proxy()
    if not proxy:
        account = db.get_of_account(crm_id, of_user_id)
        if account:
            proxy = account.get('proxy')

    secure = False
    upload = request.files.get('file')

    try:
        if upload is not None:
            filename = sanitize_string(upload.filename or 'upload',
                                       max_length=255)
            data = upload.read()
            if len(data) > config.MEDIA_UPLOAD_MAX_BYTES:
                return jsonify({
                    'error': (f'file is {len(data)} bytes, over the '
                              f'{config.MEDIA_UPLOAD_MAX_BYTES} byte limit'),
                    'stage': 'input',
                }), 413
            secure = str(request.form.get('secure', '')).lower() in ('1', 'true', 'yes')
            result = of_upload.upload_media(
                crm_id, of_user_id, data, filename,
                content_type=upload.mimetype, proxy=proxy, secure=secure)
        else:
            body = request.get_json(silent=True) or {}
            source_url = body.get('source_url') or body.get('sourceUrl')
            if not source_url:
                return jsonify({
                    'error': ('provide either a multipart `file` part or a JSON '
                              'body with `source_url`'),
                }), 400

            # Same SSRF guard the webhook/integration senders use — a caller
            # must not be able to point this at 169.254.169.254 or localhost.
            safe, reason = is_safe_outbound_url(source_url)
            if not safe:
                return jsonify({'error': f'source_url rejected: {reason}'}), 400

            secure = bool(body.get('secure'))
            result = of_upload.upload_from_url(
                crm_id, of_user_id, source_url,
                filename=sanitize_string(body.get('filename'), max_length=255)
                if body.get('filename') else None,
                proxy=proxy, secure=secure,
                max_bytes=config.MEDIA_UPLOAD_MAX_BYTES)
    except of_upload.UploadError as exc:
        _err_logger.warning('media upload failed for %s/%s at stage %s: %s',
                            crm_id, of_user_id, exc.stage, exc.message)
        payload = exc.to_dict()
        payload['success'] = False
        return jsonify(payload), 502 if exc.stage in ('put', 'convert', 'fetch') else 400
    except ValidationError as e:
        return jsonify({'error': str(e)}), 400

    return jsonify({
        'success': True,
        'media': of_upload.media_reference(result),
        'data': result,
    }), 200


@app.route(
    '/api/crm/<crm_id>/accounts/<of_user_id>/chats/<with_user_id>/messages',
    methods=['POST']
)
@limiter.limit(config.RATE_LIMIT_SENSITIVE)
@check_account_ownership
def send_chat_message_route(crm_id, of_user_id, with_user_id):
    """Send a single DM (or PPV) to one fan.

    OnlyFans sends ride the signed proxy path (same as the send_dm automation)
    and are gated per-account by `allow_of_write_actions`. Fansly sends go
    through fansly_data. `price > 0` makes it a PPV; `mediaFiles` locks vault
    media behind the paywall, `previews` is the free teaser subset."""
    crm_id, error, code = verify_api_key()
    if error:
        return jsonify(error), code
    # Ownership of of_user_id is already verified by @check_account_ownership.
    # Only with_user_id needs format validation.
    if not str(with_user_id).isdigit():
        return jsonify({'error': 'Invalid fan id'}), 400

    # Write gate FIRST, before the platform branch. It used to sit below, which
    # meant a Fansly account sent the DM and returned before ever reaching it —
    # the flag only ever covered OnlyFans. The switch means "may we act as this
    # account", which is platform-independent.
    polling = db.get_account_polling(crm_id, of_user_id)
    if not polling or not polling.get('allow_of_write_actions'):
        return jsonify({
            'success': False,
            'error': ('writes are disabled for this account. Enable them first: '
                      'PATCH …/accounts/<of_user_id>/polling '
                      '{"allow_of_write_actions": true}'),
            'code': 'WRITES_DISABLED',
        }), 403

    # Fansly: sending IS wired (POST /api/v1/message). OF send remains a stub.
    # `price` is DOLLARS here (OF convention) — fansly_data converts to the
    # tenths-of-a-cent integers Fansly expects. `reply_to_id` maps to inReplyTo.
    if _account_platform(crm_id, of_user_id) == 'fansly':
        body = request.get_json(silent=True) or {}
        status, resp = fansly_data.fetch(crm_id, of_user_id, 'send_message', {
            'with_user_id': with_user_id,
            'text': sanitize_string(body.get('text'), max_length=5000) if body.get('text') else '',
            'price': body.get('price'),
            'reply_to_id': body.get('reply_to_id') or body.get('replyToId') or body.get('inReplyTo'),
        }, proxy=get_proxy())
        return jsonify(resp), status

    # OnlyFans send. The write gate above already ran for both platforms.
    body_in = request.get_json(silent=True) or {}
    try:
        text = sanitize_string(body_in.get('text', ''), max_length=5000, allow_empty=True) or ''
    except ValidationError as e:
        return jsonify({'error': str(e)}), 400
    media_files = body_in.get('mediaFiles') or body_in.get('media_files') or []
    previews = body_in.get('previews') or []
    if not text and not media_files:
        return jsonify({'error': 'message requires text or mediaFiles'}), 400

    of_body = _build_of_message_body(
        text, price=body_in.get('price') or 0,
        locked_text=body_in.get('lockedText') or body_in.get('locked_text'),
        media_files=media_files, previews=previews)
    ok, data, status = _send_of_message(
        crm_id, of_user_id, with_user_id, of_body, proxy=get_proxy())
    if not ok:
        return jsonify({'success': False, 'error': data,
                        'code': 'OF_SEND_FAILED'}), status
    return jsonify({'success': True, 'message': data}), 200


@app.route('/api/crm/<crm_id>/accounts/<of_user_id>/messages/mass', methods=['POST'])
@limiter.limit(config.RATE_LIMIT_SENSITIVE)
@check_account_ownership
def send_mass_message_route(crm_id, of_user_id):
    """Mass-message ("massive messaging") — resolve an audience and DM each fan.

    The recipient roster is drawn from `subscribers_cache`, NOT the /fans list.
    /fans is only populated by live polling, so an account with polling OFF has
    zero tracked fans — which is exactly why a naive mass-send resolves to
    "0 users" even when the creator has thousands of subscribers. Pulling from
    the subscriber cache fixes that.

    Body:
      {
        "text": "<p>hey 💕</p>", "price": 0, "lockedText": false,
        "mediaFiles": [], "previews": [],
        "audience": {
          "type": "active" | "all" | "expired",   # default: active
          "fan_ids": ["123", ...],                 # explicit override
          "min_spent": 0,                          # only fans who spent >= this
          "since": "<iso>", "until": "<iso>"       # subscribed_at window
        },
        "dry_run": true                            # default: true
      }

    dry_run (the DEFAULT) resolves + counts recipients and returns a sample
    WITHOUT sending anything — the "who will this reach?" preview, and the safe
    way to test. Set "dry_run": false to actually deliver; that path is gated by
    allow_of_write_actions like every other OF write.
    """
    crm_id, error, code = verify_api_key()
    if error:
        return jsonify(error), code

    if _account_platform(crm_id, of_user_id) == 'fansly':
        return jsonify({'success': False, 'code': 'PLATFORM_NOT_SUPPORTED',
                        'error': 'mass messaging is OnlyFans-only for now'}), 501

    body_in = request.get_json(silent=True) or {}
    try:
        text = sanitize_string(body_in.get('text', ''), max_length=5000, allow_empty=True) or ''
    except ValidationError as e:
        return jsonify({'error': str(e)}), 400
    media_files = body_in.get('mediaFiles') or body_in.get('media_files') or []
    previews = body_in.get('previews') or []
    if not text and not media_files:
        return jsonify({'error': 'message requires text or mediaFiles'}), 400

    audience = body_in.get('audience') or {}
    if not isinstance(audience, dict):
        return jsonify({'error': 'audience must be an object'}), 400
    dry_run = body_in.get('dry_run')
    dry_run = True if dry_run is None else bool(dry_run)

    # ── Resolve recipients ──────────────────────────────────────────────────
    explicit = audience.get('fan_ids')
    recipients = []
    if explicit is not None:
        if not isinstance(explicit, list):
            return jsonify({'error': 'audience.fan_ids must be a list'}), 400
        for fid in explicit[:MASS_MESSAGE_CAP]:
            sfid = str(fid)
            if sfid.isdigit():
                recipients.append({'fan_of_user_id': sfid, 'username': None})
    else:
        aud_type = audience.get('type') or 'active'
        if aud_type not in ('all', 'active', 'expired'):
            return jsonify({'error': "audience.type must be one of: all, active, expired"}), 400
        min_spent = audience.get('min_spent')
        try:
            min_spent = float(min_spent) if min_spent is not None else None
        except (TypeError, ValueError):
            return jsonify({'error': 'audience.min_spent must be numeric'}), 400
        rows, _total = db.list_cached_subscribers(
            crm_id, of_user_id, type_=aud_type, limit=MASS_MESSAGE_CAP, offset=0,
            sort='subscribed_at', since=audience.get('since'), until=audience.get('until'))
        for r in rows:
            if min_spent is not None and float(r.get('total_spent') or 0) < min_spent:
                continue
            fid = str(r.get('fan_of_user_id') or '')
            if fid:
                recipients.append({'fan_of_user_id': fid, 'username': r.get('username')})

    recipient_count = len(recipients)
    sample = recipients[:10]

    # ── Dry run: count + preview, no sends ──────────────────────────────────
    if dry_run:
        return jsonify({
            'success': True, 'dry_run': True,
            'recipients': recipient_count, 'sample': sample, 'sent': 0,
            'note': ('Preview only — no messages were sent. Re-POST with '
                     '"dry_run": false to deliver.') if recipient_count else
                    ('No subscribers matched this audience. Refresh subscribers '
                     '(POST …/subscribers/refresh) or set audience.type="all".'),
        })

    # ── Real send: gate on writes ───────────────────────────────────────────
    polling = db.get_account_polling(crm_id, of_user_id)
    if not polling or not polling.get('allow_of_write_actions'):
        return jsonify({
            'success': False, 'code': 'WRITES_DISABLED',
            'error': ('writes are disabled for this account. Enable them first: '
                      'PATCH …/accounts/<of_user_id>/polling '
                      '{"allow_of_write_actions": true}'),
            'recipients': recipient_count, 'sent': 0,
        }), 403

    if recipient_count == 0:
        return jsonify({'success': True, 'recipients': 0, 'sent': 0, 'failed': 0,
                        'results': [], 'note': 'No subscribers matched — nothing sent.'})

    proxy = get_proxy()
    of_body = _build_of_message_body(
        text, price=body_in.get('price') or 0,
        locked_text=body_in.get('lockedText') or body_in.get('locked_text'),
        media_files=media_files, previews=previews)
    sent = failed = 0
    results = []
    for r in recipients:
        fid = r['fan_of_user_id']
        ok, data, status = _send_of_message(crm_id, of_user_id, fid, dict(of_body), proxy=proxy)
        if ok:
            sent += 1
            results.append({'fan_of_user_id': fid, 'ok': True})
        else:
            failed += 1
            results.append({'fan_of_user_id': fid, 'ok': False,
                            'status': status, 'error': str(data)[:200]})
    return jsonify({
        'success': True, 'dry_run': False,
        'recipients': recipient_count, 'sent': sent, 'failed': failed,
        'results': results,
    })


@app.route('/api/crm/<crm_id>/accounts/<of_user_id>/ppv-stats', methods=['GET'])
@limiter.limit(config.RATE_LIMIT_SENSITIVE)
@check_account_ownership
@reject_fansly('ppv_stats')
def ppv_stats_route(crm_id, of_user_id):
    """PPV conversion rate for one OF account.

    Conversion = (paid PPVs from transactions_cache) / (PPV sent count from
    walking recent chats). Expensive — capped by `max_chats` (default 25,
    max 50) and cached for 1h.

    Query:
      since (ISO date, optional), until (ISO date, optional),
      max_chats (1–50, default 25),
      max_messages_per_chat (1–500, default 200).
    """
    crm_id, error, code = verify_api_key()
    if error:
        return jsonify(error), code
    of_user_id = validate_of_user_id(of_user_id)

    import ppv_stats as _ppv_stats

    since = request.args.get('since') or None
    until = request.args.get('until') or None
    if since and not re.match(r'^\d{4}-\d{2}-\d{2}', since):
        return jsonify({'error': 'Invalid since format (use YYYY-MM-DD)'}), 400
    if until and not re.match(r'^\d{4}-\d{2}-\d{2}', until):
        return jsonify({'error': 'Invalid until format (use YYYY-MM-DD)'}), 400

    max_chats = validate_numeric_param(
        request.args.get('max_chats'), 'max_chats', min_val=1, max_val=50, default=25,
    )
    max_msgs = validate_numeric_param(
        request.args.get('max_messages_per_chat'),
        'max_messages_per_chat',
        min_val=1, max_val=500, default=200,
    )

    proxy = get_proxy()
    if not proxy:
        account = db.get_of_account(crm_id, of_user_id)
        if account:
            proxy = account.get('proxy')

    try:
        stats = _ppv_stats.compute(
            crm_id=crm_id,
            of_user_id=of_user_id,
            since=since, until=until,
            max_chats=max_chats,
            max_messages_per_chat=max_msgs,
            proxy=proxy,
        )
    except Exception as e:
        return jsonify({'success': False, 'error': f'ppv stats failed: {e}'}), 500
    return jsonify({'success': True, 'stats': stats})


# ============================================================================
# Data export ("Download your data")
# ============================================================================

import export_runner as _export_runner


@app.route('/api/crm/<crm_id>/accounts/<of_user_id>/exports', methods=['POST'])
@limiter.limit(config.RATE_LIMIT_SENSITIVE)
@check_account_ownership
def create_export_route(crm_id, of_user_id):
    """Kick off an async data export for one account.

    Body: {
      "data_types": ["subscribers","transactions","fans","earnings","messages","account"],
      "since": "YYYY-MM-DD" | null,
      "until": "YYYY-MM-DD" | null,
      "include_media": bool   (OnlyFans only in v1)
    }

    Returns 202 with the created job. Progress streams over /events/stream as
    `export.progress`; the final result fires `export.complete`. The generated
    ZIP is downloadable from the download route for EXPORT_RETENTION_DAYS days.
    """
    crm_id_, error, code = verify_api_key()
    if error:
        return jsonify(error), code
    of_user_id = validate_of_user_id(of_user_id)

    body = request.get_json(silent=True) or {}

    raw_types = body.get('data_types')
    if not isinstance(raw_types, list) or not raw_types:
        return jsonify({'success': False,
                        'error': 'data_types must be a non-empty array'}), 400
    data_types = [t for t in config.EXPORT_DATA_TYPES if t in raw_types]
    if not data_types:
        return jsonify({'success': False,
                        'error': f'data_types must be a subset of {config.EXPORT_DATA_TYPES}'}), 400

    def _val_date(v, name):
        if v in (None, ''):
            return None
        v = sanitize_string(v, max_length=25, allow_empty=True)
        if v and not re.match(r'^\d{4}-\d{2}-\d{2}', v):
            raise ValidationError(f'Invalid {name} format (use YYYY-MM-DD)')
        return v

    try:
        since = _val_date(body.get('since'), 'since')
        until = _val_date(body.get('until'), 'until')
    except ValidationError as e:
        return jsonify({'success': False, 'error': str(e)}), 400

    include_media = bool(body.get('include_media'))
    platform = _account_platform(crm_id, of_user_id)

    # One export at a time per account — surface the in-flight job instead of
    # queueing a duplicate (mirrors the refresh routes). BUT a job wedged in
    # queued/running (dead worker, or one that never landed a terminal status)
    # must not block new exports forever, so supersede it once it's stale.
    existing = db.get_active_export(crm_id, of_user_id)
    if existing:
        from datetime import datetime as _dt, timezone as _tz
        started = existing.get('started_at') or existing.get('created_at')
        stale = False
        if started:
            try:
                _d = _dt.fromisoformat(str(started).replace('Z', '+00:00'))
                if _d.tzinfo is None:
                    _d = _d.replace(tzinfo=_tz.utc)
                age_min = (_dt.now(_tz.utc) - _d).total_seconds() / 60.0
                stale = age_min >= config.EXPORT_STALE_MINUTES
            except Exception:
                stale = False
        if not stale:
            return jsonify({
                'success': True,
                'already_running': True,
                'job': existing,
            }), 202
        # Stale: mark the wedged job failed and fall through to start a fresh one.
        db.update_export_job(
            existing['job_id'], status='failed',
            error=f'superseded: no terminal status after {config.EXPORT_STALE_MINUTES} min',
            completed_at=_dt.now(_tz.utc).strftime('%Y-%m-%dT%H:%M:%S+00:00'))

    job_id = uuid.uuid4().hex
    requested_by = request.headers.get('X-User-Email')
    db.create_export_job(
        crm_id, of_user_id, job_id, platform=platform, data_types=data_types,
        since=since, until=until, include_media=include_media,
        requested_by=sanitize_string(requested_by, max_length=255, allow_empty=True)
        if requested_by else None,
    )

    scheduler_mod.run_in_background(
        _export_runner.run_export, crm_id, str(of_user_id), job_id,
        job_id_prefix='export',
    )

    # Coarse heads-up: messages/media walk live and cost quota proportional to
    # volume; cached types are free. The UI shows this so a user isn't surprised.
    warning = None
    if 'messages' in data_types or include_media:
        warning = ('Messages and media are fetched live from the platform — '
                   'this can take several minutes and counts against your API quota.')

    return jsonify({
        'success': True,
        'job': db.get_export_job(crm_id, job_id),
        'warning': warning,
    }), 202


@app.route('/api/crm/<crm_id>/accounts/<of_user_id>/exports', methods=['GET'])
@limiter.limit(config.RATE_LIMIT_DEFAULT)
@check_account_ownership
def list_exports_route(crm_id, of_user_id):
    """Export history for one account, newest first."""
    crm_id_, error, code = verify_api_key()
    if error:
        return jsonify(error), code
    limit = validate_numeric_param(request.args.get('limit'), 'limit',
                                   min_val=1, max_val=200, default=50)
    offset = validate_numeric_param(request.args.get('offset'), 'offset',
                                    min_val=0, default=0)
    jobs, total = db.list_export_jobs(crm_id, of_user_id, limit=limit, offset=offset)
    return jsonify({'success': True, 'jobs': jobs, 'total': total})


@app.route('/api/crm/<crm_id>/accounts/<of_user_id>/exports/<job_id>', methods=['GET'])
@limiter.limit(config.RATE_LIMIT_DEFAULT)
@check_account_ownership
def get_export_route(crm_id, of_user_id, job_id):
    """Status of a single export (SSE-miss fallback)."""
    crm_id_, error, code = verify_api_key()
    if error:
        return jsonify(error), code
    job = db.get_export_job(crm_id, job_id)
    if not job or str(job.get('of_user_id')) != str(of_user_id):
        return jsonify({'success': False, 'error': 'export not found'}), 404
    return jsonify({'success': True, 'job': job})


@app.route('/api/crm/<crm_id>/accounts/<of_user_id>/exports/<job_id>/download', methods=['GET'])
@limiter.limit(config.RATE_LIMIT_DEFAULT)
@check_account_ownership
def download_export_route(crm_id, of_user_id, job_id):
    """Stream the generated ZIP. No quota cost (local file read). Access is
    scoped by crm_id — a job_id from another tenant 404s."""
    crm_id_, error, code = verify_api_key()
    if error:
        return jsonify(error), code
    job = db.get_export_job(crm_id, job_id)
    if not job or str(job.get('of_user_id')) != str(of_user_id):
        return jsonify({'success': False, 'error': 'export not found'}), 404
    if job.get('status') != 'complete':
        return jsonify({'success': False, 'error': f"export not ready (status={job.get('status')})"}), 409
    path = job.get('file_path')
    if not path or not os.path.exists(path):
        return jsonify({'success': False, 'error': 'export expired or unavailable'}), 410
    # Path-traversal defense: the artifact must live under EXPORTS_DIR.
    real = os.path.realpath(path)
    if not real.startswith(os.path.realpath(config.EXPORTS_DIR) + os.sep):
        return jsonify({'success': False, 'error': 'invalid export path'}), 400
    return send_file(real, as_attachment=True,
                     download_name=job.get('file_name') or f'export-{job_id}.zip',
                     mimetype='application/zip')


@app.route('/api/crm/<crm_id>/accounts/<of_user_id>/exports/<job_id>', methods=['DELETE'])
@limiter.limit(config.RATE_LIMIT_SENSITIVE)
@check_account_ownership
def delete_export_route(crm_id, of_user_id, job_id):
    """Delete an export job + its ZIP."""
    crm_id_, error, code = verify_api_key()
    if error:
        return jsonify(error), code
    job = db.get_export_job(crm_id, job_id)
    if not job or str(job.get('of_user_id')) != str(of_user_id):
        return jsonify({'success': False, 'error': 'export not found'}), 404
    path = job.get('file_path')
    if path:
        try:
            real = os.path.realpath(path)
            if real.startswith(os.path.realpath(config.EXPORTS_DIR) + os.sep) and os.path.exists(real):
                os.remove(real)
        except OSError:
            pass
    db.delete_export_job(crm_id, job_id)
    return jsonify({'success': True})


@app.route('/api/crm/<crm_id>/accounts/<of_user_id>/exports/<job_id>/cancel', methods=['POST'])
@limiter.limit(config.RATE_LIMIT_SENSITIVE)
@check_account_ownership
def cancel_export_route(crm_id, of_user_id, job_id):
    """Request cancellation of a running export. Cooperative — the worker stops
    at the next phase/conversation boundary and finalizes the job as 'canceled'."""
    crm_id_, error, code = verify_api_key()
    if error:
        return jsonify(error), code
    job = db.get_export_job(crm_id, job_id)
    if not job or str(job.get('of_user_id')) != str(of_user_id):
        return jsonify({'success': False, 'error': 'export not found'}), 404
    if job.get('status') not in ('queued', 'running'):
        return jsonify({'success': False,
                        'error': f"cannot cancel (status={job.get('status')})"}), 409
    db.update_export_job(job_id, status='canceled')
    return jsonify({'success': True, 'job': db.get_export_job(crm_id, job_id)})


# ============================================================================
# Bulk account import
# ============================================================================
#
# Eight routes, all panel-scoped (no of_user_id — the accounts do not exist
# yet, which is the whole point). See import_parser for the accepted paste
# formats and import_runner for the execution model.

import import_parser                       # noqa: E402
import import_runner as _import_runner     # noqa: E402


def _import_body_text(body):
    """Pull the paste out of a request body.

    Accepts `text` (what the UI sends) or `content`/`data` as aliases, because
    this endpoint's whole job is being forgiving about input shape.
    """
    for key in ('text', 'content', 'data', 'rows'):
        value = body.get(key)
        if isinstance(value, str) and value.strip():
            return value
    return None


def _parse_import_request(body):
    """Shared parse for /preview and /jobs. Returns (parsed, error_response).

    ``proxy_validator=validate_proxy`` is passed on BOTH paths, not just on
    create: it carries the SSRF guard (``is_safe_outbound_url``), so a preview
    that skipped it would happily tell an operator that
    `proxy=http://127.0.0.1:6379` is a fine row.
    """
    text = _import_body_text(body)
    if not text:
        return None, ({'success': False,
                       'error': 'text is required (paste your account list)'}, 400)

    default_platform = (body.get('default_platform')
                        or body.get('platform') or 'onlyfans')
    if not isinstance(default_platform, str) or \
            default_platform.strip().lower() not in import_parser.PLATFORMS:
        return None, ({'success': False,
                       'error': f'default_platform must be one of '
                                f'{list(import_parser.PLATFORMS)}'}, 400)

    try:
        parsed = import_parser.parse(
            text, default_platform=default_platform.strip().lower(),
            proxy_validator=validate_proxy)
    except import_parser.ImportLimitError as e:
        # A rejection, never a truncation — see config.IMPORT_MAX_ROWS.
        return None, ({'success': False, 'error': str(e), 'code': 'IMPORT_LIMIT',
                       'limits': {'max_rows': config.IMPORT_MAX_ROWS,
                                  'max_bytes': config.IMPORT_MAX_BYTES}}, 413)
    except import_parser.ImportParseError as e:
        return None, ({'success': False, 'error': str(e), 'code': 'IMPORT_PARSE'}, 400)
    return parsed, None


def _import_summary(parsed):
    """The shape /preview and /jobs both report. Never carries a secret."""
    rows = parsed['rows']
    lanes, platforms = {}, {}
    for r in rows:
        if not r['valid']:
            continue
        lanes[r['lane']] = lanes.get(r['lane'], 0) + 1
        platforms[r['platform']] = platforms.get(r['platform'], 0) + 1
    return {
        'format': parsed['format'],
        'delimiter': parsed['delimiter'],
        'has_header': parsed['has_header'],
        'columns': parsed['columns'],
        'total': parsed['total'],
        'valid_count': parsed['valid_count'],
        'invalid_count': parsed['invalid_count'],
        'lanes': lanes,
        'platforms': platforms,
        'limits': {'max_rows': config.IMPORT_MAX_ROWS,
                   'max_bytes': config.IMPORT_MAX_BYTES},
    }


@app.route('/api/crm/<crm_id>/import/preview', methods=['POST'])
@limiter.limit(config.RATE_LIMIT_SENSITIVE)
def import_preview_route(crm_id):
    """Parse + validate a paste. NO SIDE EFFECTS — nothing is written anywhere.

    This is what lets the UI show the operator exactly what will happen before
    a single login is attempted: which rows are valid, which lane each one will
    take, and precisely why row 47 is bad. Keep it side-effect free.

    Body: {"text": "<paste>", "default_platform": "onlyfans"|"fansly"}
    """
    crm_id, error, code = verify_api_key()
    if error:
        return jsonify(error), code

    parsed, err = _parse_import_request(request.get_json(silent=True) or {})
    if err:
        return jsonify(err[0]), err[1]

    payload = {'success': True}
    payload.update(_import_summary(parsed))
    payload['rows'] = import_parser.redact(parsed['rows'])
    return jsonify(payload)


@app.route('/api/crm/<crm_id>/import/jobs', methods=['POST'])
@limiter.limit(config.RATE_LIMIT_SENSITIVE)
def create_import_job_route(crm_id):
    """Create an import job and dispatch its worker.

    Body: {"text": "<paste>", "default_platform": "onlyfans"|"fansly",
           "source": "paste"|"file"}

    Returns 202 with the job. Progress streams over /events/stream as
    `import.progress` (coalesced to at most 1/sec) and finishes with
    `import.complete`.
    """
    crm_id, error, code = verify_api_key()
    if error:
        return jsonify(error), code

    body = request.get_json(silent=True) or {}
    parsed, err = _parse_import_request(body)
    if err:
        return jsonify(err[0]), err[1]

    if parsed['valid_count'] == 0:
        # Nothing worth attempting. Fail loudly with the per-row reasons rather
        # than creating a job that is 100% `invalid` and looks like a bug.
        payload = {'success': False,
                   'error': 'No valid rows to import — fix the highlighted rows and retry.'}
        payload.update(_import_summary(parsed))
        payload['rows'] = import_parser.redact(parsed['rows'])
        return jsonify(payload), 400

    source = sanitize_string(body.get('source') or 'paste', max_length=20,
                             allow_empty=True) or 'paste'
    requested_by = request.headers.get('X-User-Email')

    job_id = uuid.uuid4().hex
    db.create_import_job(
        crm_id, job_id, source=source,
        default_platform=(body.get('default_platform') or 'onlyfans'),
        fmt=parsed['format'], delimiter=parsed['delimiter'],
        has_header=parsed['has_header'], total_rows=parsed['total'],
        requested_by=sanitize_string(requested_by, max_length=255, allow_empty=True)
        if requested_by else None)
    db.add_import_rows(crm_id, job_id, parsed['rows'])

    # ONE background job for the whole import — never one per row. See the
    # import_runner module docstring for why 600 one-shots would be a denial of
    # service against our own scheduler.
    scheduler_mod.run_in_background(
        _import_runner.run_import, crm_id, job_id, job_id_prefix='import')

    job = db.get_import_job(crm_id, job_id)
    payload = {'success': True, 'job': job,
               'counts': db.count_import_rows(job_id)}
    payload.update(_import_summary(parsed))
    if parsed['invalid_count']:
        payload['warning'] = (f"{parsed['invalid_count']} row(s) failed validation "
                              f"and will not be attempted.")
    return jsonify(payload), 202


@app.route('/api/crm/<crm_id>/import/jobs', methods=['GET'])
@limiter.limit(config.RATE_LIMIT_DEFAULT)
def list_import_jobs_route(crm_id):
    """Import history for a panel, newest first, each with its status counts."""
    crm_id, error, code = verify_api_key()
    if error:
        return jsonify(error), code
    limit = validate_numeric_param(request.args.get('limit'), 'limit',
                                   min_val=1, max_val=200, default=50)
    offset = validate_numeric_param(request.args.get('offset'), 'offset',
                                    min_val=0, default=0)
    jobs, total = db.list_import_jobs(crm_id, limit=limit, offset=offset)
    return jsonify({'success': True, 'jobs': jobs, 'total': total})


@app.route('/api/crm/<crm_id>/import/jobs/<job_id>', methods=['GET'])
@limiter.limit(config.RATE_LIMIT_DEFAULT)
def get_import_job_route(crm_id, job_id):
    """One job with its rows + counts. The SSE-miss fallback: the DB row is the
    source of truth, the events are only a live nudge."""
    crm_id, error, code = verify_api_key()
    if error:
        return jsonify(error), code
    job = db.get_import_job(crm_id, job_id)
    if not job:
        return jsonify({'success': False, 'error': 'import job not found'}), 404

    limit = validate_numeric_param(request.args.get('limit'), 'limit',
                                   min_val=1, max_val=config.IMPORT_MAX_ROWS,
                                   default=config.IMPORT_MAX_ROWS)
    offset = validate_numeric_param(request.args.get('offset'), 'offset',
                                    min_val=0, default=0)
    status = request.args.get('status')
    if status and status not in db.ROW_STATES:
        return jsonify({'success': False,
                        'error': f'Unknown status filter: {status}'}), 400

    rows, total = db.list_import_rows(crm_id, job_id, status=status,
                                      limit=limit, offset=offset)
    return jsonify({
        'success': True,
        'job': job,
        'counts': db.count_import_rows(job_id),
        'rows': _import_runner.decorate_rows(rows),
        'total': total,
        'row_states': list(db.ROW_STATES),
    })


@app.route('/api/crm/<crm_id>/import/jobs/<job_id>/cancel', methods=['POST'])
@limiter.limit(config.RATE_LIMIT_SENSITIVE)
def cancel_import_job_route(crm_id, job_id):
    """Stop an import. Cooperative: pending rows are canceled immediately, a row
    already mid-login finishes (we cannot un-send it) and records its real
    outcome, and nothing further is claimed."""
    crm_id, error, code = verify_api_key()
    if error:
        return jsonify(error), code
    job = db.get_import_job(crm_id, job_id)
    if not job:
        return jsonify({'success': False, 'error': 'import job not found'}), 404
    if job.get('status') not in ('queued', 'running'):
        return jsonify({'success': False,
                        'error': f"cannot cancel (status={job.get('status')})"}), 409
    canceled = db.cancel_import_job(crm_id, job_id)
    return jsonify({'success': True, 'canceled_rows': canceled,
                    'job': db.get_import_job(crm_id, job_id),
                    'counts': db.count_import_rows(job_id)})


@app.route('/api/crm/<crm_id>/import/jobs/<job_id>/rows/<int:row_id>/otp',
           methods=['POST'])
# Tier note: RATE_LIMIT_SENSITIVE, not RATE_LIMIT_LOGIN, and the difference is
# deliberate. RATE_LIMIT_LOGIN exists to cap attempts against OUR credential
# check and to bound 2captcha spend. Neither applies here: the code is verified
# by OnlyFans/Fansly, not by us, so there is no local oracle to brute-force,
# and the caller is an already-authenticated tenant acting on their own parked
# row. Meanwhile the real workflow is an operator clearing a queue of parked
# rows back-to-back after a bulk import — at the login tier the 6th code of the
# minute would 429 on a legitimate action. Move it to RATE_LIMIT_LOGIN if that
# trade ever stops being worth it.
@limiter.limit(config.RATE_LIMIT_SENSITIVE)
def import_row_otp_route(crm_id, job_id, row_id):
    """Complete one parked row with a 2FA code. Body: {"code": "123456"}

    Synchronous — one platform call, and the operator is watching, so the
    response carries the real outcome rather than "queued".
    """
    crm_id, error, code = verify_api_key()
    if error:
        return jsonify(error), code

    body = request.get_json(silent=True) or {}
    try:
        otp = sanitize_string(body.get('code') or body.get('otp_code'),
                              max_length=12)
    except ValidationError as e:
        return jsonify({'success': False, 'error': str(e)}), 400
    if not re.fullmatch(r'[A-Za-z0-9\-]{4,12}', otp or ''):
        return jsonify({'success': False,
                        'error': 'code must be 4-12 alphanumeric characters'}), 400

    payload, status = _import_runner.submit_otp(crm_id, job_id, row_id, otp)
    return jsonify(payload), status


@app.route('/api/crm/<crm_id>/import/jobs/<job_id>/rows/<int:row_id>/retry',
           methods=['POST'])
@limiter.limit(config.RATE_LIMIT_SENSITIVE)
def import_row_retry_route(crm_id, job_id, row_id):
    """Re-queue one row. A `needs_2fa_expired` row re-runs the login from
    scratch; the dead challenge is discarded rather than replayed."""
    crm_id, error, code = verify_api_key()
    if error:
        return jsonify(error), code
    payload, status = _import_runner.retry_row(crm_id, job_id, row_id)
    return jsonify(payload), status


@app.route('/api/crm/<crm_id>/import/pending-2fa', methods=['GET'])
@limiter.limit(config.RATE_LIMIT_DEFAULT)
def import_pending_2fa_route(crm_id):
    """Panel-wide parked-2FA rows, across every job.

    This exists so the dashboard can show "N accounts need a 2FA code" AFTER
    the operator has closed the importer. That persistence is the requirement;
    a per-job query could not answer it.
    """
    crm_id, error, code = verify_api_key()
    if error:
        return jsonify(error), code
    limit = validate_numeric_param(request.args.get('limit'), 'limit',
                                   min_val=1, max_val=config.IMPORT_MAX_ROWS,
                                   default=200)
    rows = _import_runner.decorate_rows(db.list_pending_2fa_rows(crm_id, limit=limit))
    waiting = [r for r in rows if r['status'] == 'needs_2fa']
    return jsonify({
        'success': True,
        'count': len(waiting),
        'expired_count': len(rows) - len(waiting),
        'rows': rows,
        'expiry_seconds': config.TWO_FA_SESSION_EXPIRY,
    })


# ============================================================================
# Background polling, webhooks, automations, events
# ============================================================================

import json as _json
import scheduler as _scheduler
import event_bus as _event_bus
from sse_hub import hub as _sse_hub


ALLOWED_EVENT_TYPES = [
    'new_subscriber', 'renewed_subscriber', 'expired_subscriber',
    'new_tip', 'new_message', 'new_purchase',
    'balance_increased', 'payout_completed', 'polling_paused', '*'
]

# Server-generated UI progress events. They travel over the SAME SSE hub as the
# account events above but are NOT the same kind of thing: they carry no
# platform data, they are not persisted to `account_events`, and subscribing a
# webhook to them would be meaningless.
#
# Before this list existed they were unsubscribable: /events/stream validates
# `?types=` against ALLOWED_EVENT_TYPES, so `types=export.progress` 400'd and
# the only way to receive one was to subscribe to EVERYTHING with no filter.
# The fix is a second list rather than a wider first one — putting
# `import.progress` into ALLOWED_EVENT_TYPES would also make it a legal webhook
# subscription and a legal automation trigger, which it is not.
INTERNAL_EVENT_TYPES = [
    'export.progress', 'export.complete',
    'refresh.progress', 'refresh.complete',
    'import.progress', 'import.complete',
    # Platform identity gate (of_faceid). Internal, not public: these are UI
    # state, and a webhook subscriber has nothing to do with a selfie check.
    'verification.required', 'verification.approved', 'verification.failed',
]

# What /events/stream will accept in ?types=. Webhooks and automations keep
# using ALLOWED_EVENT_TYPES alone.
STREAMABLE_EVENT_TYPES = ALLOWED_EVENT_TYPES + INTERNAL_EVENT_TYPES

ALLOWED_ACTION_TYPES = ['webhook', 'discord', 'slack', 'telegram', 'send_dm', 'tag_fan']


def _validate_event_types(types):
    if not isinstance(types, list) or not types:
        raise ValidationError('event_types must be a non-empty list')
    for t in types:
        if t not in ALLOWED_EVENT_TYPES:
            raise ValidationError(f'Unknown event_type: {t}')
    return types


def _validate_url(url):
    if not url or not isinstance(url, str):
        raise ValidationError('url is required')
    url = url.strip()
    if not (url.startswith('http://') or url.startswith('https://')):
        raise ValidationError('url must start with http:// or https://')
    if len(url) > 2048:
        raise ValidationError('url too long')
    return url


# The allowlist and the approve/pending decision live in crm_database so that
# db.update_webhook can re-arm review when a webhook is repointed at a new host
# (it can't import this module — that would start the scheduler). Aliased here
# so the existing call sites keep reading naturally.
_WEBHOOK_DOMAIN_ALLOWLIST = db.WEBHOOK_DOMAIN_ALLOWLIST
_webhook_host = db.webhook_host
_initial_webhook_status = db.initial_webhook_status


def _require_admin():
    """Authorize an admin request.

    Three checks, all required:

    1. ``X-Service-Token`` matches ``INTER_SERVICE_TOKEN``. This proves the
       request came from the trusted Next.js proxy (which sets the header
       server-side) and not directly from any IP reachable to Flask:5000.
       Without this guard, an attacker who could reach the Flask port could
       supply ``X-API-Key: <any valid key>`` plus ``X-User-Email: <admin@…>``
       and get admin.
    2. ``X-API-Key`` resolves to a valid panel (via the constant-time
       ``find_crm_by_api_key`` so we don't timing-leak the key byte-by-byte).
    3. ``X-User-Email`` matches a user on that panel with ``is_admin=1``.

    Returns ``(admin_email_or_None, error_response, status_code)``.
    """
    if not _verify_service_token():
        # Don't leak which of the three checks failed.
        return None, {'error': 'Forbidden'}, 403

    api_key = request.headers.get('X-API-Key')
    if not api_key:
        return None, {'error': 'Missing X-API-Key'}, 401


    # Constant-time api_key resolution — index lookup + hmac.compare_digest
    # already happens inside find_crm_by_api_key (which itself only matches
    # against a unique column, so SQLite has one row to compare).
    panel = db.find_crm_by_api_key(api_key)
    if not panel:
        return None, {'error': 'Invalid API key'}, 403
    crm_id = panel['crm_id']

    email = (request.headers.get('X-User-Email') or '').strip().lower()
    if not email:
        return None, {'error': 'Missing X-User-Email'}, 401
    if not db.is_user_admin(crm_id, email):
        return None, {'error': 'Forbidden: admin access required'}, 403
    # A suspended admin loses access immediately — protects against a
    # compromised account where we've revoked privileges but the cookie
    # is still alive in someone's browser.
    if db.is_user_suspended(email):
        return None, {'error': 'Forbidden: user suspended'}, 403
    return email, None, None


def _client_ip():
    """Best-effort client IP from forwarding headers, falls back to remote_addr."""
    xff = request.headers.get('X-Forwarded-For', '')
    if xff:
        return xff.split(',')[0].strip()
    return request.headers.get('X-Real-IP') or request.remote_addr or 'unknown'


def _audit_admin(admin_email, action, target_kind=None, target_id=None, payload=None):
    """Wrapper that pulls IP + UA from the live request and never raises."""
    db.log_admin_audit(
        admin_email=admin_email,
        action=action,
        target_kind=target_kind,
        target_id=target_id,
        payload=payload,
        ip=_client_ip(),
        user_agent=request.headers.get('User-Agent', ''),
    )


# ---- admin: webhook approvals ----

@app.route('/api/admin/webhooks/pending', methods=['GET'])
@limiter.limit(config.RATE_LIMIT_ADMIN_READ)
def admin_pending_webhooks_route():
    _, err, code = _require_admin()
    if err:
        return jsonify(err), code
    return jsonify({'success': True, 'webhooks': db.list_pending_webhooks()})


@app.route('/api/admin/webhooks/<int:webhook_id>/approve', methods=['POST'])
@limiter.limit(config.RATE_LIMIT_ADMIN_WRITE)
def admin_approve_webhook_route(webhook_id):
    admin_name, err, code = _require_admin()
    if err:
        return jsonify(err), code
    # We need the webhook's crm_id + host to record a domain approval.
    import sqlite3
    conn = sqlite3.connect(db.DB_FILE)
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()
    cur.execute('SELECT crm_id, url FROM webhooks WHERE id = ?', (webhook_id,))
    row = cur.fetchone()
    conn.close()
    if not row:
        return jsonify({'error': 'Webhook not found'}), 404
    host = _webhook_host(row['url'])
    if host:
        db.approve_domain(row['crm_id'], host, approved_by=admin_name)
    _audit_admin(admin_name, 'webhook.approve',
                 target_kind='webhook', target_id=webhook_id,
                 payload={'crm_id': row['crm_id'], 'url': row['url'], 'host': host})
    wh = db.set_webhook_status(webhook_id, 'approved')
    return jsonify({'success': True, 'webhook': wh})


@app.route('/api/admin/webhooks/<int:webhook_id>/reject', methods=['POST'])
@limiter.limit(config.RATE_LIMIT_ADMIN_WRITE)
def admin_reject_webhook_route(webhook_id):
    admin_email, err, code = _require_admin()
    if err:
        return jsonify(err), code
    data = request.get_json(silent=True) or {}
    reason = sanitize_string(data.get('reason', ''), max_length=500, allow_empty=True)
    wh = db.set_webhook_status(webhook_id, 'rejected', reject_reason=reason or None)
    if not wh:
        return jsonify({'error': 'Webhook not found'}), 404
    _audit_admin(admin_email, 'webhook.reject',
                 target_kind='webhook', target_id=webhook_id,
                 payload={'reason': reason})
    return jsonify({'success': True, 'webhook': wh})


@app.route('/api/admin/domains', methods=['GET'])
@limiter.limit(config.RATE_LIMIT_ADMIN_READ)
def admin_list_domains_route():
    """List every (crm_id, domain) approval pair, plus the panel name for
    each crm_id so the admin UI can display something readable."""
    _, err, code = _require_admin()
    if err:
        return jsonify(err), code
    import sqlite3
    conn = sqlite3.connect(db.DB_FILE)
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()
    cur.execute('''SELECT d.id, d.crm_id, d.domain, d.approved_at, d.approved_by, p.name as panel_name
                   FROM webhook_approved_domains d
                   LEFT JOIN crm_panels p ON p.crm_id = d.crm_id
                   ORDER BY d.approved_at DESC''')
    rows = [dict(r) for r in cur.fetchall()]
    conn.close()
    return jsonify({'success': True, 'domains': rows})


@app.route('/api/admin/domains/<int:domain_id>', methods=['DELETE'])
@limiter.limit(config.RATE_LIMIT_ADMIN_WRITE)
def admin_revoke_domain_route(domain_id):
    """Revoke an approved domain. Any webhooks on that (crm_id, domain) get
    flipped back to 'pending' and stop delivering until re-approved."""
    admin_email, err, code = _require_admin()
    if err:
        return jsonify(err), code
    import sqlite3
    conn = sqlite3.connect(db.DB_FILE)
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()
    cur.execute('SELECT crm_id, domain FROM webhook_approved_domains WHERE id = ?', (domain_id,))
    row = cur.fetchone()
    if not row:
        conn.close()
        return jsonify({'error': 'Domain approval not found'}), 404
    crm_id, domain = row['crm_id'], row['domain']
    cur.execute('DELETE FROM webhook_approved_domains WHERE id = ?', (domain_id,))
    # Flip any matching approved webhooks back to pending.
    cur.execute("SELECT id, url FROM webhooks WHERE crm_id = ? AND status = 'approved'",
                (crm_id,))
    affected = []
    for r in cur.fetchall():
        host = _webhook_host(r['url'])
        if host == domain:
            affected.append(r['id'])
    if affected:
        qs = ','.join('?' * len(affected))
        cur.execute(f"UPDATE webhooks SET status = 'pending', reviewed_at = ? WHERE id IN ({qs})",
                    [_datetime.utcnow().isoformat(), *affected])
    conn.commit()
    conn.close()
    _audit_admin(admin_email, 'domain.revoke',
                 target_kind='domain', target_id=domain_id,
                 payload={'crm_id': crm_id, 'domain': domain,
                          'webhooks_paused': affected})
    return jsonify({'success': True, 'revoked_domain': domain, 'webhooks_paused': affected})


@app.route('/api/admin/me', methods=['GET'])
@limiter.limit(config.RATE_LIMIT_ADMIN_READ)
def admin_me_route():
    """Quick check for the frontend — returns 200 if the current session is
    admin, 403 otherwise. Lets the sidebar decide whether to show Admin."""
    email, err, code = _require_admin()
    if err:
        return jsonify(err), code
    return jsonify({'success': True, 'email': email})


# ---- admin: overview / panels / users / oauth / system / audit ----

@app.route('/api/admin/overview', methods=['GET'])
@limiter.limit(config.RATE_LIMIT_ADMIN_READ)
def admin_overview_route():
    """KPI counters for the admin dashboard landing page."""
    _, err, code = _require_admin()
    if err:
        return jsonify(err), code
    return jsonify({'success': True, 'stats': db.admin_overview_stats()})


@app.route('/api/admin/panels', methods=['GET'])
@limiter.limit(config.RATE_LIMIT_ADMIN_READ)
def admin_list_panels_route():
    """Paginated panel list. Query params: search, limit, offset."""
    _, err, code = _require_admin()
    if err:
        return jsonify(err), code
    search = sanitize_string(request.args.get('search', ''), max_length=120, allow_empty=True)
    limit = validate_numeric_param(request.args.get('limit'), 'limit',
                                   min_val=1, max_val=200, default=50)
    offset = validate_numeric_param(request.args.get('offset'), 'offset',
                                    min_val=0, max_val=1_000_000, default=0)
    return jsonify({'success': True,
                    **db.list_panels_admin(search=search or None,
                                            limit=limit, offset=offset)})


@app.route('/api/admin/panels/<crm_id>', methods=['GET'])
@limiter.limit(config.RATE_LIMIT_ADMIN_READ)
def admin_panel_detail_route(crm_id):
    _, err, code = _require_admin()
    if err:
        return jsonify(err), code
    crm_id = validate_crm_id(crm_id)
    detail = db.panel_detail_admin(crm_id)
    if not detail:
        return jsonify({'error': 'Panel not found'}), 404
    return jsonify({'success': True, 'detail': detail})


@app.route('/api/admin/users', methods=['GET'])
@limiter.limit(config.RATE_LIMIT_ADMIN_READ)
def admin_list_users_route():
    _, err, code = _require_admin()
    if err:
        return jsonify(err), code
    search = sanitize_string(request.args.get('search', ''), max_length=120, allow_empty=True)
    limit = validate_numeric_param(request.args.get('limit'), 'limit',
                                   min_val=1, max_val=200, default=50)
    offset = validate_numeric_param(request.args.get('offset'), 'offset',
                                    min_val=0, max_val=1_000_000, default=0)
    return jsonify({'success': True,
                    **db.list_all_users_admin(search=search or None,
                                              limit=limit, offset=offset)})


@app.route('/api/admin/users/<email>/admin', methods=['PATCH'])
@limiter.limit(config.RATE_LIMIT_ADMIN_WRITE)
def admin_set_user_admin_route(email):
    """Promote / demote a user. Body: {is_admin: bool}.

    The acting admin cannot demote themselves — otherwise an accidental click
    locks the panel out of admin access entirely (especially given there's
    only one admin in prod right now)."""
    admin_email, err, code = _require_admin()
    if err:
        return jsonify(err), code
    email = validate_email(email)
    data = request.get_json(silent=True) or {}
    is_admin = bool(data.get('is_admin'))
    if email.lower() == (admin_email or '').lower() and not is_admin:
        return jsonify({'error': 'Refusing to demote yourself'}), 400
    db.set_user_admin(email, is_admin=is_admin)
    _audit_admin(admin_email, 'user.set_admin',
                 target_kind='user', target_id=email,
                 payload={'is_admin': is_admin})
    return jsonify({'success': True, 'email': email, 'is_admin': is_admin})


@app.route('/api/admin/users/<email>/suspend', methods=['PATCH'])
@limiter.limit(config.RATE_LIMIT_ADMIN_WRITE)
def admin_set_user_suspended_route(email):
    """Suspend / unsuspend a user. Body: {suspended: bool}.

    Suspended users' API keys still resolve, but verify_api_key + _require_admin
    treat them as 401/403. Self-suspend is refused to avoid lockout."""
    admin_email, err, code = _require_admin()
    if err:
        return jsonify(err), code
    email = validate_email(email)
    data = request.get_json(silent=True) or {}
    suspended = bool(data.get('suspended'))
    if email.lower() == (admin_email or '').lower() and suspended:
        return jsonify({'error': 'Refusing to suspend yourself'}), 400
    found = db.set_user_suspended(email, suspended=suspended)
    if not found:
        return jsonify({'error': 'User not found'}), 404
    _audit_admin(admin_email, 'user.set_suspended',
                 target_kind='user', target_id=email,
                 payload={'suspended': suspended})
    return jsonify({'success': True, 'email': email, 'suspended': suspended})


@app.route('/api/admin/oauth/clients', methods=['GET'])
@limiter.limit(config.RATE_LIMIT_ADMIN_READ)
def admin_list_oauth_clients_route():
    _, err, code = _require_admin()
    if err:
        return jsonify(err), code
    return jsonify({'success': True, 'clients': db.list_oauth_clients_admin()})


@app.route('/api/admin/oauth/clients/<client_id>', methods=['DELETE'])
@limiter.limit(config.RATE_LIMIT_ADMIN_WRITE)
def admin_revoke_oauth_client_route(client_id):
    admin_email, err, code = _require_admin()
    if err:
        return jsonify(err), code
    # client_id is a free-form opaque string — sanitize length only.
    client_id = sanitize_string(client_id, max_length=255)
    found = db.revoke_oauth_client(client_id)
    if not found:
        return jsonify({'error': 'Client not found'}), 404
    _audit_admin(admin_email, 'oauth.revoke',
                 target_kind='oauth_client', target_id=client_id)
    return jsonify({'success': True, 'client_id': client_id})


@app.route('/api/admin/system/health', methods=['GET'])
@limiter.limit(config.RATE_LIMIT_ADMIN_READ)
def admin_system_health_route():
    _, err, code = _require_admin()
    if err:
        return jsonify(err), code
    health = db.system_health_admin()
    # Runtime scheduler state lives in-process (pool sizes, missed-run counters)
    # and can't come from the DB snapshot. Pairs with poller_lagging_accounts:
    # lagging accounts + a rising `missed` count means executor starvation.
    try:
        health['scheduler'] = _scheduler.stats()
    except Exception as e:
        health['scheduler'] = {'error': str(e)}
    # Collector liveness. `last_flush_at` going stale (or a non-zero `dropped`)
    # means the metrics flush job stopped and the request charts are lying by
    # omission — worth seeing next to the scheduler counters that explain why.
    try:
        health['request_metrics'] = api_metrics.stats()
    except Exception as e:
        health['request_metrics'] = {'error': str(e)}
    return jsonify({'success': True, 'health': health})


def _request_metrics_params():
    """Shared query-param parsing for both metrics routes.

    Returns (hours, granularity, limit). Raises ValidationError on bad input,
    which the app-level handler turns into a 400.
    """
    hours = validate_numeric_param(request.args.get('hours'), 'hours',
                                   min_val=1, max_val=24 * 90, default=24)
    limit = validate_numeric_param(request.args.get('limit'), 'limit',
                                   min_val=1, max_val=50, default=10)
    granularity = request.args.get('granularity') or request.args.get('bucket')
    if granularity and granularity not in api_metrics.GRANULARITIES:
        raise ValidationError(
            'granularity must be one of: '
            + ', '.join(sorted(api_metrics.GRANULARITIES)))
    return hours, granularity, limit


def _request_metrics_payload(hours, granularity, limit, crm_id=None):
    """Flush-then-read so the answer includes the current partial bucket.

    The accumulator normally holds <60s of data (the scheduler flush job owns
    the cadence), so this is a no-op most of the time — `flush()` returns
    immediately when nothing is pending. It matters for the dashboard's first
    load right after a restart, where otherwise the chart would be empty for a
    minute and look like an outage.
    """
    api_metrics.flush()
    return api_metrics.query(hours=hours, granularity=granularity,
                             crm_id=crm_id, limit=limit)


@app.route('/api/admin/metrics/requests', methods=['GET'])
@limiter.limit(config.RATE_LIMIT_ADMIN_READ)
def admin_request_metrics_route():
    """Platform-wide request outcomes: volume, status classes, error rate,
    latency, worst routes, noisiest tenants.

    This is the "see all requests at scale / are there any API failures" view.
    Optional ?crm_id= narrows it to one tenant without leaving the admin view.
    """
    _, err, code = _require_admin()
    if err:
        return jsonify(err), code
    hours, granularity, limit = _request_metrics_params()
    crm_filter = sanitize_string(request.args.get('crm_id', ''),
                                 max_length=64, allow_empty=True) or None
    return jsonify({
        'success': True,
        'metrics': _request_metrics_payload(hours, granularity, limit,
                                            crm_id=crm_filter),
    })


@app.route('/api/crm/<crm_id>/metrics/requests', methods=['GET'])
@limiter.limit(config.RATE_LIMIT_DEFAULT)
def crm_request_metrics_route(crm_id):
    """Same payload, scoped to the caller's own panel — this is what the
    dashboard Overview page charts. Identical shape to the admin route so one
    component can render either, with `top_tenants` empty (a tenant has no
    business seeing the tenant breakdown)."""
    crm_id, error, code = verify_api_key()
    if error:
        return jsonify(error), code
    hours, granularity, limit = _request_metrics_params()
    return jsonify({
        'success': True,
        'metrics': _request_metrics_payload(hours, granularity, limit,
                                            crm_id=crm_id),
    })


@app.route('/api/crm/<crm_id>/errors/recent', methods=['GET'])
@limiter.limit(config.RATE_LIMIT_DEFAULT)
def crm_recent_errors_route(crm_id):
    """The individual failures behind the error-rate number on the Overview.

    /metrics/requests can only say "4 failed" — it stores counters. This
    returns the actual rows, with the response body, so the operator can read
    what broke, copy it, and report it.

    Query: ?limit= 1-200 (default 50), ?status_class=4xx|5xx
    """
    crm_id, error, code = verify_api_key()
    if error:
        return jsonify(error), code
    limit = validate_numeric_param(request.args.get('limit'), 'limit',
                                   min_val=1, max_val=200, default=50)
    status_class = sanitize_string(request.args.get('status_class', ''),
                                   max_length=8, allow_empty=True) or None
    if status_class and status_class not in ('4xx', '5xx'):
        return jsonify({'error': 'status_class must be 4xx or 5xx'}), 400
    rows = api_errors.recent(crm_id, limit=limit, status_class=status_class)
    return jsonify({
        'success': True,
        'errors': rows,
        'count': len(rows),
        # So the UI can hide "Report to admin" rather than offering a button
        # that would silently drop the report.
        'reporting_available': ops_alerts.available(),
    })


@app.route('/api/crm/<crm_id>/errors/<int:error_id>/report', methods=['POST'])
@limiter.limit(config.RATE_LIMIT_SENSITIVE)
def crm_report_error_route(crm_id, error_id):
    """Send one logged failure to our operations channel.

    The destination comes ONLY from the environment (ops_alerts) — a tenant
    supplies a note, never a chat. Idempotent-ish: reporting twice is allowed
    (the second is usually "still happening") but the row records that it was.
    """
    crm_id, error, code = verify_api_key()
    if error:
        return jsonify(error), code
    payload = request.get_json(silent=True) or {}
    note = sanitize_string(payload.get('note', ''), max_length=500,
                           allow_empty=True) or None

    row = api_errors.get(crm_id, error_id)
    if not row:
        return jsonify({'error': 'Error not found'}), 404
    if not ops_alerts.available():
        return jsonify({'error': 'Reporting is not configured on this server',
                        'code': 'REPORTING_UNAVAILABLE'}), 503

    panel = db.get_crm_panel(crm_id) or {}
    sent = ops_alerts.report_error(
        crm_id=crm_id,
        panel_name=panel.get('name'),
        reporter=request.headers.get('X-Reporter-Email') or panel.get('name'),
        error=row,
        note=note,
    )
    if not sent:
        return jsonify({'error': 'Could not deliver the report — please try again',
                        'code': 'REPORT_DELIVERY_FAILED'}), 502
    api_errors.mark_reported(crm_id, error_id, note)
    return jsonify({'success': True, 'reported': True})


@app.route('/api/admin/audit', methods=['GET'])
@limiter.limit(config.RATE_LIMIT_ADMIN_READ)
def admin_list_audit_route():
    _, err, code = _require_admin()
    if err:
        return jsonify(err), code
    limit = validate_numeric_param(request.args.get('limit'), 'limit',
                                   min_val=1, max_val=500, default=100)
    offset = validate_numeric_param(request.args.get('offset'), 'offset',
                                    min_val=0, max_val=1_000_000, default=0)
    admin_email_filter = sanitize_string(request.args.get('admin_email', ''),
                                          max_length=320, allow_empty=True) or None
    action_filter = sanitize_string(request.args.get('action', ''),
                                     max_length=80, allow_empty=True) or None
    return jsonify({'success': True,
                    **db.list_admin_audit(limit=limit, offset=offset,
                                          admin_email=admin_email_filter,
                                          action=action_filter)})


@app.route('/api/admin/login-attempts', methods=['GET'])
@limiter.limit(config.RATE_LIMIT_ADMIN_READ)
def admin_list_login_attempts_route():
    """Recent account-connect attempts across all panels (proxy + credentials
    masked). Internal debugging surface for support — super-admin only."""
    _, err, code = _require_admin()
    if err:
        return jsonify(err), code
    limit = validate_numeric_param(request.args.get('limit'), 'limit',
                                   min_val=1, max_val=200, default=50)
    offset = validate_numeric_param(request.args.get('offset'), 'offset',
                                    min_val=0, max_val=1_000_000, default=0)
    crm_filter = sanitize_string(request.args.get('crm_id', ''),
                                 max_length=64, allow_empty=True) or None
    identifier_filter = sanitize_string(request.args.get('identifier', ''),
                                        max_length=200, allow_empty=True) or None
    outcome_filter = sanitize_string(request.args.get('outcome', ''),
                                     max_length=40, allow_empty=True) or None
    return jsonify({
        'success': True,
        'attempts': login_attempts.list_attempts(
            crm_id=crm_filter, identifier=identifier_filter,
            outcome=outcome_filter, limit=limit, offset=offset),
    })


@app.route('/api/admin/login-attempts/<int:attempt_id>', methods=['GET'])
@limiter.limit(config.RATE_LIMIT_ADMIN_READ)
def admin_get_login_attempt_route(attempt_id):
    """One attempt. `?reveal=1` decrypts the password/cookies and returns the
    full proxy — the reveal is audited."""
    admin_email, err, code = _require_admin()
    if err:
        return jsonify(err), code
    reveal = request.args.get('reveal') in ('1', 'true', 'yes')
    attempt = login_attempts.get(attempt_id, reveal=reveal)
    if not attempt:
        return jsonify({'error': 'Attempt not found'}), 404
    if reveal:
        _audit_admin(admin_email, 'login_attempt.reveal',
                     target_kind='login_attempt', target_id=str(attempt_id),
                     payload={'crm_id': attempt.get('crm_id'),
                              'identifier': attempt.get('identifier')})
    return jsonify({'success': True, 'attempt': attempt})


@app.route('/api/admin/login-attempts/<int:attempt_id>/retest', methods=['POST'])
@limiter.limit(config.RATE_LIMIT_ADMIN_WRITE)
def admin_retest_login_attempt_route(attempt_id):
    """Re-run a stored attempt's login on the backend (using the saved
    credentials + proxy) so support can reproduce a failure without the
    customer. Records the re-test as its own attempt row (source='retest')."""
    admin_email, err, code = _require_admin()
    if err:
        return jsonify(err), code
    attempt = login_attempts.get(attempt_id, reveal=True)
    if not attempt:
        return jsonify({'error': 'Attempt not found'}), 404

    identifier = attempt.get('identifier')
    password = attempt.get('password')
    proxy = attempt.get('proxy')  # full (revealed)
    platform = attempt.get('platform') or 'onlyfans'
    cookies = attempt.get('cookies') if isinstance(attempt.get('cookies'), dict) else None

    _audit_admin(admin_email, 'login_attempt.retest',
                 target_kind='login_attempt', target_id=str(attempt_id),
                 payload={'crm_id': attempt.get('crm_id'), 'identifier': identifier,
                          'platform': platform})

    retest_id = login_attempts.record_start(
        crm_id=attempt.get('crm_id') or '', owner_email=attempt.get('owner_email'),
        platform=platform, identifier=identifier, password=password, proxy=proxy,
        cookies=cookies, source='retest')

    import account_connect
    try:
        if platform == 'fansly':
            return jsonify({'error': 'Fansly re-test is not supported yet.',
                            'code': 'PLATFORM_NOT_SUPPORTED'}), 501
        if password:
            result = account_connect.of_password_login(
                identifier, password, proxy=proxy, use_captcha=True)
        elif cookies:
            result = account_connect.of_cookie_connect(
                cookies.get('sess'), cookies.get('auth_id'), cookies.get('fp'),
                proxy=proxy)
        else:
            login_attempts.record_finish(retest_id, 400,
                                         {'reason': 'no_credentials'})
            return jsonify({'error': 'No stored credentials to re-test with.',
                            'code': 'NO_CREDENTIALS'}), 400
    except Exception as e:
        login_attempts.record_finish(retest_id, 500, {'reason': 'retest_error',
                                                       'error': str(e)[:300]})
        _err_logger.exception("login-attempt retest failed for #%s", attempt_id)
        return jsonify({'error': 'Re-test failed to run.', 'detail': str(e)[:300]}), 500

    # Map account_connect's {status, error, reason} onto a finish body.
    status = result.get('status')
    session = result.get('session') if isinstance(result.get('session'), dict) else {}
    body = {'reason': result.get('reason') or status,
            'error': result.get('error'),
            'of_user_id': session.get('user_id')}
    if status in ('authenticated', 'success'):
        body['success'] = True
        http = 200
    elif status == 'needs_2fa':
        body['requires_2fa'] = True
        http = 200
    else:
        http = 400
    login_attempts.record_finish(retest_id, http, body)

    return jsonify({'success': True, 'result': {
        'status': status,
        'reason': result.get('reason'),
        'error': result.get('error'),
        'permanent': result.get('permanent'),
        'retest_attempt_id': retest_id,
    }})


# ---- polling control ----

@app.route('/api/crm/<crm_id>/accounts/<of_user_id>/polling', methods=['GET'])
@limiter.limit(config.RATE_LIMIT_DEFAULT)
def get_account_polling_route(crm_id, of_user_id):
    crm_id, error, code = verify_api_key()
    if error:
        return jsonify(error), code
    of_user_id = validate_of_user_id(of_user_id)
    info = db.get_account_polling(crm_id, of_user_id)
    if not info:
        return jsonify({'error': 'Account not found'}), 404
    return jsonify({'success': True, 'polling': info})


@app.route('/api/crm/<crm_id>/accounts/<of_user_id>/polling', methods=['PATCH'])
@limiter.limit(config.RATE_LIMIT_SENSITIVE)
def update_account_polling_route(crm_id, of_user_id):
    crm_id, error, code = verify_api_key()
    if error:
        return jsonify(error), code
    of_user_id = validate_of_user_id(of_user_id)
    data = request.get_json(silent=True) or {}
    enabled = data.get('enabled')
    interval = data.get('interval_seconds')
    allow_writes = data.get('allow_of_write_actions')

    if interval is not None:
        interval = validate_numeric_param(interval, 'interval_seconds', min_val=60, max_val=3600)

    # Capture prior state so we only auto-backfill on the OFF→ON transition,
    # not on every PATCH (e.g. an interval tweak on an already-active account).
    prior = db.get_account_polling(crm_id, of_user_id)
    was_enabled = bool(prior and prior.get('polling_enabled'))
    platform = _account_platform(crm_id, of_user_id)

    db.update_account_polling(
        crm_id, of_user_id,
        enabled=enabled,
        interval_seconds=interval,
        allow_of_write_actions=allow_writes,
    )
    info = db.get_account_polling(crm_id, of_user_id)
    if info and info.get('polling_enabled'):
        # Schedule the poll job + WS listeners, and backfill history on OFF→ON.
        # OF: last 7 days of transactions / subscribers / campaign claimers.
        # Fansly: the fansly-specific backfill (wallet-tx walk + fans harvest).
        _activate_account_polling(
            crm_id, of_user_id, platform,
            info['polling_interval_seconds'], was_enabled)
    else:
        _scheduler.unschedule_account(crm_id, of_user_id)
        # unschedule_account also drops the tx_refresh job; put back the
        # polling-independent refresh (OF idle ledger walk, Fansly wallet +
        # roster) so the dashboard numbers keep moving.
        try:
            _scheduler.ensure_account_refresh_jobs(crm_id, of_user_id)
        except Exception:
            _err_logger.exception("ensure_account_refresh_jobs failed for %s/%s",
                                  crm_id, of_user_id)

    resp = {'success': True, 'polling': info}
    # Poller gate transparency: polling can be "enabled" on the account while
    # the platform poller is switched off deployment-wide — say so instead of
    # silently never advancing last_polled_at. Mirrored by
    # pf.capabilities('fansly')['polling'].
    if platform == 'fansly' and info and info.get('polling_enabled') \
            and not getattr(config, 'FANSLY_POLLING_ENABLED', False):
        resp['warning'] = ('Fansly polling is disabled server-side '
                           '(FANSLY_POLLING_ENABLED=false) — the poll job is '
                           'scheduled but will no-op until the flag is enabled.')
    return jsonify(resp)


@app.route('/api/crm/<crm_id>/accounts/polling/enable-all', methods=['POST'])
@limiter.limit(config.RATE_LIMIT_SENSITIVE)
def enable_all_polling_route(crm_id):
    """Turn background polling on (at the paid default interval) for every
    account on the panel whose platform supports it. Paid plans only — polling
    is what pulls fresh earnings/subs, and leaving it off is the free-tier
    default that protects the monthly quota.

    Returns per-platform counts and a skipped list, so the dashboard can say how
    many accounts were switched on.
    """
    crm_id, error, code = verify_api_key()
    if error:
        return jsonify(error), code

    interval = PAID_POLL_INTERVAL
    accounts = db.get_of_accounts(crm_id)
    enabled, already_on, skipped = 0, 0, []
    for acc in accounts:
        of_user_id = acc.get('of_user_id')
        platform = acc.get('platform') or 'onlyfans'
        if not pf.capabilities(platform).get('polling'):
            skipped.append({'of_user_id': of_user_id, 'reason': 'platform_polling_disabled'})
            continue
        if acc.get('polling_enabled'):
            already_on += 1
            continue
        try:
            db.update_account_polling(crm_id, of_user_id, enabled=True,
                                      interval_seconds=interval)
            _activate_account_polling(crm_id, of_user_id, platform, interval,
                                      was_enabled=False)
            enabled += 1
        except Exception:
            _err_logger.exception("enable-all: failed for %s/%s", crm_id, of_user_id)
            skipped.append({'of_user_id': of_user_id, 'reason': 'error'})

    return jsonify({
        'success': True,
        'enabled': enabled,
        'already_on': already_on,
        'skipped': skipped,
        'interval_seconds': interval,
    })


@app.route('/api/crm/<crm_id>/accounts/<of_user_id>/tracked-campaigns',
           methods=['GET', 'PUT'])
@limiter.limit(config.RATE_LIMIT_SENSITIVE)
@check_account_ownership
def tracked_campaigns_route(crm_id, of_user_id):
    """Get or set the allowlist of tracking-link campaigns (names/codes) to keep
    synced for this account. When set, scheduled + backfill claimer syncs walk
    ONLY these, so a huge link (20k+ subs) never gets walked on a timer.

    GET  → {"tracked_campaigns": ["szvrils", ...] | null}
    PUT  body {"campaigns": ["szvrils"]} → set; [] / null clears (size-cap mode)
    """
    crm_id_, error, code = verify_api_key()
    if error:
        return jsonify(error), code
    of_user_id = validate_of_user_id(of_user_id)

    if request.method == 'GET':
        return jsonify({
            'success': True,
            'tracked_campaigns': db.get_tracked_campaigns(crm_id, of_user_id),
        })

    data = request.get_json(silent=True) or {}
    names = data.get('campaigns')
    if names is not None and not isinstance(names, list):
        return jsonify({'error': "'campaigns' must be a list or null"}), 400
    # Bound + sanitise each entry.
    clean = None
    if names:
        clean = [sanitize_string(str(n), max_length=100) for n in names][:200]
    db.set_tracked_campaigns(crm_id, of_user_id, clean)
    # Re-register the campaigns claimer job so the cadence reflects the new
    # allowlist immediately (fast 5-min when set, slow otherwise) — otherwise
    # the change wouldn't take effect until the next reconcile.
    try:
        info = db.get_account_polling(crm_id, of_user_id)
        if info and info.get('polling_enabled'):
            _scheduler.schedule_campaigns_refresh(crm_id, of_user_id)
    except Exception:
        _err_logger.exception("Failed to reschedule campaigns refresh for %s/%s",
                              crm_id, of_user_id)
    return jsonify({
        'success': True,
        'tracked_campaigns': db.get_tracked_campaigns(crm_id, of_user_id),
    })


# ---- events ----

@app.route('/api/crm/<crm_id>/events', methods=['GET'])
@limiter.limit(config.RATE_LIMIT_DEFAULT)
def list_events_route(crm_id):
    crm_id, error, code = verify_api_key()
    if error:
        return jsonify(error), code
    types_raw = request.args.get('types') or request.args.get('type')
    types = [t.strip() for t in types_raw.split(',')] if types_raw else None
    if types:
        for t in types:
            if t not in ALLOWED_EVENT_TYPES:
                return jsonify({'error': f'Unknown event type: {t}'}), 400
    of_user_id = request.args.get('of_user_id')
    since = request.args.get('since')
    until = request.args.get('until')
    limit = validate_numeric_param(request.args.get('limit'), 'limit', min_val=1, max_val=500, default=100)
    events = db.list_events(crm_id, types=types, of_user_id=of_user_id, since=since, until=until, limit=limit)
    return jsonify({'success': True, 'events': events})


@app.route('/api/crm/<crm_id>/events/stream', methods=['GET'])
@limiter.exempt
def events_stream_route(crm_id):
    crm_id, error, code = verify_api_key()
    if error:
        return jsonify(error), code

    # Optional server-side event-type filter: ?types=new_subscriber,new_tip
    # ('*' or absent = everything). Saves clients from discarding unwanted
    # event types on their end of a long-lived connection.
    #
    # Validated against STREAMABLE_EVENT_TYPES, which adds the internal
    # progress events (export.* / refresh.* / import.*). A UI that wants only
    # import progress could not previously ask for it — the filter rejected the
    # name and the only way through was an unfiltered subscription to
    # everything on the panel.
    types_raw = request.args.get('types') or request.args.get('type')
    types = None
    if types_raw:
        requested = [t.strip() for t in types_raw.split(',') if t.strip()]
        for t in requested:
            if t not in STREAMABLE_EVENT_TYPES:
                return jsonify({'error': f'Unknown event type: {t}'}), 400
        if '*' not in requested:
            types = requested

    def generate():
        yield from _sse_hub.stream(crm_id, types=types)

    resp = Response(stream_with_context(generate()), mimetype='text/event-stream')
    resp.headers['Cache-Control'] = 'no-cache'
    resp.headers['X-Accel-Buffering'] = 'no'
    # Remove the X-Frame-Options/CSP hard overrides for streaming? Keep default security headers.
    return resp


# ---- webhooks ----

@app.route('/api/crm/<crm_id>/webhooks', methods=['GET'])
@limiter.limit(config.RATE_LIMIT_DEFAULT)
def list_webhooks_route(crm_id):
    crm_id, error, code = verify_api_key()
    if error:
        return jsonify(error), code
    return jsonify({'success': True, 'webhooks': db.list_webhooks(crm_id)})


@app.route('/api/crm/<crm_id>/webhooks', methods=['POST'])
@limiter.limit(config.RATE_LIMIT_SENSITIVE)
def create_webhook_route(crm_id):
    crm_id, error, code = verify_api_key()
    if error:
        return jsonify(error), code
    data = request.get_json(silent=True) or {}
    try:
        url = _validate_url(data.get('url'))
        event_types = _validate_event_types(data.get('event_types') or [])
        description = sanitize_string(data.get('description', ''), max_length=200, allow_empty=True)
    except ValidationError as e:
        return jsonify({'error': str(e)}), 400
    status = _initial_webhook_status(crm_id, url)
    wh = db.create_webhook(crm_id, url, event_types, description=description or None, status=status)
    return jsonify({'success': True, 'webhook': wh}), 201


@app.route('/api/crm/<crm_id>/webhooks/<int:webhook_id>', methods=['GET'])
@limiter.limit(config.RATE_LIMIT_DEFAULT)
def get_webhook_route(crm_id, webhook_id):
    crm_id, error, code = verify_api_key()
    if error:
        return jsonify(error), code
    wh = db.get_webhook(crm_id, webhook_id)
    if not wh:
        return jsonify({'error': 'Webhook not found'}), 404
    return jsonify({'success': True, 'webhook': wh})


@app.route('/api/crm/<crm_id>/webhooks/<int:webhook_id>', methods=['PATCH'])
@limiter.limit(config.RATE_LIMIT_SENSITIVE)
def update_webhook_route(crm_id, webhook_id):
    crm_id, error, code = verify_api_key()
    if error:
        return jsonify(error), code
    data = request.get_json(silent=True) or {}
    url = data.get('url')
    if url is not None:
        try:
            url = _validate_url(url)
        except ValidationError as e:
            return jsonify({'error': str(e)}), 400
    event_types = data.get('event_types')
    if event_types is not None:
        try:
            event_types = _validate_event_types(event_types)
        except ValidationError as e:
            return jsonify({'error': str(e)}), 400
    wh = db.update_webhook(
        crm_id, webhook_id,
        url=url, event_types=event_types,
        description=data.get('description'),
        is_active=data.get('is_active'),
    )
    if not wh:
        return jsonify({'error': 'Webhook not found'}), 404
    return jsonify({'success': True, 'webhook': wh})


@app.route('/api/crm/<crm_id>/webhooks/<int:webhook_id>', methods=['DELETE'])
@limiter.limit(config.RATE_LIMIT_SENSITIVE)
def delete_webhook_route(crm_id, webhook_id):
    crm_id, error, code = verify_api_key()
    if error:
        return jsonify(error), code
    ok = db.delete_webhook(crm_id, webhook_id)
    if not ok:
        return jsonify({'error': 'Webhook not found'}), 404
    return jsonify({'success': True})


@app.route('/api/crm/<crm_id>/webhooks/<int:webhook_id>/test', methods=['POST'])
@limiter.limit(config.RATE_LIMIT_SENSITIVE)
def test_webhook_route(crm_id, webhook_id):
    crm_id, error, code = verify_api_key()
    if error:
        return jsonify(error), code
    wh = db.get_webhook(crm_id, webhook_id)
    if not wh:
        return jsonify({'error': 'Webhook not found'}), 404
    if (wh.get('status') or 'approved') != 'approved':
        return jsonify({'error': 'Webhook is awaiting admin approval and cannot send yet'}), 403
    import webhook_delivery
    sample_event = {
        'id': None,
        'crm_id': crm_id,
        'of_user_id': None,
        'event_type': 'new_tip',
        'source_event_id': 'test',
        'payload': {
            'test': True,
            'fan': {'id': '123', 'username': 'testfan', 'display_name': 'Test Fan'},
            'amount': 5.0,
            'text': 'sample test event',
        },
        'occurred_at': None,
    }
    ok = webhook_delivery.deliver_one(wh, sample_event, attempt=1)
    return jsonify({'success': ok})


@app.route('/api/crm/<crm_id>/webhooks/<int:webhook_id>/deliveries', methods=['GET'])
@limiter.limit(config.RATE_LIMIT_DEFAULT)
def webhook_deliveries_route(crm_id, webhook_id):
    crm_id, error, code = verify_api_key()
    if error:
        return jsonify(error), code
    limit = validate_numeric_param(request.args.get('limit'), 'limit', min_val=1, max_val=200, default=50)
    deliveries = db.list_webhook_deliveries(crm_id, webhook_id, limit=limit)
    return jsonify({'success': True, 'deliveries': deliveries})


# ---- automations ----

@app.route('/api/crm/<crm_id>/automations', methods=['GET'])
@limiter.limit(config.RATE_LIMIT_DEFAULT)
def list_automations_route(crm_id):
    crm_id, error, code = verify_api_key()
    if error:
        return jsonify(error), code
    return jsonify({'success': True, 'automations': db.list_automations(crm_id)})


@app.route('/api/crm/<crm_id>/automations', methods=['POST'])
@limiter.limit(config.RATE_LIMIT_SENSITIVE)
def create_automation_route(crm_id):
    crm_id, error, code = verify_api_key()
    if error:
        return jsonify(error), code
    data = request.get_json(silent=True) or {}
    try:
        name = sanitize_string(data.get('name', ''), max_length=100)
        trigger = data.get('trigger_event')
        if trigger not in ALLOWED_EVENT_TYPES or trigger == '*':
            raise ValidationError('Invalid trigger_event')
        action_type = data.get('action_type')
        if action_type not in ALLOWED_ACTION_TYPES:
            raise ValidationError('Invalid action_type')
    except ValidationError as e:
        return jsonify({'error': str(e)}), 400

    conditions = data.get('conditions') or []
    action_params = data.get('action_params') or {}
    of_user_id = data.get('of_user_id')
    if of_user_id:
        of_user_id = validate_of_user_id(of_user_id)

    is_active = data.get('is_active')
    if is_active is None:
        is_active = True

    automation = db.create_automation(
        crm_id=crm_id,
        name=name,
        trigger_event=trigger,
        action_type=action_type,
        action_params=action_params,
        of_user_id=of_user_id,
        conditions=conditions,
        is_active=bool(is_active),
    )
    return jsonify({'success': True, 'automation': automation}), 201


@app.route('/api/crm/<crm_id>/automations/<int:automation_id>', methods=['GET'])
@limiter.limit(config.RATE_LIMIT_DEFAULT)
def get_automation_route(crm_id, automation_id):
    crm_id, error, code = verify_api_key()
    if error:
        return jsonify(error), code
    a = db.get_automation(crm_id, automation_id)
    if not a:
        return jsonify({'error': 'Automation not found'}), 404
    return jsonify({'success': True, 'automation': a})


@app.route('/api/crm/<crm_id>/automations/<int:automation_id>', methods=['PATCH'])
@limiter.limit(config.RATE_LIMIT_SENSITIVE)
def update_automation_route(crm_id, automation_id):
    crm_id, error, code = verify_api_key()
    if error:
        return jsonify(error), code
    data = request.get_json(silent=True) or {}
    if 'trigger_event' in data and data['trigger_event'] not in ALLOWED_EVENT_TYPES:
        return jsonify({'error': 'Invalid trigger_event'}), 400
    if 'action_type' in data and data['action_type'] not in ALLOWED_ACTION_TYPES:
        return jsonify({'error': 'Invalid action_type'}), 400
    a = db.update_automation(crm_id, automation_id, **data)
    if not a:
        return jsonify({'error': 'Automation not found'}), 404
    return jsonify({'success': True, 'automation': a})


@app.route('/api/crm/<crm_id>/automations/<int:automation_id>', methods=['DELETE'])
@limiter.limit(config.RATE_LIMIT_SENSITIVE)
def delete_automation_route(crm_id, automation_id):
    crm_id, error, code = verify_api_key()
    if error:
        return jsonify(error), code
    ok = db.delete_automation(crm_id, automation_id)
    if not ok:
        return jsonify({'error': 'Automation not found'}), 404
    return jsonify({'success': True})


@app.route('/api/crm/<crm_id>/automations/<int:automation_id>/run-now', methods=['POST'])
@limiter.limit(config.RATE_LIMIT_SENSITIVE)
def run_automation_now_route(crm_id, automation_id):
    crm_id, error, code = verify_api_key()
    if error:
        return jsonify(error), code
    import automation_engine
    data = request.get_json(silent=True) or {}
    try:
        result = automation_engine.run_with_sample(crm_id, automation_id, data.get('sample_payload'))
    except ValueError as e:
        return jsonify({'error': str(e)}), 404
    return jsonify({'success': True, 'result': result})


@app.route('/api/crm/<crm_id>/automations/<int:automation_id>/runs', methods=['GET'])
@limiter.limit(config.RATE_LIMIT_DEFAULT)
def automation_runs_route(crm_id, automation_id):
    crm_id, error, code = verify_api_key()
    if error:
        return jsonify(error), code
    limit = validate_numeric_param(request.args.get('limit'), 'limit', min_val=1, max_val=200, default=50)
    runs = db.list_automation_runs(crm_id, automation_id, limit=limit)
    return jsonify({'success': True, 'runs': runs})


# ---- integrations helpers ----

@app.route('/api/crm/<crm_id>/integrations/telegram/groups', methods=['POST'])
@limiter.limit(config.RATE_LIMIT_SENSITIVE)
def telegram_groups_route(crm_id):
    """Fetch the list of groups/chats the user's Telegram bot has seen.

    Body: { "bot_token": "..." }
    """
    crm_id, error, code = verify_api_key()
    if error:
        return jsonify(error), code
    data = request.get_json(silent=True) or {}
    bot_token = sanitize_string(data.get('bot_token'), max_length=200)
    if not bot_token:
        return jsonify({'success': False, 'error': 'bot_token is required'}), 400
    # Never point getUpdates at the shared platform bot. It is a single-consumer
    # channel: a tenant calling this with the platform token would both steal
    # the intake poller's updates and read other tenants' pairing traffic.
    import telegram_updates as _tg_updates
    if _tg_updates.is_shared_token(bot_token):
        return jsonify({'success': False,
                        'error': 'That token belongs to the shared bot. Use bot_mode="shared" '
                                 'on /integrations/telegram instead.'}), 400
    try:
        from integrations.telegram import list_groups
        groups = list_groups(bot_token)
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 400
    return jsonify({'success': True, 'groups': groups})


# ---- panel-level Telegram channel ----
#
# One channel per panel. The bot token (custom mode) is Fernet-encrypted at rest
# and NEVER leaves the server: there is no route below that returns it, masked
# or otherwise, and _telegram_public is the only serializer any of them use.

def _telegram_public(integration):
    """Response shape for a telegram_integrations row.

    Allowlist, not a denylist: a new secret column added later is excluded by
    default rather than leaking until someone remembers to blocklist it.
    """
    if not integration:
        return None
    return {
        'bot_mode': integration.get('bot_mode') or 'shared',
        'has_custom_token': bool(integration.get('encrypted_bot_token')),
        'bot_username': integration.get('bot_username'),
        'chat_id': integration.get('chat_id'),
        'chat_title': integration.get('chat_title'),
        'chat_type': integration.get('chat_type'),
        'event_types': integration.get('event_types') or ['*'],
        'is_active': bool(integration.get('is_active')),
        'is_paired': bool(integration.get('chat_id')),
        'consecutive_failures': integration.get('consecutive_failures') or 0,
        'last_delivery_at': integration.get('last_delivery_at'),
        'last_error': integration.get('last_error'),
        'paired_at': integration.get('paired_at'),
        'created_at': integration.get('created_at'),
        'updated_at': integration.get('updated_at'),
    }


def _validate_telegram_bot_token(raw):
    """Shape check only — the real validation is the getMe call that follows.

    Telegram tokens are `<bot_id>:<35 url-safe chars>`; rejecting anything else
    here keeps obvious paste errors out of the encrypted column.
    """
    token = (raw or '').strip()
    if not token:
        raise ValidationError('bot_token is required for bot_mode="custom"')
    if len(token) > 200 or ':' not in token:
        raise ValidationError('bot_token does not look like a Telegram bot token')
    bot_id, _, rest = token.partition(':')
    if not bot_id.isdigit() or len(rest) < 20:
        raise ValidationError('bot_token does not look like a Telegram bot token')
    return token


@app.route('/api/crm/<crm_id>/integrations/telegram', methods=['GET'])
@limiter.limit(config.RATE_LIMIT_DEFAULT)
def get_telegram_integration_route(crm_id):
    crm_id, error, code = verify_api_key()
    if error:
        return jsonify(error), code
    import telegram_updates as _tg_updates
    return jsonify({
        'success': True,
        'integration': _telegram_public(db.get_telegram_integration(crm_id)),
        # So the UI can hide the shared-bot option on a deployment
        # where it isn't configured, instead of offering a button that fails.
        'shared_bot_available': bool(_tg_updates.shared_token()
                                     and _tg_updates.shared_username()),
        'shared_bot_username': _tg_updates.shared_username(),
        'event_types': [t for t in ALLOWED_EVENT_TYPES],
    })


@app.route('/api/crm/<crm_id>/integrations/telegram/pair', methods=['POST'])
@limiter.limit(config.RATE_LIMIT_SENSITIVE)
def telegram_pair_route(crm_id):
    """Start (or restart) pairing. Returns a t.me deep link, never a token.

    Body: {"bot_mode": "shared"|"custom", "bot_token": "..." (custom only),
           "event_types": [...] (optional)}
    """
    crm_id, error, code = verify_api_key()
    if error:
        return jsonify(error), code
    data = request.get_json(silent=True) or {}
    bot_mode = (data.get('bot_mode') or 'shared').strip().lower()
    if bot_mode not in ('shared', 'custom'):
        return jsonify({'error': 'bot_mode must be "shared" or "custom"'}), 400

    event_types = data.get('event_types')
    if event_types is not None:
        try:
            event_types = _validate_event_types(event_types)
        except ValidationError as e:
            return jsonify({'error': str(e)}), 400

    import telegram_updates as _tg_updates
    bot_token = None

    if bot_mode == 'shared':
        if not (_tg_updates.shared_token() and _tg_updates.shared_username()):
            # Explicit refusal beats a link that can never resolve.
            return jsonify({
                'error': 'The shared Telegram bot is not configured on this '
                         'deployment. Connect your own bot instead '
                         '(bot_mode="custom").'}), 409
        bot_username = _tg_updates.shared_username()
    else:
        try:
            bot_token = _validate_telegram_bot_token(data.get('bot_token'))
        except ValidationError as e:
            return jsonify({'error': str(e)}), 400
        if _tg_updates.is_shared_token(bot_token):
            return jsonify({'error': 'That is the shared bot token. Use '
                                     'bot_mode="shared" instead.'}), 400
        try:
            from integrations.telegram import delete_webhook, get_me
            me = get_me(bot_token)
        except Exception as e:
            return jsonify({'error': f'Telegram rejected that bot token: {e}'}), 400
        bot_username = me.get('username')
        if not bot_username:
            return jsonify({'error': 'Could not read the bot username from Telegram'}), 400
        # Claim getUpdates on their bot too, or every poll during the pairing
        # window 409s and the deep link silently never resolves.
        try:
            delete_webhook(bot_token)
        except Exception:
            _err_logger.warning('telegram: could not clear webhook on custom bot for %s', crm_id)

    db.upsert_telegram_integration(crm_id, bot_mode, bot_token=bot_token,
                                   bot_username=bot_username, event_types=event_types)
    pairing = db.create_telegram_pairing_code(crm_id)
    return jsonify({
        'success': True,
        'deep_link': _tg_updates.deep_link(bot_username, pairing['code']),
        'bot_username': bot_username,
        'expires_at': pairing['expires_at'],
        'ttl_seconds': pairing['ttl_seconds'],
        'integration': _telegram_public(db.get_telegram_integration(crm_id)),
    })


@app.route('/api/crm/<crm_id>/integrations/telegram', methods=['PATCH'])
@limiter.limit(config.RATE_LIMIT_SENSITIVE)
def update_telegram_integration_route(crm_id):
    crm_id, error, code = verify_api_key()
    if error:
        return jsonify(error), code
    if not db.get_telegram_integration(crm_id):
        return jsonify({'error': 'No Telegram integration configured'}), 404
    data = request.get_json(silent=True) or {}
    event_types = data.get('event_types')
    if event_types is not None:
        try:
            event_types = _validate_event_types(event_types)
        except ValidationError as e:
            return jsonify({'error': str(e)}), 400
    integ = db.update_telegram_integration(crm_id, event_types=event_types,
                                           is_active=data.get('is_active'))
    return jsonify({'success': True, 'integration': _telegram_public(integ)})


@app.route('/api/crm/<crm_id>/integrations/telegram', methods=['DELETE'])
@limiter.limit(config.RATE_LIMIT_SENSITIVE)
def delete_telegram_integration_route(crm_id):
    crm_id, error, code = verify_api_key()
    if error:
        return jsonify(error), code
    ok = db.delete_telegram_integration(crm_id)
    if not ok:
        return jsonify({'error': 'No Telegram integration configured'}), 404
    return jsonify({'success': True})


@app.route('/api/crm/<crm_id>/integrations/telegram/test', methods=['POST'])
@limiter.limit(config.RATE_LIMIT_SENSITIVE)
def test_telegram_integration_route(crm_id):
    crm_id, error, code = verify_api_key()
    if error:
        return jsonify(error), code
    import telegram_notify
    result = telegram_notify.send_test(crm_id)
    return jsonify({**result,
                    'integration': _telegram_public(db.get_telegram_integration(crm_id))}), \
        (200 if result.get('success') else 400)


# ---- fans / tags ----

@app.route('/api/crm/<crm_id>/fans', methods=['GET'])
@limiter.limit(config.RATE_LIMIT_DEFAULT)
def list_fans_route(crm_id):
    crm_id, error, code = verify_api_key()
    if error:
        return jsonify(error), code
    of_user_id = request.args.get('of_user_id')
    limit = validate_numeric_param(request.args.get('limit'), 'limit', min_val=1, max_val=500, default=100)
    offset = validate_numeric_param(request.args.get('offset'), 'offset', min_val=0, default=0)
    sort = request.args.get('sort') or 'last_seen'
    if sort not in ('last_seen', 'first_seen', 'tips', 'spend', 'events'):
        return jsonify({'error': 'invalid sort'}), 400
    search = request.args.get('search')
    if search:
        search = sanitize_string(search, max_length=80, allow_empty=True)
    tag = request.args.get('tag')
    if tag:
        tag = sanitize_string(tag, max_length=40, allow_empty=True)
    dedupe = request.args.get('dedupe', '').lower() in ('1', 'true', 'yes')
    with_total = request.args.get('with_total', '').lower() in ('1', 'true', 'yes')
    since = request.args.get('since') or None
    until = request.args.get('until') or None
    result = db.list_fans(
        crm_id, of_user_id=of_user_id, limit=limit, offset=offset,
        with_stats=True, sort=sort, search=search or None, tag=tag or None,
        since=since, until=until,
        dedupe_by_fan=dedupe, with_total=with_total,
    )
    if with_total:
        fans, total = result
        return jsonify({'success': True, 'fans': fans, 'total': total, 'dedupe': dedupe})
    return jsonify({'success': True, 'fans': result, 'dedupe': dedupe})


@app.route('/api/crm/<crm_id>/fans/<fan_of_user_id>/tags', methods=['POST'])
@limiter.limit(config.RATE_LIMIT_SENSITIVE)
def add_fan_tag_route(crm_id, fan_of_user_id):
    crm_id, error, code = verify_api_key()
    if error:
        return jsonify(error), code
    data = request.get_json(silent=True) or {}
    try:
        tag = sanitize_string(data.get('tag', ''), max_length=40)
        of_user_id = validate_of_user_id(data.get('of_user_id', ''))
    except ValidationError as e:
        return jsonify({'error': str(e)}), 400
    ok = db.add_fan_tag(crm_id, of_user_id, fan_of_user_id, tag, added_by='user')
    return jsonify({'success': ok})


@app.route('/api/crm/<crm_id>/fans/<fan_of_user_id>/tags/<tag>', methods=['DELETE'])
@limiter.limit(config.RATE_LIMIT_SENSITIVE)
def remove_fan_tag_route(crm_id, fan_of_user_id, tag):
    crm_id, error, code = verify_api_key()
    if error:
        return jsonify(error), code
    body = request.get_json(silent=True) or {}
    of_user_id = body.get('of_user_id') or request.args.get('of_user_id')
    if not of_user_id:
        return jsonify({'error': 'of_user_id required (in body or query string)'}), 400
    of_user_id = validate_of_user_id(of_user_id)
    ok = db.remove_fan_tag(crm_id, of_user_id, fan_of_user_id, tag)
    return jsonify({'success': ok})


@app.route('/api/crm/<crm_id>/fans/<fan_of_user_id>/note', methods=['PUT'])
@limiter.limit(config.RATE_LIMIT_SENSITIVE)
def set_fan_note_route(crm_id, fan_of_user_id):
    crm_id, error, code = verify_api_key()
    if error:
        return jsonify(error), code
    data = request.get_json(silent=True) or {}
    try:
        of_user_id = validate_of_user_id(data.get('of_user_id', ''))
        # Notes are free-form; allow empty (to clear) and a generous length.
        note = sanitize_string(data.get('note', ''), max_length=2000, allow_empty=True)
    except ValidationError as e:
        return jsonify({'error': str(e)}), 400
    ok = db.set_fan_note(crm_id, of_user_id, fan_of_user_id, note)
    return jsonify({'success': ok})


# ---- campaign tags ----
# Mirror the fan-tag routes above. The bulk GET uses a hyphenated `campaign-tags`
# path so Flask never captures the literal 'tags' as a <campaign_id> segment.

@app.route('/api/crm/<crm_id>/accounts/<of_user_id>/campaign-tags', methods=['GET'])
@limiter.limit(config.RATE_LIMIT_DEFAULT)
@check_account_ownership
def get_campaign_tags_route(crm_id, of_user_id):
    crm_id, error, code = verify_api_key()
    if error:
        return jsonify(error), code
    tags = db.get_campaign_tags(crm_id, of_user_id)
    all_tags = sorted({t for tags_list in tags.values() for t in tags_list})
    return jsonify({'success': True, 'tags': tags, 'all_tags': all_tags})


@app.route('/api/crm/<crm_id>/accounts/<of_user_id>/campaigns/<campaign_id>/tags', methods=['POST'])
@limiter.limit(config.RATE_LIMIT_SENSITIVE)
@check_account_ownership
def add_campaign_tag_route(crm_id, of_user_id, campaign_id):
    crm_id, error, code = verify_api_key()
    if error:
        return jsonify(error), code
    if not campaign_id or not campaign_id.isdigit():
        return jsonify({'error': 'Invalid campaign ID format'}), 400
    data = request.get_json(silent=True) or {}
    try:
        tag = sanitize_string(data.get('tag', ''), max_length=40)
    except ValidationError as e:
        return jsonify({'error': str(e)}), 400
    ok = db.add_campaign_tag(crm_id, of_user_id, campaign_id, tag, added_by='user')
    return jsonify({'success': ok})


@app.route('/api/crm/<crm_id>/accounts/<of_user_id>/campaigns/<campaign_id>/tags/<tag>', methods=['DELETE'])
@limiter.limit(config.RATE_LIMIT_SENSITIVE)
@check_account_ownership
def remove_campaign_tag_route(crm_id, of_user_id, campaign_id, tag):
    crm_id, error, code = verify_api_key()
    if error:
        return jsonify(error), code
    if not campaign_id or not campaign_id.isdigit():
        return jsonify({'error': 'Invalid campaign ID format'}), 400
    ok = db.remove_campaign_tag(crm_id, of_user_id, campaign_id, tag)
    return jsonify({'success': ok})


# ---- account tags ----
# Third instance of the fan-tag / campaign-tag route pair. There is no bulk GET
# here on purpose: GET /accounts already returns each account's `tags` plus the
# panel's `all_tags`, so the accounts page needs no second request no matter how
# many accounts a panel has.

@app.route('/api/crm/<crm_id>/accounts/<of_user_id>/tags', methods=['POST'])
@limiter.limit(config.RATE_LIMIT_SENSITIVE)
@check_account_ownership
def add_account_tag_route(crm_id, of_user_id):
    crm_id, error, code = verify_api_key()
    if error:
        return jsonify(error), code
    try:
        of_user_id = validate_of_user_id(of_user_id)
        tag = sanitize_string((request.get_json(silent=True) or {}).get('tag', ''),
                              max_length=40)
    except ValidationError as e:
        return jsonify({'error': str(e)}), 400
    ok = db.add_account_tag(crm_id, of_user_id, tag, added_by='user')
    return jsonify({'success': ok, 'tag': tag})


@app.route('/api/crm/<crm_id>/accounts/<of_user_id>/tags/<tag>', methods=['DELETE'])
@limiter.limit(config.RATE_LIMIT_SENSITIVE)
@check_account_ownership
def remove_account_tag_route(crm_id, of_user_id, tag):
    crm_id, error, code = verify_api_key()
    if error:
        return jsonify(error), code
    try:
        of_user_id = validate_of_user_id(of_user_id)
    except ValidationError as e:
        return jsonify({'error': str(e)}), 400
    # Bounded but NOT re-sanitized: sanitize_string HTML-escapes, and the stored
    # value was escaped once on the way in, so escaping the path segment again
    # would look for a double-escaped tag and silently delete nothing. Callers
    # send back exactly the string the API gave them. Same contract as
    # remove_campaign_tag_route.
    if not tag or len(tag) > 40:
        return jsonify({'error': 'Invalid tag'}), 400
    ok = db.remove_account_tag(crm_id, of_user_id, tag)
    return jsonify({'success': ok})


# Kick off scheduler when running under gunicorn or flask run (not only __main__)
_scheduler.start()


# ---------------------------------------------------------------------------
# Fansly credential read-out (additive, read-only).
#
# Lets an external publisher process (the content scheduler on the campaign box)
# obtain the CURRENT Fansly session for an account it owns, instead of holding a
# stale copy of the tokens. This service stays the credential authority: it is
# the thing that reloqins and rewrites the tokens, so callers that re-read here
# each run always pick up refreshed sessions.
#
# Read-only: touches no state, mutates nothing, and is gated by the same API key
# + ownership checks as every other account route.
# ---------------------------------------------------------------------------

@app.route('/api/crm/<crm_id>/accounts/<of_user_id>/fansly-credentials', methods=['GET'])
@limiter.limit(config.RATE_LIMIT_SENSITIVE)
@check_account_ownership
def get_fansly_credentials(crm_id, of_user_id):
    """Return the stored Fansly session material for one owned account."""
    crm_id, error, code = verify_api_key()
    if error:
        return jsonify(error), code

    account = db.get_of_account(crm_id, of_user_id)
    if not account:
        return jsonify({'error': 'Account not found'}), 404

    if (account.get('platform') or 'onlyfans') != 'fansly':
        return jsonify({'error': 'Not a Fansly account'}), 400

    auth_token = account.get('fansly_auth_token')
    if not auth_token:
        return jsonify({'error': 'No Fansly session stored. Please login first'}), 404

    return jsonify({
        'success': True,
        'platform': 'fansly',
        'of_user_id': of_user_id,
        'username': account.get('username'),
        'auth_token': auth_token,
        'session_id': account.get('fansly_session_id'),
        'client_id': account.get('fansly_client_id'),
        'proxy': account.get('proxy'),
    })



if __name__ == '__main__':
    print('=== OnlyFans Multi-Tenant CRM API (Secure) ===')
    print()
    print('Security Features:')
    print('  - bcrypt password hashing')
    print('  - Rate limiting enabled')
    print('  - CORS restrictions')
    print('  - Input validation')
    print('  - Security headers')
    print('  - Encrypted credential storage')
    print()
    print('Required Environment Variables:')
    print('  - SECRET_KEY (32+ chars)')
    print('  - ENCRYPTION_KEY (32+ chars)')
    print('  - TWOCAPTCHA_API_KEY')
    print()
    print('Starting server on http://{}:{}'.format(config.HOST, config.PORT))
    print()

    # use_reloader=False to avoid double-spawning the APScheduler background thread.
    # threaded=True so a slow /accounts/login (Cloudflare init + Turnstile + signed
    # login can take 20-30s) doesn't block every other request. Without this, the
    # dashboard's parallel polls queue behind a login and clients eventually see
    # 502/503 with HTML from Cloudflare's upstream timeout.
    app.run(
        host=config.HOST,
        port=config.PORT,
        debug=config.DEBUG,
        use_reloader=False,
        threaded=True,
    )
