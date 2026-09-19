#!/usr/bin/env python3
"""Platform dispatcher — routes an authenticated request to the right backend
client based on the account's ``platform`` field.

This is the single seam the rest of the app uses to stay platform-agnostic.
New code that touches a creator account should call
``handle_platform_request`` instead of ``of_client.handle_of_request``
directly; existing OF call sites keep working unchanged because the default
platform is ``onlyfans``.

A plain if/else over two backends — intentionally not a class hierarchy. The
codebase is procedural module functions; a registry/strategy pattern would add
indirection without buying anything until there's a third platform.
"""

import crm_database as db
import of_client
import fansly_client

PLATFORM_OF = 'onlyfans'
PLATFORM_FANSLY = 'fansly'
SUPPORTED_PLATFORMS = (PLATFORM_OF, PLATFORM_FANSLY)


def get_platform(crm_id, user_id):
    """Resolve an account's platform, defaulting to OnlyFans."""
    account = db.get_of_account(crm_id, user_id)
    return (account or {}).get('platform') or PLATFORM_OF


def handle_platform_request(crm_id, user_id, path, method='GET', body=None, proxy=None, platform=None):
    """Dispatch an authenticated API request to the account's platform client.

    NOTE: ``path`` is platform-native and the caller is responsible for passing
    the correct one (OF ``/api2/v2/...`` vs Fansly ``/api/v1/...``). This
    dispatcher only chooses the transport; it does not translate paths or
    normalize responses (that lives in the per-route branching).

    Returns: (success, data_or_error, status_code, relogin_flag)
    """
    if platform is None:
        platform = get_platform(crm_id, user_id)

    if platform == PLATFORM_FANSLY:
        return fansly_client.handle_fansly_request(crm_id, user_id, path, method, body, proxy)
    return of_client.handle_of_request(crm_id, user_id, path, method, body, proxy)
