"""OAuth 2.1 authorization server — Flask routes.

Six endpoints, implementing the MCP authorization spec (2025-06-18) on top
of OAuth 2.1 + PKCE + Dynamic Client Registration:

  GET  /.well-known/oauth-authorization-server   RFC 8414 AS metadata
  GET  /.well-known/jwks.json                    RFC 7517 JWKS
  POST /oauth/register                           RFC 7591 DCR
  GET  /oauth/authorize                          RFC 6749 §4.1 (start of code flow)
  POST /oauth/authorize/grant                    custom: called by the consent UI
  POST /oauth/token                              RFC 6749 §3.2 (code exchange)

The consent step is handled by a Next.js page at ``/oauth/consent`` in the
xcelerate-company-page app — Flask just bounces the browser there with
the authorize params in the query string. The page later calls back into
``/oauth/authorize/grant`` (X-API-Key authenticated) to mint the code.

This separation exists because Flask doesn't own the user session UI:
the dashboard does. Putting the consent screen in Next.js means we
reuse the same NextAuth-protected layout and styling.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import time
from typing import Iterable
from urllib.parse import urlencode, urlparse

from flask import Blueprint, jsonify, redirect, request

import crm_database as db
import oauth_db
import oauth_keys


oauth_bp = Blueprint("oauth", __name__)

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

# Publicly-reachable URLs. ChatGPT will hit these as printed in the
# authorization-server metadata, so they must be the externally-resolvable
# names — not 127.0.0.1 in production.
ISSUER = os.environ.get("OAUTH_ISSUER", "http://127.0.0.1:5000").rstrip("/")
CONSENT_UI_URL = os.environ.get(
    "OAUTH_CONSENT_UI_URL", "http://localhost:3000/oauth/consent"
).rstrip("/")

# Where the dashboard runs — used to allow CORS for /oauth/register from
# the browser-based test client. The grant endpoint is server-to-server
# from Next.js and doesn't need CORS.
DASHBOARD_ORIGINS = set(
    s.strip() for s in os.environ.get(
        "DASHBOARD_ORIGINS", "http://localhost:3000"
    ).split(",") if s.strip()
)

SUPPORTED_SCOPES = ["of:read", "of:write"]
SUPPORTED_GRANT_TYPES = ["authorization_code"]
SUPPORTED_RESPONSE_TYPES = ["code"]
SUPPORTED_AUTH_METHODS = ["none", "client_secret_basic"]


# ---------------------------------------------------------------------------
# Discovery
# ---------------------------------------------------------------------------

@oauth_bp.route("/.well-known/oauth-authorization-server", methods=["GET"])
def authorization_server_metadata():
    """RFC 8414 metadata. ChatGPT fetches this off the back of the
    resource server's 401 → WWW-Authenticate → resource_metadata → AS issuer
    discovery chain."""
    return jsonify({
        "issuer": ISSUER,
        "authorization_endpoint": f"{ISSUER}/oauth/authorize",
        "token_endpoint": f"{ISSUER}/oauth/token",
        "registration_endpoint": f"{ISSUER}/oauth/register",
        "jwks_uri": f"{ISSUER}/.well-known/jwks.json",
        "response_types_supported": SUPPORTED_RESPONSE_TYPES,
        "grant_types_supported": SUPPORTED_GRANT_TYPES,
        "token_endpoint_auth_methods_supported": SUPPORTED_AUTH_METHODS,
        "code_challenge_methods_supported": ["S256"],
        "scopes_supported": SUPPORTED_SCOPES,
        # RFC 8707 (resource indicators) — we honor the `resource` param
        # and bind it into the access token's `aud` claim.
        "resource_parameter_supported": True,
        # Explicit "no CIMD support" signal so strict OAuth validators
        # (ChatGPT's connector check among them) don't flag the absence
        # as ambiguous. With this set to false, clients use the
        # ``registration_endpoint`` for DCR per RFC 7591.
        "client_id_metadata_document_supported": False,
        # Service URIs so the connector validator can show users where to
        # go for docs / ToS. Both are absolute HTTPS URLs.
                            })


@oauth_bp.route("/.well-known/jwks.json", methods=["GET"])
def jwks():
    """Public JWKS — used by the MCP resource server to verify access
    tokens. Cached aggressively by clients; rotate by adding a new key
    to ``OAUTH_KEYS_DIR``."""
    resp = jsonify(oauth_keys.jwks_document())
    resp.headers["Cache-Control"] = "public, max-age=300"
    return resp


# ---------------------------------------------------------------------------
# Dynamic Client Registration (RFC 7591)
# ---------------------------------------------------------------------------

@oauth_bp.route("/oauth/register", methods=["POST", "OPTIONS"])
def dcr_register():
    """Open Dynamic Client Registration. No auth required — clients are
    one-shot, low-trust until a user actually approves them. Rate-limited
    at the route level (1/min default) to prevent enumeration spam.

    Per RFC 7591 §3.1 we accept the bare-minimum metadata fields and
    return the issued ``client_id`` (and ``client_secret`` for
    confidential clients).
    """
    if request.method == "OPTIONS":
        return _cors_preflight()

    body = request.get_json(silent=True) or {}
    redirect_uris = body.get("redirect_uris") or []
    if not isinstance(redirect_uris, list) or not redirect_uris:
        return jsonify({"error": "invalid_redirect_uri", "error_description":
                        "redirect_uris is required and must be a non-empty array"}), 400

    # Validate redirect_uri shape — must be absolute HTTPS (RFC 6749 §3.1.2.1)
    # except localhost which we allow for development clients.
    for uri in redirect_uris:
        if not isinstance(uri, str):
            return jsonify({"error": "invalid_redirect_uri"}), 400
        parsed = urlparse(uri)
        if not parsed.scheme or not parsed.netloc:
            return jsonify({"error": "invalid_redirect_uri",
                            "error_description": "must be absolute"}), 400
        is_localhost = parsed.hostname in ("localhost", "127.0.0.1", "::1")
        if parsed.scheme != "https" and not is_localhost:
            return jsonify({"error": "invalid_redirect_uri",
                            "error_description": "must be HTTPS"}), 400

    auth_method = body.get("token_endpoint_auth_method", "none")
    if auth_method not in SUPPORTED_AUTH_METHODS:
        return jsonify({"error": "invalid_client_metadata",
                        "error_description":
                        f"token_endpoint_auth_method must be one of {SUPPORTED_AUTH_METHODS}"}), 400

    requested_scope = body.get("scope") or "of:read"
    if not _scope_subset(requested_scope.split(), SUPPORTED_SCOPES):
        return jsonify({"error": "invalid_scope"}), 400

    record = oauth_db.register_client(
        client_name=body.get("client_name"),
        client_uri=body.get("client_uri"),
        redirect_uris=redirect_uris,
        token_endpoint_auth_method=auth_method,
        scope=requested_scope,
    )
    resp = jsonify({k: v for k, v in record.items() if v is not None})
    resp.status_code = 201
    _apply_cors(resp)
    return resp


# ---------------------------------------------------------------------------
# Authorization (Code flow)
# ---------------------------------------------------------------------------

@oauth_bp.route("/oauth/authorize", methods=["GET"])
def authorize():
    """RFC 6749 §4.1.1 authorization request.

    We don't render UI here. We validate params, then 302 to the Next.js
    consent UI carrying the params plus a signed ``flow`` token so the
    consent page can call ``/oauth/authorize/grant`` without us having
    to round-trip through the dashboard backend.

    Errors return per RFC 6749 §4.1.2.1:
    - Parameter problems → JSON 400 (we can't safely redirect)
    - Acceptable redirect → bounce back to client with ?error=...
    """
    args = request.args

    response_type = args.get("response_type")
    client_id = args.get("client_id")
    redirect_uri = args.get("redirect_uri")
    scope = args.get("scope", "of:read")
    state = args.get("state")
    code_challenge = args.get("code_challenge")
    code_challenge_method = args.get("code_challenge_method", "S256")
    resource = args.get("resource")

    if not client_id:
        return jsonify({"error": "invalid_request",
                        "error_description": "client_id required"}), 400
    client = oauth_db.get_client(client_id)
    if not client:
        return jsonify({"error": "invalid_client"}), 400

    if not redirect_uri or redirect_uri not in client["redirect_uris"]:
        return jsonify({"error": "invalid_redirect_uri"}), 400

    if response_type != "code":
        return _redirect_with_error(redirect_uri, "unsupported_response_type", state)

    if not code_challenge or code_challenge_method != "S256":
        return _redirect_with_error(redirect_uri, "invalid_request", state,
                                    description="PKCE S256 required")

    scopes = scope.split()
    if not _scope_subset(scopes, SUPPORTED_SCOPES):
        return _redirect_with_error(redirect_uri, "invalid_scope", state)

    if not resource:
        # MCP-spec recommendation: clients should always bind tokens to a
        # specific resource. We require it so audience confusion attacks
        # are impossible.
        return _redirect_with_error(redirect_uri, "invalid_target", state,
                                    description="resource parameter required")

    # All params valid. Hand off to the consent UI with a signed flow
    # blob that captures everything we just validated.
    flow = _seal_flow({
        "client_id": client_id,
        "redirect_uri": redirect_uri,
        "scope": scope,
        "state": state or "",
        "code_challenge": code_challenge,
        "code_challenge_method": code_challenge_method,
        "resource": resource,
    })
    ui_params = urlencode({
        "flow": flow,
        "client_id": client_id,
        "client_name": client.get("client_name") or client_id,
        "scope": scope,
        "redirect_uri": redirect_uri,
    })
    return redirect(f"{CONSENT_UI_URL}?{ui_params}", code=302)


@oauth_bp.route("/oauth/authorize/grant", methods=["POST", "OPTIONS"])
def authorize_grant():
    """Called by the Next.js consent page (server-side) after the user
    clicks Approve. Authenticated by ``X-API-Key`` belonging to the
    consenting user.

    We verify the signed flow blob, mint a single-use authorization code,
    and return the redirect URL with ``code`` + ``state`` for the consent
    page to bounce the browser to.
    """
    if request.method == "OPTIONS":
        return _cors_preflight()

    body = request.get_json(silent=True) or {}
    flow_token = body.get("flow")
    decision = body.get("decision")  # 'approve' | 'deny'

    if not flow_token or decision not in ("approve", "deny"):
        return jsonify({"error": "invalid_request"}), 400

    flow = _open_flow(flow_token)
    if not flow:
        return jsonify({"error": "invalid_flow"}), 400

    # User is identified via their existing API key. This is the same
    # bearer the dashboard uses internally — calling this endpoint
    # requires a valid logged-in session (the consent page reads it
    # from the user's NextAuth session and forwards it).
    api_key = request.headers.get("X-API-Key")
    if not api_key:
        return jsonify({"error": "unauthorized",
                        "error_description": "X-API-Key required"}), 401
    panel = db.find_crm_by_api_key(api_key)
    if not panel:
        return jsonify({"error": "unauthorized"}), 401

    redirect_uri = flow["redirect_uri"]

    if decision == "deny":
        url = _append_error(redirect_uri, "access_denied", flow.get("state"))
        return _grant_response({"redirect": url})

    # Record consent + issue code.
    oauth_db.record_consent(panel["crm_id"], flow["client_id"], flow["scope"].split())
    code = oauth_db.issue_code(
        client_id=flow["client_id"],
        user_crm_id=panel["crm_id"],
        redirect_uri=redirect_uri,
        scope=flow["scope"],
        code_challenge=flow["code_challenge"],
        code_challenge_method=flow["code_challenge_method"],
        resource=flow["resource"],
        state=flow.get("state"),
    )
    qs = {"code": code}
    if flow.get("state"):
        qs["state"] = flow["state"]
    sep = "&" if "?" in redirect_uri else "?"
    return _grant_response({"redirect": f"{redirect_uri}{sep}{urlencode(qs)}"})


# ---------------------------------------------------------------------------
# Token (RFC 6749 §3.2)
# ---------------------------------------------------------------------------

@oauth_bp.route("/oauth/token", methods=["POST", "OPTIONS"])
def token():
    """Exchange an authorization code for an access token. Validates PKCE,
    binds the token's ``aud`` to the original ``resource`` parameter.

    On success returns the standard token response (RFC 6749 §5.1):
    ``{access_token, token_type, expires_in, scope}``.

    Errors per RFC 6749 §5.2 with ``Content-Type: application/json``.
    """
    if request.method == "OPTIONS":
        return _cors_preflight()

    form = request.form
    grant_type = form.get("grant_type")
    code = form.get("code")
    redirect_uri = form.get("redirect_uri")
    code_verifier = form.get("code_verifier")
    client_id = form.get("client_id")
    resource = form.get("resource")  # RFC 8707 — optional override

    if grant_type != "authorization_code":
        return _token_error("unsupported_grant_type")
    if not code or not redirect_uri or not code_verifier:
        return _token_error("invalid_request")

    # Client authentication. Public clients (PKCE-only) just send
    # ``client_id`` in the form. Confidential clients use Basic auth
    # per RFC 6749 §2.3.1.
    auth_header = request.headers.get("Authorization", "")
    basic_client_id, basic_secret = _parse_basic(auth_header)
    effective_client_id = client_id or basic_client_id
    if not effective_client_id:
        return _token_error("invalid_client")

    client = oauth_db.get_client(effective_client_id)
    if not client:
        return _token_error("invalid_client")

    if client["token_endpoint_auth_method"] == "client_secret_basic":
        if basic_client_id != effective_client_id or not basic_secret:
            return _token_error("invalid_client")
        if not _consteq(basic_secret, client.get("client_secret") or ""):
            return _token_error("invalid_client")
    # else: public client — PKCE alone authenticates the binding.

    ctx = oauth_db.consume_code(code)
    if not ctx:
        return _token_error("invalid_grant", "code is invalid, expired, or already used")

    # Bind everything: same client, same redirect_uri, same PKCE pair.
    if ctx["client_id"] != effective_client_id:
        return _token_error("invalid_grant", "code does not belong to this client")
    if ctx["redirect_uri"] != redirect_uri:
        return _token_error("invalid_grant", "redirect_uri mismatch")
    if not _verify_pkce(ctx["code_challenge"], ctx["code_challenge_method"], code_verifier):
        return _token_error("invalid_grant", "PKCE verification failed")

    # If the client sent a ``resource`` on the token request it must match
    # the one bound to the code (audience confusion defense).
    audience = ctx["resource"]
    if resource and resource != audience:
        return _token_error("invalid_target", "resource does not match authorization")

    access_token = oauth_keys.sign_access_token(
        subject=ctx["user_crm_id"],
        audience=audience,
        scope=ctx["scope"],
        client_id=effective_client_id,
    )

    # Pre-emptive code GC. Cheap and keeps the table small.
    try:
        oauth_db.gc_expired_codes()
    except Exception:
        pass

    resp = jsonify({
        "access_token": access_token,
        "token_type": "Bearer",
        "expires_in": oauth_keys.ACCESS_TOKEN_TTL_SECONDS,
        "scope": ctx["scope"],
    })
    resp.headers["Cache-Control"] = "no-store"
    resp.headers["Pragma"] = "no-cache"
    _apply_cors(resp)
    return resp


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _scope_subset(requested: Iterable[str], allowed: Iterable[str]) -> bool:
    return set(requested).issubset(set(allowed))


def _redirect_with_error(redirect_uri: str, error: str, state: str | None,
                        description: str | None = None):
    return redirect(_append_error(redirect_uri, error, state, description), code=302)


def _append_error(redirect_uri: str, error: str, state: str | None,
                  description: str | None = None) -> str:
    qs: dict[str, str] = {"error": error}
    if description:
        qs["error_description"] = description
    if state:
        qs["state"] = state
    sep = "&" if "?" in redirect_uri else "?"
    return f"{redirect_uri}{sep}{urlencode(qs)}"


def _verify_pkce(challenge: str, method: str, verifier: str) -> bool:
    if method != "S256":
        return False
    if not (43 <= len(verifier) <= 128):
        return False
    expected = base64.urlsafe_b64encode(
        hashlib.sha256(verifier.encode("ascii")).digest()
    ).rstrip(b"=").decode("ascii")
    return _consteq(expected, challenge)


def _consteq(a: str, b: str) -> bool:
    return hmac.compare_digest(a.encode("utf-8"), b.encode("utf-8"))


def _parse_basic(header: str) -> tuple[str | None, str | None]:
    if not header.lower().startswith("basic "):
        return None, None
    try:
        raw = base64.b64decode(header[6:].strip()).decode("utf-8")
    except Exception:
        return None, None
    if ":" not in raw:
        return None, None
    cid, secret = raw.split(":", 1)
    return cid, secret


def _token_error(error: str, description: str | None = None):
    body = {"error": error}
    if description:
        body["error_description"] = description
    resp = jsonify(body)
    resp.status_code = 400
    resp.headers["Cache-Control"] = "no-store"
    _apply_cors(resp)
    return resp


# ---- Flow token (signed envelope so the consent UI can call us back) ----

def _flow_secret() -> bytes:
    """HMAC key for sealing the flow blob. Reuses INTER_SERVICE_TOKEN so
    we don't need a separate secret to deploy."""
    secret = os.environ.get("INTER_SERVICE_TOKEN", "")
    if len(secret) < 32:
        raise RuntimeError(
            "INTER_SERVICE_TOKEN must be set to at least 32 characters before OAuth flows can run"
        )
    return secret.encode("utf-8")


def _seal_flow(payload: dict) -> str:
    """HMAC-sign a JSON payload + 5-min TTL. Used to pass the validated
    authorize params from /oauth/authorize through the user's browser to
    /oauth/authorize/grant without round-tripping a DB row."""
    body = json.dumps({**payload, "exp": int(time.time()) + 300},
                      separators=(",", ":"), sort_keys=True).encode("utf-8")
    sig = hmac.new(_flow_secret(), body, hashlib.sha256).digest()
    return base64.urlsafe_b64encode(body).rstrip(b"=").decode("ascii") + "." + \
           base64.urlsafe_b64encode(sig).rstrip(b"=").decode("ascii")


def _open_flow(token: str) -> dict | None:
    try:
        body_b64, sig_b64 = token.split(".", 1)
    except ValueError:
        return None
    try:
        body = base64.urlsafe_b64decode(body_b64 + "=" * (-len(body_b64) % 4))
        sig = base64.urlsafe_b64decode(sig_b64 + "=" * (-len(sig_b64) % 4))
    except Exception:
        return None
    expected = hmac.new(_flow_secret(), body, hashlib.sha256).digest()
    if not hmac.compare_digest(sig, expected):
        return None
    try:
        payload = json.loads(body)
    except Exception:
        return None
    if int(payload.get("exp", 0)) < int(time.time()):
        return None
    return payload


# ---- CORS ----

def _cors_preflight():
    from flask import Response
    resp = Response(status=204)
    _apply_cors(resp)
    return resp


def _apply_cors(resp):
    origin = request.headers.get("Origin")
    if origin and origin in DASHBOARD_ORIGINS:
        resp.headers["Access-Control-Allow-Origin"] = origin
        resp.headers["Vary"] = "Origin"
        resp.headers["Access-Control-Allow-Credentials"] = "true"
        resp.headers["Access-Control-Allow-Headers"] = "Content-Type, Authorization, X-API-Key"
        resp.headers["Access-Control-Allow-Methods"] = "POST, GET, OPTIONS"


def _grant_response(payload):
    resp = jsonify(payload)
    _apply_cors(resp)
    return resp
