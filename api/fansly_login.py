#!/usr/bin/env python3
"""Fansly email/username + password login.

The Fansly analogue of ``login.py``. Far simpler than OF's flow — no Cloudflare
Turnstile, no CDN hash fetch, no Node.js signer. The SPA's ``createSession``
just does:

    POST /api/v1/login  {username, password, deviceId}

and reads ``response.session.{token,id}`` + ``response.account.id`` from the
JSON envelope (``{success, response, error}``). A verified account returns a
working session immediately. Accounts in an unverified/flagged state come back
with an error asking for email verification; that path is link-token based
(``POST /api/v1/login/email/verification {token}``), not a 6-digit OTP — the
user pastes the token from the verification email, or connects via the
auth-token method instead.
"""

from curl_cffi import requests

import config
import fansly_header_generator as fhg


def _extract_session(response):
    """Pull (auth_token, session_id, account_id) out of a Fansly auth response.

    Confirmed live: /login nests the session under response.session, while
    /login/twofa returns it flat in response ({token, id, accountId}). Handle
    both."""
    if not isinstance(response, dict):
        return None, None, None
    sess = response.get('session') if isinstance(response.get('session'), dict) else None
    account = response.get('account') if isinstance(response.get('account'), dict) else {}
    if sess and sess.get('token'):
        return (sess.get('token'), sess.get('id'),
                account.get('id') or sess.get('accountId'))
    # Flat shape: the response *is* the session row.
    if response.get('token'):
        return (response.get('token'), response.get('id'),
                response.get('accountId') or account.get('id'))
    return None, None, None


def _envelope_error(resp):
    """Extract a human-readable error string from a Fansly error envelope."""
    try:
        body = resp.json()
    except Exception:
        return resp.text[:300]
    if isinstance(body, dict):
        err = body.get('error')
        if isinstance(err, dict):
            return err.get('details') or err.get('message') or str(err)
        if err:
            return str(err)
    return resp.text[:300]


def login(email, password, proxy=None, device_id=None):
    """Attempt a Fansly password login.

    Args:
        email (str): Account email or handle (sent as ``username``).
        password (str): Account password.
        proxy (str, optional): Proxy URL.
        device_id (str, optional): Reuse an existing ``fansly-client-id``;
            a fresh one is minted when omitted.

    Returns:
        dict on success:
            {success: True, account_id, auth_token, fansly_client_id,
             fansly_session_id, session_cookies, data}
        dict when the account needs email verification before the session is
        usable:
            {success: False, requires_verification: True, fansly_client_id,
             session_cookies, message}

    Raises:
        Exception: on a hard login failure (bad credentials, etc.).
    """
    session = requests.Session(impersonate='chrome136')
    if proxy:
        session.proxies = {'http': proxy, 'https': proxy}

    path = '/api/v1/login'
    headers, device_id = fhg.generate_fansly_headers(path, device_id=device_id, method='POST')

    body = {'username': email, 'password': password, 'deviceId': device_id}
    url = f'{config.FANSLY_BASE_URL}{path}?ngsw-bypass=true'

    resp = session.post(url, headers=headers, json=body, timeout=config.FANSLY_REQUEST_TIMEOUT)
    try:
        fhg.update_server_offset(device_id, resp)
    except Exception:
        pass

    try:
        data = resp.json()
    except Exception:
        data = None

    session_cookies = {k: v for k, v in dict(session.cookies).items()}

    if not isinstance(data, dict) or not data.get('success'):
        # Some unverified-account responses come back as a structured error that
        # names email verification. Surface that as a soft "needs verification"
        # rather than a hard failure, so the UI can guide the user.
        msg = _envelope_error(resp)
        if 'verif' in msg.lower() or 'email' in msg.lower():
            return {
                'success': False,
                'requires_verification': True,
                'fansly_client_id': device_id,
                'session_cookies': session_cookies,
                'message': msg,
            }
        raise Exception(f'Fansly login failed: {msg}')

    response = data.get('response') or {}

    # 2FA challenge: credentials accepted but a code is required. Fansly returns
    # response.twofa = {token, type, accountId, id, secretId} and NO session.
    # The code is submitted via verify_twofa(token, code, device_id).
    twofa = response.get('twofa') if isinstance(response, dict) else None
    if isinstance(twofa, dict) and twofa.get('token'):
        return {
            'success': False,
            'requires_2fa': True,
            'twofa_token': twofa.get('token'),
            'twofa_type': twofa.get('type'),
            'account_id': str(twofa.get('accountId')) if twofa.get('accountId') is not None else None,
            'fansly_client_id': device_id,
            'session_cookies': session_cookies,
            'message': 'Fansly two-factor code required.',
        }

    auth_token, fansly_session_id, account_id = _extract_session(response)

    if not auth_token or not fansly_session_id:
        # Logged in but no session token => verification gate.
        return {
            'success': False,
            'requires_verification': True,
            'fansly_client_id': device_id,
            'session_cookies': session_cookies,
            'message': 'Login accepted but no active session was returned (email verification may be required).',
        }

    return {
        'success': True,
        'account_id': str(account_id) if account_id is not None else None,
        'auth_token': auth_token,
        'fansly_client_id': device_id,
        'fansly_session_id': str(fansly_session_id),
        'session_cookies': session_cookies,
        'data': response.get('account') or {},
    }


def verify_twofa(twofa_token, code, device_id, session_cookies=None, proxy=None):
    """Submit a Fansly login two-factor code.

    ``POST /api/v1/login/twofa  {token, code}`` — where ``token`` is the
    ``response.twofa.token`` from ``login()`` and ``code`` is the user's current
    2FA code. Returns the same success dict shape as ``login()`` on success.

    Raises on failure (bad/expired code or token).
    """
    session = requests.Session(impersonate='chrome136')
    if proxy:
        session.proxies = {'http': proxy, 'https': proxy}
    for name, value in (session_cookies or {}).items():
        session.cookies.set(name, value, domain='fansly.com')

    path = '/api/v1/login/twofa'
    headers, _ = fhg.generate_fansly_headers(path, device_id=device_id, method='POST')
    url = f'{config.FANSLY_BASE_URL}{path}?ngsw-bypass=true'

    resp = session.post(url, headers=headers, json={'token': twofa_token, 'code': str(code)}, timeout=config.FANSLY_REQUEST_TIMEOUT)
    try:
        data = resp.json()
    except Exception:
        data = None

    if not isinstance(data, dict) or not data.get('success'):
        raise Exception(f'Fansly 2FA verification failed: {_envelope_error(resp)}')

    response = data.get('response') or {}
    auth_token, fansly_session_id, account_id = _extract_session(response)

    if not auth_token or not fansly_session_id:
        raise Exception('Fansly 2FA accepted but no session was returned')

    merged_cookies = {**(session_cookies or {}), **dict(session.cookies)}
    return {
        'success': True,
        'account_id': str(account_id) if account_id is not None else None,
        'auth_token': auth_token,
        'fansly_client_id': device_id,
        'fansly_session_id': str(fansly_session_id),
        'session_cookies': merged_cookies,
        'data': response.get('account') or {},
    }


def verify_email_token(token, device_id, session_cookies=None, proxy=None):
    """Submit an email-verification link token (``POST /login/email/verification``).

    Used to clear the verification gate for a freshly-flagged account. ``token``
    is the long token from the verification email link (not a 6-digit code).
    Returns the parsed JSON envelope (caller checks ``success``).
    """
    session = requests.Session(impersonate='chrome136')
    if proxy:
        session.proxies = {'http': proxy, 'https': proxy}
    for name, value in (session_cookies or {}).items():
        session.cookies.set(name, value, domain='fansly.com')

    path = '/api/v1/login/email/verification'
    headers, _ = fhg.generate_fansly_headers(path, device_id=device_id, method='POST')
    url = f'{config.FANSLY_BASE_URL}{path}?ngsw-bypass=true'

    resp = session.post(url, headers=headers, json={'token': token}, timeout=config.FANSLY_REQUEST_TIMEOUT)
    try:
        return resp.json()
    except Exception:
        return {'success': False, 'error': resp.text[:300]}


def fetch_account_me(auth_token, device_id, fansly_session_id, session_cookies=None, proxy=None):
    """Fetch ``/api/v1/account/me`` to validate a session and pull profile data.

    Returns the ``response`` object (account dict) on success, else None.
    Used by both login methods to confirm a session works and to grab
    username/avatar/about for the dashboard.
    """
    session = requests.Session(impersonate='chrome136')
    if proxy:
        session.proxies = {'http': proxy, 'https': proxy}
    for name, value in (session_cookies or {}).items():
        session.cookies.set(name, value, domain='fansly.com')

    path = '/api/v1/account/me'
    headers, _ = fhg.generate_fansly_headers(
        path, auth_token=auth_token, device_id=device_id, session_id=fansly_session_id, method='GET'
    )
    url = f'{config.FANSLY_BASE_URL}{path}?ngsw-bypass=true'

    resp = session.get(url, headers=headers, timeout=config.FANSLY_REQUEST_TIMEOUT)
    if resp.status_code != 200:
        return None
    try:
        data = resp.json()
    except Exception:
        return None
    if not isinstance(data, dict) or not data.get('success'):
        return None
    response = data.get('response') or {}
    # /account/me nests the profile under response.account — unwrap it so callers
    # (login persistence, token-paste) read id/username/email directly.
    if isinstance(response, dict) and isinstance(response.get('account'), dict):
        return response['account']
    return response
