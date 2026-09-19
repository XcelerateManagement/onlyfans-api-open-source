#!/usr/bin/env python3
"""Multi-tenant session persistence + authenticated request building for Fansly.

The Fansly analogue of ``multi_tenant_auth.py``. Same per-CRM isolation, same
file-permission hardening, same ``make_authenticated_request`` contract — but
the session payload is Fansly-shaped (bearer token + device id + session id +
cookies) rather than OF-shaped (sess/auth_id cookies + x_bc/x_hash).

Fansly sessions are stored alongside OF sessions under
``saved_sessions/{crm_id}/`` but with a ``.fansly.json`` suffix so the two
formats can never be confused by the wrong loader.
"""

import json
import os
from datetime import datetime

from curl_cffi import requests

import config
import fansly_header_generator as fhg


def get_session_path(crm_id, account_id):
    """Per-tenant Fansly session file path (dir created 0700, mirrors OF)."""
    session_dir = os.path.join('saved_sessions', crm_id)
    os.makedirs(session_dir, exist_ok=True)
    try:
        os.chmod(session_dir, 0o700)
    except OSError:
        pass
    return os.path.join(session_dir, f'{account_id}.fansly.json')


def save_session(crm_id, account_id, session_data, proxy=None):
    """Persist a Fansly session (mode 0600 — it holds a bearer token + cookies).

    ``session_data`` is expected to carry: ``auth_token``, ``fansly_client_id``,
    ``fansly_session_id``, and optionally ``session_cookies`` (dict).
    """
    save_data = {
        'crm_id': crm_id,
        'platform': 'fansly',
        'account_id': str(account_id),
        'auth_token': session_data.get('auth_token'),
        'fansly_client_id': session_data.get('fansly_client_id'),
        'fansly_session_id': session_data.get('fansly_session_id'),
        'session_cookies': session_data.get('session_cookies', {}) or {},
        'data': session_data.get('data', {}),
        'proxy': proxy,
        'saved_at': datetime.utcnow().isoformat(),
    }

    file_path = get_session_path(crm_id, account_id)
    fd = os.open(file_path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, 'w') as f:
        json.dump(save_data, f, indent=2)
    try:
        os.chmod(file_path, 0o600)
    except OSError:
        pass

    print(f'Fansly session saved for CRM {crm_id}, account {account_id}: {file_path}')
    return file_path


def load_session(crm_id, account_id, proxy=None):
    """Load a Fansly session and rebuild its curl_cffi Session, or None."""
    file_path = get_session_path(crm_id, account_id)
    if not os.path.exists(file_path):
        print(f'No Fansly session for CRM {crm_id}, account {account_id}')
        return None

    with open(file_path, 'r') as f:
        saved = json.load(f)

    if saved.get('crm_id') != crm_id:
        print(f'Fansly session CRM mismatch! Expected {crm_id}, got {saved.get("crm_id")}')
        return None

    if not proxy:
        proxy = saved.get('proxy')

    session = requests.Session(impersonate='chrome136')
    if proxy:
        session.proxies = {'http': proxy, 'https': proxy}

    for name, value in (saved.get('session_cookies') or {}).items():
        session.cookies.set(name, value, domain='fansly.com')

    return {
        'crm_id': crm_id,
        'account_id': saved['account_id'],
        'auth_token': saved.get('auth_token'),
        'fansly_client_id': saved.get('fansly_client_id'),
        'fansly_session_id': saved.get('fansly_session_id'),
        'session_cookies': saved.get('session_cookies', {}),
        'data': saved.get('data', {}),
        'proxy': proxy,
        'session': session,
        'loaded_at': datetime.utcnow().isoformat(),
        'saved_at': saved.get('saved_at'),
    }


def create_authenticated_headers(session_data, path, method='GET'):
    """Build Fansly request headers from a loaded session."""
    headers, _ = fhg.generate_fansly_headers(
        path,
        auth_token=session_data.get('auth_token'),
        device_id=session_data.get('fansly_client_id'),
        session_id=session_data.get('fansly_session_id'),
        method=method,
    )
    return headers


def make_authenticated_request(session_data, path, method='GET', body=None):
    """Issue an authenticated Fansly API request.

    ``path`` must include the ``/api/v1`` prefix (e.g. ``/api/v1/account/me``).
    The SPA appends ``ngsw-bypass=true`` to dodge its service worker; we mirror
    that. The query string is not part of the client-check, so appending it is
    safe.
    """
    sep = '&' if '?' in path else '?'
    url = f'{config.FANSLY_BASE_URL}{path}{sep}ngsw-bypass=true'
    headers = create_authenticated_headers(session_data, path, method)
    session = session_data['session']

    method = method.upper()
    timeout = config.FANSLY_REQUEST_TIMEOUT
    if method == 'GET':
        resp = session.get(url, headers=headers, timeout=timeout)
    elif method == 'POST':
        resp = session.post(url, headers=headers, json=body, timeout=timeout)
    elif method == 'PATCH':
        resp = session.patch(url, headers=headers, json=body, timeout=timeout)
    elif method == 'PUT':
        resp = session.put(url, headers=headers, json=body, timeout=timeout)
    elif method == 'DELETE':
        resp = session.delete(url, headers=headers, timeout=timeout)
    else:
        raise ValueError(f'Unsupported method: {method}')

    # Keep this device's clock aligned with the server for the next request.
    try:
        fhg.update_server_offset(session_data.get('fansly_client_id'), resp)
    except Exception:
        pass

    return resp
