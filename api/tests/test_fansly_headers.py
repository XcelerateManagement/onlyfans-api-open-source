#!/usr/bin/env python3
"""Known-answer + structural tests for fansly_header_generator.

Does NOT hit the network. Locks down the cyrb53 digest (so a future Fansly
hash/salt rotation is caught immediately) and the five-header assembly. The
reference digests were cross-checked against the deployed fansly_bot.py
implementation. Run:

    cd onlyfans-api && python3 tests/test_fansly_headers.py
"""

from __future__ import annotations

import os
import sys
import traceback

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import config  # noqa: E402
import fansly_header_generator as fhg  # noqa: E402

_failures: list[tuple[str, str]] = []

# Fixed device id so client-check digests are deterministic.
DEV = 'deadbeefdeadbeefdeadbeefdeadbeef'

# Reference cyrb53 values (verified against the deployed fansly_bot.cyrb53).
CYRB53_KAT = {
    'hello': 4625896200565286,
    '': 3338908027751811,
    'a': 7929297801672961,
    '/api/v1/account/me': 8000744171149134,
}
# client-check = cyrb53(salt + "_" + path + "_" + device).toString(16)
CHECK_KAT = {
    '/api/v1/account/me': '1c0a435c96ff6c',
}


def scenario(fn):
    def run():
        try:
            fn()
            print(f"  ✓ {fn.__name__}")
        except AssertionError as e:
            _failures.append((fn.__name__, str(e)))
            print(f"  ✗ {fn.__name__}: {e}")
        except Exception:
            _failures.append((fn.__name__, traceback.format_exc()))
            print(f"  ✗ {fn.__name__} raised:\n{traceback.format_exc()}")
    return run


@scenario
def s01_cyrb53_known_answers():
    for key, expected in CYRB53_KAT.items():
        got = fhg.cyrb53(key)
        assert got == expected, f'cyrb53({key!r})={got} != {expected}'


@scenario
def s02_cyrb53_seed_changes_output():
    assert fhg.cyrb53('abc', 0) != fhg.cyrb53('abc', 1)


@scenario
def s03_client_check_known_answer():
    # Pin the salt so the KAT stays meaningful even if env overrides exist.
    assert config.FANSLY_CLIENT_CHECK_SALT == 'necvac-govry3-tybkYz', \
        f'salt changed: {config.FANSLY_CLIENT_CHECK_SALT!r}'
    for path, expected in CHECK_KAT.items():
        got = fhg.generate_client_check(path, DEV)
        assert got == expected, f'check({path})={got} != {expected}'


@scenario
def s04_client_check_is_cached_and_path_bound():
    a = fhg.generate_client_check('/api/v1/account/me', DEV)
    b = fhg.generate_client_check('/api/v1/account/me', DEV)
    assert a == b, 'same (path,device) must yield same digest'
    c = fhg.generate_client_check('/api/v1/wallet/transaction', DEV)
    assert c != a, 'different path must yield different digest'


@scenario
def s05_headers_full_assembly():
    hdrs, used = fhg.generate_fansly_headers(
        '/api/v1/account/me', auth_token='TOK', device_id=DEV,
        session_id='SID', method='GET',
    )
    assert used == DEV
    assert hdrs['fansly-client-id'] == DEV
    assert hdrs['fansly-session-id'] == 'SID'
    assert hdrs['authorization'] == 'TOK'
    assert hdrs['fansly-client-check'] == CHECK_KAT['/api/v1/account/me']
    assert hdrs['fansly-client-ts'].isdigit()
    assert 'content-type' not in hdrs  # GET carries no body content-type
    assert DEV in hdrs['Cookie']


@scenario
def s06_post_sets_content_type_and_mints_device():
    hdrs, used = fhg.generate_fansly_headers('/api/v1/login', method='POST')
    assert hdrs['content-type'] == 'application/json'
    assert len(used) == 32 and used != DEV  # freshly minted device id


@scenario
def s07_unauthenticated_omits_auth_headers():
    hdrs, _ = fhg.generate_fansly_headers('/api/v1/registernew', method='POST')
    assert 'authorization' not in hdrs
    assert 'fansly-session-id' not in hdrs


def main():
    print('Running fansly_header_generator known-answer tests')
    for name in sorted(n for n in globals() if n.startswith('s0') or n.startswith('s1')):
        globals()[name]()
    print()
    if _failures:
        print(f'{len(_failures)} FAILED')
        sys.exit(1)
    print('All fansly header tests passed.')


if __name__ == '__main__':
    main()
