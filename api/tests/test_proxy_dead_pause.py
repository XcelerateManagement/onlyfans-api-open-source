#!/usr/bin/env python3
"""The poller confirms a dead proxy before pausing an account, and a reachable
proxy is NOT paused on proxy grounds until the generic safety threshold.

    python tests/test_proxy_dead_pause.py
"""

import os
import sys
import tempfile

os.environ['WERKZEUG_RUN_MAIN'] = 'false'
os.environ.setdefault('DATABASE_PATH', tempfile.mktemp(suffix='.db'))
os.environ.setdefault('SECRET_KEY', 'x' * 40)
os.environ.setdefault('ENCRYPTION_KEY', 'y' * 40)
os.environ.setdefault('TWOCAPTCHA_API_KEY', 'z' * 16)

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import crm_database as db          # noqa: E402
import poller                      # noqa: E402
import proxy_health               # noqa: E402
import event_bus                   # noqa: E402

db.init_database()
_failures = []


def check(name, cond, detail=''):
    print(f"  [{'PASS' if cond else 'FAIL'}] {name}" + (f'  ({detail})' if detail and not cond else ''))
    if not cond:
        _failures.append(name)


panel = db.create_crm_panel('Proxy Pause Test')
CRM_ID = panel['crm_id']

# Don't hit the real network / event bus.
_emitted = []
event_bus.emit = lambda *a, **k: _emitted.append((a, k))
poller.event_bus.emit = event_bus.emit


def _fresh(uid, proxy='http://u:p@1.2.3.4:8080', failures=4):
    db.add_of_account(crm_id=CRM_ID, of_user_id=uid, email=f'{uid}@e.test',
                      password='pw', username=uid, x_bc='b', x_hash='h', proxy=proxy)
    db.update_account_polling(CRM_ID, uid, enabled=True, interval_seconds=300)
    # Simulate `failures` consecutive poll failures.
    for _ in range(failures):
        db.save_polling_cursor(CRM_ID, uid, None, success=False)


def _enabled(uid):
    info = db.get_account_polling(CRM_ID, uid) or {}
    return bool(info.get('polling_enabled')), info.get('polling_failure_count')


_real_probe = proxy_health.probe

print('\n-- dead proxy: confirmed, then paused --')
proxy_health.probe = lambda proxy, timeout=8: {'alive': False, 'reason': 'refused', 'latency_ms': None}
_fresh('dead1', failures=3)
_emitted.clear()
poller._auto_pause_if_needed(CRM_ID, 'dead1')
on, fc = _enabled('dead1')
check('dead proxy pauses polling', on is False, f'enabled={on}')
acct = db.get_of_account(CRM_ID, 'dead1')
check('records a proxy_error connection state', acct.get('last_connection_state') == 'proxy_error',
      str(acct.get('last_connection_state')))
check('emits polling_paused with proxy_unreachable reason',
      any(e[0][2] == 'polling_paused' and e[1].get('payload', {}).get('reason') == 'proxy_unreachable'
          for e in _emitted), str(_emitted))

print('\n-- reachable proxy: NOT paused as dead (below safety threshold) --')
proxy_health.probe = lambda proxy, timeout=8: {'alive': True, 'reason': 'ok', 'latency_ms': 120}
_fresh('live1', failures=3)  # 3 failures, proxy alive, threshold is 5
poller._auto_pause_if_needed(CRM_ID, 'live1')
on, fc = _enabled('live1')
check('reachable proxy at 3 failures stays polling', on is True, f'enabled={on} fc={fc}')

print('\n-- reachable proxy but 5+ failures: generic safety pause --')
_fresh('live2', failures=6)  # proxy alive but 6 failures -> backstop pause
_emitted.clear()
poller._auto_pause_if_needed(CRM_ID, 'live2')
on, _ = _enabled('live2')
check('reachable proxy still paused at the safety threshold', on is False, f'enabled={on}')
check('safety pause reason is consecutive failures',
      any(e[1].get('payload', {}).get('reason') == 'consecutive failures' for e in _emitted),
      str(_emitted))

print('\n-- below the proxy-check threshold: nothing happens --')
proxy_health.probe = lambda *a, **k: (_ for _ in ()).throw(AssertionError('should not probe below threshold'))
_fresh('early1', failures=2)  # only 2 failures, threshold is 3
poller._auto_pause_if_needed(CRM_ID, 'early1')
on, _ = _enabled('early1')
check('no probe / no pause below threshold', on is True, f'enabled={on}')
proxy_health.probe = _real_probe

print('\n-- re-enabling clears the failure count (fixed proxy = clean start) --')
db.update_account_polling(CRM_ID, 'dead1', enabled=True, interval_seconds=300)
on, fc = _enabled('dead1')
check('re-enable turns polling back on', on is True)
check('re-enable resets failure count to 0', fc == 0, str(fc))
acct = db.get_of_account(CRM_ID, 'dead1')
check('re-enable clears the connection error', not acct.get('last_connection_state'),
      str(acct.get('last_connection_state')))

print('\n-- proxy_health.probe: no proxy -> alive is None (not dead) --')
r = _real_probe(None)
check('no proxy returns alive=None', r['alive'] is None, str(r))

print()
if _failures:
    print(f'FAILED: {len(_failures)}')
    for n in _failures:
        print(f'  - {n}')
    sys.exit(1)
print('ALL PASS')
