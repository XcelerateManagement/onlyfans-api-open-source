"""Best-effort IP / proxy geolocation for the accounts-list country flags.

Pure network helpers — no DB, no OnlyFans. Uses the ip-api.com free tier (no
key, ~45 req/min per source IP). Every function fails SOFT: it returns None
rather than raising, so a country flag is simply absent when geo can't be
determined, and a slow/dead proxy never breaks the caller.

Results are cached by the caller (crm_api.backfill_account_geo → of_accounts),
so these run once per account in the background, not on every list load.
"""

import logging

import requests

log = logging.getLogger(__name__)

# Ask ip-api for only the two fields we store — smaller payload, and it keeps
# us well under the free-tier field limit.
_IPAPI_URL = "http://ip-api.com/json/{ip}?fields=status,country,countryCode"


def geolocate_ip(ip, timeout=4):
    """{country, country_code} for an IP (or hostname), or None."""
    if not ip:
        return None
    try:
        r = requests.get(_IPAPI_URL.format(ip=ip), timeout=timeout)
        if r.status_code != 200:
            return None
        j = r.json()
    except Exception:
        return None
    if not isinstance(j, dict) or j.get("status") != "success":
        return None
    code = j.get("countryCode")
    if not (isinstance(code, str) and len(code) == 2 and code.isalpha()):
        return None
    return {"country": j.get("country"), "country_code": code.upper()}


def resolve_proxy_exit_country(proxy, timeout=8):
    """The proxy's REAL exit country.

    Probes api.ipify.org *through* the proxy to learn the exit IP, then
    geolocates that IP. This is the accurate answer — geolocating the proxy
    hostname would report the provider's gateway, which for rotating/residential
    pools is routinely a different country than the exit. Returns
    {country, country_code} or None.
    """
    if not proxy:
        return None
    try:
        r = requests.get(
            "https://api.ipify.org?format=json",
            proxies={"http": proxy, "https": proxy},
            timeout=timeout,
        )
        if r.status_code != 200:
            return None
        exit_ip = (r.json() or {}).get("ip")
    except Exception:
        return None
    return geolocate_ip(exit_ip)
