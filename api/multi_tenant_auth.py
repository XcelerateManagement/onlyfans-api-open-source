#!/usr/bin/env python3
"""
Multi-tenant authentication module for OnlyFans.
Sessions are isolated by CRM panel ID.
"""

import json
import os
from curl_cffi import requests
from datetime import datetime
from header_generator import generate_headers
import upstream_rate_controller
import config


# ── Request timeouts ───────────────────────────────────────────────────────
# curl_cffi applies NO default timeout — a stalled proxy or a hung OF response
# blocks the calling thread forever. That is exactly what wedged the data-export
# worker: a single no-timeout /chats call hung for ~12h and the job sat
# 'running' until the next restart, which in turn blocked every later export for
# that account. (connect, read) seconds; env-overridable.
_CONNECT_TIMEOUT = float(os.environ.get('OF_CONNECT_TIMEOUT', 15))
_READ_TIMEOUT = float(os.environ.get('OF_READ_TIMEOUT', 90))
REQUEST_TIMEOUT = (_CONNECT_TIMEOUT, _READ_TIMEOUT)


def get_session_path(crm_id, of_user_id):
    """Get session file path for a CRM panel and OF user.

    Creates the per-tenant directory with mode 0700 so other local users on
    the host can't list session files. The parent ``saved_sessions/`` dir is
    NOT chmod'd here on the assumption it already exists; tighten its mode
    out-of-band if needed.
    """
    session_dir = os.path.join('saved_sessions', crm_id)
    os.makedirs(session_dir, exist_ok=True)
    try:
        os.chmod(session_dir, 0o700)
    except OSError:
        # Different owner / read-only FS — don't crash, just continue.
        pass
    return os.path.join(session_dir, f'{of_user_id}.json')


def save_session(crm_id, of_user_id, session_data, proxy=None):
    """
    Save session data for a specific CRM panel and OF account.

    Files are written with mode 0600 — session cookies + proxy credentials
    would otherwise be readable by every local user on the host.

    Args:
        crm_id (str): CRM panel ID
        of_user_id (str): OnlyFans user ID
        session_data (dict): Session data from login
        proxy (str, optional): Proxy URL to save

    Returns:
        str: Path to saved session file
    """
    save_data = {
        'crm_id': crm_id,
        'user_id': session_data['user_id'],
        'data': session_data.get('data', {}),
        'cookies': session_data.get('cookies', {}),
        'x_hash': session_data.get('x_hash'),
        'x_bc': session_data.get('x_bc'),
        'proxy': proxy,
        'saved_at': datetime.utcnow().isoformat()
    }

    file_path = get_session_path(crm_id, of_user_id)
    # Open with explicit mode so we never race a world-readable window where
    # an attacker could read the cookies between create and chmod.
    fd = os.open(file_path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, 'w') as f:
        json.dump(save_data, f, indent=2)
    # Belt-and-suspenders: if the file already existed, os.open(O_CREAT) leaves
    # the prior mode in place — force-tighten it now.
    try:
        os.chmod(file_path, 0o600)
    except OSError:
        pass

    print(f'Session saved for CRM {crm_id}, user {of_user_id}: {file_path}')


def update_session_proxy(crm_id, of_user_id, proxy):
    """Rewrite the proxy stored in an existing saved session file.

    load_session() falls back to the session's stored proxy when no proxy is
    passed, so a proxy change made only at the account level wouldn't take
    effect until the next full login — the dead/old proxy would keep being
    resurrected. Calling this on every proxy update (including clearing it to
    None for direct/no-proxy mode) keeps the saved session in sync so the next
    request honours the change immediately. Cookies are preserved. Returns True
    if a session file existed and was updated."""
    file_path = get_session_path(crm_id, of_user_id)
    if not os.path.exists(file_path):
        return False
    try:
        with open(file_path, 'r') as f:
            data = json.load(f)
    except (OSError, ValueError):
        return False
    data['proxy'] = proxy or None
    fd = os.open(file_path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, 'w') as f:
        json.dump(data, f, indent=2)
    try:
        os.chmod(file_path, 0o600)
    except OSError:
        pass
    return True
    return file_path


def load_session(crm_id, of_user_id, proxy=None):
    """
    Load session for a specific CRM panel and OF account.

    Args:
        crm_id (str): CRM panel ID
        of_user_id (str): OnlyFans user ID
        proxy (str, optional): Proxy URL

    Returns:
        dict: Session data with restored session, or None if not found
    """
    file_path = get_session_path(crm_id, of_user_id)

    if not os.path.exists(file_path):
        print(f'No session found for CRM {crm_id}, user {of_user_id}')
        return None

    with open(file_path, 'r') as f:
        saved_data = json.load(f)

    # Verify session belongs to correct CRM
    if saved_data.get('crm_id') != crm_id:
        print(f'Session CRM mismatch! Expected {crm_id}, got {saved_data.get("crm_id")}')
        return None

    # Use saved proxy if no proxy provided
    if not proxy:
        proxy = saved_data.get('proxy')

    # Create session with Chrome 136 impersonation
    session = requests.Session(impersonate="chrome136")
    if proxy:
        session.proxies = {'http': proxy, 'https': proxy}

    # Restore cookies
    for cookie_name, cookie_value in saved_data.get('cookies', {}).items():
        session.cookies.set(cookie_name, cookie_value, domain='.onlyfans.com', path='/')

    return {
        'crm_id': crm_id,
        'user_id': saved_data['user_id'],
        'data': saved_data.get('data', {}),
        'cookies': saved_data.get('cookies', {}),
        'x_hash': saved_data.get('x_hash'),
        'x_bc': saved_data.get('x_bc'),
        'proxy': proxy,
        'session': session,
        'loaded_at': datetime.utcnow().isoformat(),
        'saved_at': saved_data.get('saved_at')
    }


def auto_create_session(crm_id, of_user_id, sess, auth_id, fp=None, proxy=None):
    """
    Create and save a session from raw cookies without full login verification.
    Performs a single CF init call, sets auth cookies, and saves for reuse.

    Returns:
        dict: Session data ready for make_authenticated_request()
    """
    session = requests.Session(impersonate="chrome136")
    if proxy:
        session.proxies = {'http': proxy, 'https': proxy}

    # CF init: unauthenticated /me call to establish Cloudflare cookies
    init_path = '/api2/v2/users/me'
    init_sign = generate_headers(init_path, user_id=0)
    x_bc = fp if fp else init_sign['x-bc']

    init_headers = {
        'host': 'onlyfans.com',
        'connection': 'keep-alive',
        'x-of-rev': config.X_OF_REV,
        'x-bc': x_bc,
        'sign': init_sign['sign'],
        'app-token': init_sign['app-token'],
        'time': init_sign['time'],
        'user-agent': config.USER_AGENT,
        'accept': 'application/json, text/plain, */*',
        'sec-ch-ua-platform': '"Windows"',
        'sec-ch-ua': '"Not:A-Brand";v="99", "Google Chrome";v="145", "Chromium";v="145"',
        'sec-ch-ua-mobile': '?0',
        'sec-fetch-site': 'same-origin',
        'sec-fetch-mode': 'cors',
        'sec-fetch-dest': 'empty',
        'referer': 'https://onlyfans.com/',
        'accept-encoding': 'gzip, deflate, br, zstd',
        'accept-language': 'en-US,en;q=0.9'
    }

    init_url = f'{config.OF_BASE_URL}{init_path}'
    session.get(init_url, headers=init_headers, timeout=REQUEST_TIMEOUT)

    # Set auth cookies
    session.cookies.set('sess', sess, domain='.onlyfans.com', path='/')
    session.cookies.set('auth_id', str(auth_id), domain='.onlyfans.com', path='/')
    if fp:
        session.cookies.set('fp', fp, domain='.onlyfans.com', path='/')

    # Fetch x-hash from CDN
    x_hash = None
    try:
        hash_url = 'https://cdn2.onlyfans.com/hash/'
        hash_headers = {
            'host': 'cdn2.onlyfans.com',
            'connection': 'keep-alive',
            'user-agent': config.USER_AGENT,
            'sec-ch-ua': '"Not:A-Brand";v="99", "Google Chrome";v="145", "Chromium";v="145"',
            'sec-ch-ua-mobile': '?0',
            'sec-ch-ua-platform': '"Windows"',
            'accept': '*/*',
            'origin': 'https://onlyfans.com',
            'sec-fetch-site': 'same-site',
            'sec-fetch-mode': 'cors',
            'sec-fetch-dest': 'empty',
            'referer': 'https://onlyfans.com/',
            'accept-encoding': 'gzip, deflate, br, zstd',
            'accept-language': 'en-US,en;q=0.9'
        }
        hash_response = session.get(hash_url, headers=hash_headers, params={'u': str(auth_id)}, timeout=REQUEST_TIMEOUT)
        if hash_response.status_code == 200:
            x_hash = hash_response.text.strip()
            print(f'  x-hash fetched: {x_hash[:20]}...')
    except Exception as e:
        print(f'  x-hash fetch failed (non-fatal): {e}')

    cookies = {'sess': sess, 'auth_id': str(auth_id), 'fp': fp or ''}

    session_data = {
        'crm_id': crm_id,
        'user_id': str(of_user_id),
        'data': {},
        'cookies': cookies,
        'x_hash': x_hash,
        'x_bc': x_bc,
        'proxy': proxy,
        'session': session,
    }

    # Save for reuse
    save_session(crm_id, str(of_user_id), session_data, proxy=proxy)
    print(f'Auto-created session for CRM {crm_id}, user {of_user_id}')

    return session_data


def create_authenticated_headers(session_data, path, method='GET'):
    """Create authenticated headers using session data."""
    sign_headers = generate_headers(path, user_id=int(session_data['user_id']))

    headers = {
        'accept': 'application/json, text/plain, */*',
        'accept-language': 'en-US,en;q=0.9',
        'app-token': sign_headers['app-token'],
        'priority': 'u=1, i',
        'sec-ch-ua': '"Not:A-Brand";v="99", "Google Chrome";v="145", "Chromium";v="145"',
        'sec-ch-ua-mobile': '?0',
        'sec-ch-ua-platform': '"Windows"',
        'sec-fetch-dest': 'empty',
        'sec-fetch-mode': 'cors',
        'sec-fetch-site': 'same-origin',
        'sign': sign_headers['sign'],
        'time': sign_headers['time'],
        'user-id': session_data['user_id'],
        'x-bc': session_data['x_bc'],
        'x-of-rev': config.X_OF_REV,
        'referer': 'https://onlyfans.com/',
        'user-agent': config.USER_AGENT
    }

    if session_data.get('x_hash'):
        headers['x-hash'] = session_data['x_hash']

    if method.upper() in ('POST', 'PATCH', 'PUT', 'DELETE'):
        headers['content-type'] = 'application/json'

    # Endpoint-specific referers
    if '/campaigns' in path:
        headers['referer'] = 'https://onlyfans.com/my/settings/subscription/tracking-links'
    elif '/earnings/' in path:
        headers['referer'] = 'https://onlyfans.com/my/statistics/statements/earnings'
    elif '/payouts/' in path:
        headers['referer'] = 'https://onlyfans.com/my/payouts'

    return headers


def make_authenticated_request(session_data, path, method='GET', body=None):
    """Make authenticated request using session data."""
    url = f'{config.OF_BASE_URL}{path}'
    session = session_data['session']

    method = method.upper()
    # OF rejects a bodyless request that still carries content-type:
    # application/json with 400 {"error":{"message":"Invalid JSON request:
    # Syntax error"}}. Endpoints like POST/DELETE .../messages/{id}/like and
    # DELETE .../messages/{id} (unsend) take no fields — the web app sends a
    # literal `{}`. So default a None body to {} on every method that carries
    # a JSON body. Signing is path-only, so the body never affects `sign`.
    json_body = {} if body is None else body
    with upstream_rate_controller.limit(session_data) as lease:
        # Generate the time-sensitive signature only after waiting for the
        # shared budget. A signature created before a Retry-After delay can be
        # stale by the time it reaches OnlyFans.
        headers = create_authenticated_headers(session_data, path, method)
        if method == 'GET':
            response = session.get(url, headers=headers, timeout=REQUEST_TIMEOUT)
        elif method == 'POST':
            response = session.post(url, headers=headers, json=json_body, timeout=REQUEST_TIMEOUT)
        elif method == 'PATCH':
            response = session.patch(url, headers=headers, json=json_body, timeout=REQUEST_TIMEOUT)
        elif method == 'PUT':
            response = session.put(url, headers=headers, json=json_body, timeout=REQUEST_TIMEOUT)
        elif method == 'DELETE':
            response = session.delete(url, headers=headers, json=json_body, timeout=REQUEST_TIMEOUT)
        else:
            raise ValueError(f'Unsupported method: {method}')
        lease.observe(response)
        return response
