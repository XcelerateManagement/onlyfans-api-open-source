#!/usr/bin/env python3
"""Auto-enable polling on connect: a connect starts polling at the default
interval, and polling-incapable platforms stay off.

(The hosted build additionally gated this on a paid plan. There are no plans in
this build, so every successful connect auto-enables.)

    python tests/test_polling_default.py
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

import config                      # noqa: E402
import crm_database as db          # noqa: E402
import crm_api                     # noqa: E402
import platform_features as pf     # noqa: E402

db.init_database()
_failures = []


def check(name, cond, detail=''):
    print(f"  [{'PASS' if cond else 'FAIL'}] {name}" + (f'  ({detail})' if detail and not cond else ''))
    if not cond:
        _failures.append(name)


# Stub the scheduler side-effects so no real jobs/threads start in the test.
_activations = []
crm_api._scheduler.schedule_account = lambda crm_id, uid, interval: _activations.append((crm_id, uid, interval))
crm_api._scheduler.start_ws_listener = lambda *a, **k: None
crm_api._scheduler.start_fansly_ws_listener = lambda *a, **k: None
crm_api.scheduler_mod.run_in_background = lambda *a, **k: None

panel = db.create_crm_panel('Polling Default Panel')
CRM_ID = panel['crm_id']


def _fresh_account(uid, platform='onlyfans'):
    db.add_of_account(crm_id=CRM_ID, of_user_id=uid, email=f'{uid}@e.test',
                      password='pw', username=uid, x_bc='b', x_hash='h',
                      proxy=None, platform=platform)


def _polling_on(uid):
    info = db.get_account_polling(CRM_ID, uid)
    return bool(info and info.get('polling_enabled')), (info or {}).get('polling_interval_seconds')


print('\n-- connect auto-enables at the default interval --')
_fresh_account('paid1')
crm_api._auto_enable_polling_on_connect(CRM_ID, 'paid1', 'onlyfans')
on, interval = _polling_on('paid1')
check('connect turns polling on', on is True)
check('at DEFAULT_PAID_POLL_INTERVAL', interval == crm_api.PAID_POLL_INTERVAL, str(interval))
check('the poll job was scheduled at 300s',
      _activations and _activations[-1] == (CRM_ID, 'paid1', crm_api.PAID_POLL_INTERVAL),
      str(_activations[-1] if _activations else None))

print('\n-- platform polling disabled: stays off --')
_real_caps = pf.capabilities
pf.capabilities = lambda platform: {**_real_caps(platform), 'polling': False}
_fresh_account('paidnopoll')
crm_api._auto_enable_polling_on_connect(CRM_ID, 'paidnopoll', 'onlyfans')
on, _ = _polling_on('paidnopoll')
check('polling-incapable platform stays off', on is False)
pf.capabilities = _real_caps

print('\n-- already-on account is left untouched (no interval reset) --')
_fresh_account('already')
db.update_account_polling(CRM_ID, 'already', enabled=True, interval_seconds=60)
_activations.clear()
crm_api._auto_enable_polling_on_connect(CRM_ID, 'already', 'onlyfans')
on, interval = _polling_on('already')
check('still on', on is True)
check('interval NOT reset to 300 (kept the 60s override)', interval == 60, str(interval))
check('no re-activation for an already-on account', _activations == [], str(_activations))

print()
if _failures:
    print(f'FAILED: {len(_failures)}')
    for n in _failures:
        print(f'  - {n}')
    sys.exit(1)
print('ALL PASS')
