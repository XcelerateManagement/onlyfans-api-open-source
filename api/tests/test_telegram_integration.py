#!/usr/bin/env python3
"""Scenario suite for the panel-level Telegram notification channel.

Covers crm_database.telegram_*, telegram_notify, telegram_updates, the Flask
routes, and the event_bus hook.

NO NETWORK. `requests.get/post/put/delete/request/Session` are replaced with a
stub before any app module is imported, and every scenario asserts against what
the stub recorded. A live Telegram bot exists in this org's infrastructure, so
the suite also fails loudly if anything ever restores the real `requests`
functions, and refuses to run against the production database.

    cd onlyfans-api && python3 tests/test_telegram_integration.py
"""

from __future__ import annotations

import json
import os
import sys
import traceback
from datetime import datetime, timedelta

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# ---------------------------------------------------------------------------
# Isolation — env BEFORE any app import
# ---------------------------------------------------------------------------

_DEFAULT_DB = ('/tmp/claude-1000/-home-ubuntu-apps-the-of-api/'
               '9545374a-5f9e-45b3-80af-bea56cf28f5c/scratchpad/telegram_test.db')

os.environ['WERKZEUG_RUN_MAIN'] = 'false'          # don't auto-start the scheduler
os.environ.setdefault('DATABASE_PATH', _DEFAULT_DB)
os.environ.setdefault('SECRET_KEY', 'x' * 40)
os.environ.setdefault('ENCRYPTION_KEY', 'y' * 40)
os.environ.setdefault('TWOCAPTCHA_API_KEY', 'z' * 16)

SHARED_TOKEN = '111111111:SHARED-bot-token-aaaaaaaaaaaaaaaaaaaaa'
SHARED_USERNAME = 'SharedTestBot'
os.environ['TELEGRAM_SHARED_BOT_TOKEN'] = SHARED_TOKEN
os.environ['TELEGRAM_SHARED_BOT_USERNAME'] = SHARED_USERNAME

_db_path = os.environ['DATABASE_PATH']
assert os.path.basename(_db_path) != 'crm_data.db', \
    f'refusing to run against the production database ({_db_path})'
os.makedirs(os.path.dirname(_db_path), exist_ok=True)
if os.path.exists(_db_path):
    os.remove(_db_path)

# ---------------------------------------------------------------------------
# Network stub — installed before app modules bind `requests`
# ---------------------------------------------------------------------------

import requests as _requests  # noqa: E402

_REAL = {name: getattr(_requests, name)
         for name in ('get', 'post', 'put', 'delete', 'request', 'Session')}

CALLS: list[dict] = []
# name -> callable(call) -> _Resp. Keyed on the Bot API method in the URL.
HANDLERS: dict[str, object] = {}


class _Resp:
    def __init__(self, payload=None, status_code=200, text=None):
        self.status_code = status_code
        self._payload = payload if payload is not None else {'ok': True, 'result': {}}
        self.text = text if text is not None else json.dumps(self._payload)
        self.headers = {}

    def json(self):
        return self._payload


def ok(result=None):
    return _Resp({'ok': True, 'result': result if result is not None else {}})


def api_error(status=400, description='Bad Request'):
    return _Resp({'ok': False, 'description': description}, status_code=status)


def _dispatch(method, url, **kw):
    call = {'method': method, 'url': url,
            'json': kw.get('json'), 'params': kw.get('params')}
    CALLS.append(call)
    if not url.startswith('https://api.telegram.org/'):
        raise AssertionError(f'test tried to reach a non-Telegram host: {url}')
    api_method = url.rsplit('/', 1)[-1]
    handler = HANDLERS.get(api_method)
    if handler is None:
        return ok()
    if callable(handler):
        return handler(call)
    return handler


def _blocked(*a, **kw):
    raise AssertionError('requests.Session is blocked in this suite')


_requests.get = lambda url, **kw: _dispatch('get', url, **kw)
_requests.post = lambda url, **kw: _dispatch('post', url, **kw)
_requests.put = lambda url, **kw: _dispatch('put', url, **kw)
_requests.delete = lambda url, **kw: _dispatch('delete', url, **kw)
_requests.request = lambda m, url, **kw: _dispatch(m, url, **kw)
_requests.Session = _blocked

import config                    # noqa: E402
import crm_database as db        # noqa: E402

import automation_engine         # noqa: E402
import event_bus                 # noqa: E402
import telegram_notify           # noqa: E402
import telegram_updates          # noqa: E402
import crm_api                   # noqa: E402

db.init_database()
CLIENT = crm_api.app.test_client()

CUSTOM_TOKEN = '222222222:CUSTOM-bot-token-bbbbbbbbbbbbbbbbbbbbb'

_failures: list[tuple[str, str]] = []


def scenario(fn):
    def run():
        CALLS.clear()
        HANDLERS.clear()
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


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

def new_panel(name='tg panel'):
    panel = db.create_crm_panel(name)
    return panel['crm_id'], panel['api_key']


def api(method, crm_id, api_key, path, body=None):
    kw = {'headers': {'X-API-Key': api_key}}
    if body is not None:
        kw['json'] = body
    resp = getattr(CLIENT, method)(f'/api/crm/{crm_id}/integrations/telegram{path}', **kw)
    return resp.status_code, resp.get_json(), resp.get_data(as_text=True)


def sent_messages():
    return [c for c in CALLS if c['url'].endswith('/sendMessage')]


def start_update(update_id, code, chat_id=-100123, title='Team chat', chat_type='group'):
    return {'update_id': update_id,
            'message': {'message_id': update_id,
                        'chat': {'id': chat_id, 'title': title, 'type': chat_type},
                        'text': f'/start {code}'}}


def pair_shared(crm_id, api_key, event_types=None):
    """Full happy-path pairing on the shared bot; returns the integration."""
    body = {'bot_mode': 'shared'}
    if event_types is not None:
        body['event_types'] = event_types
    status, data, _ = api('post', crm_id, api_key, '/pair', body)
    assert status == 200, (status, data)
    code = data['deep_link'].split('start=')[1]
    HANDLERS['getUpdates'] = ok([start_update(1000 + len(CALLS), code)])
    telegram_updates.poll_token(SHARED_TOKEN)
    HANDLERS.pop('getUpdates', None)
    integ = db.get_telegram_integration(crm_id)
    assert integ and integ['chat_id'], 'pairing did not bind a chat'
    return integ


def emit(crm_id, event_type='new_tip', payload=None, of_user_id='555'):
    return event_bus.emit(crm_id, of_user_id, event_type,
                          payload if payload is not None else {'amount': 5},
                          source_event_id=f'src-{datetime.utcnow().timestamp()}')


# ---------------------------------------------------------------------------
# Scenarios
# ---------------------------------------------------------------------------

@scenario
def s01_custom_token_is_encrypted_at_rest():
    """The bot token must not be readable by anyone with the DB file."""
    crm_id, api_key = new_panel()
    HANDLERS['getMe'] = ok({'id': 222222222, 'username': 'TenantBot'})
    status, data, _ = api('post', crm_id, api_key, '/pair',
                          {'bot_mode': 'custom', 'bot_token': CUSTOM_TOKEN})
    assert status == 200, (status, data)

    import sqlite3
    conn = sqlite3.connect(db.DB_FILE)
    stored = conn.execute(
        'SELECT encrypted_bot_token FROM telegram_integrations WHERE crm_id = ?',
        (crm_id,)).fetchone()[0]
    conn.close()

    assert stored, 'no token stored'
    assert CUSTOM_TOKEN not in stored, 'token stored in clear text'
    assert stored.startswith('gAAAAA'), f'not a Fernet ciphertext: {stored[:12]}'
    # ...and it round-trips through the same helper of_accounts passwords use.
    assert db.decrypt_password(stored) == CUSTOM_TOKEN

    # The whole raw file must not contain it either (covers a stray column).
    with open(db.DB_FILE, 'rb') as fh:
        assert CUSTOM_TOKEN.encode() not in fh.read(), 'token found in the DB file'


@scenario
def s02_token_never_appears_in_any_api_response():
    crm_id, api_key = new_panel()
    HANDLERS['getMe'] = ok({'id': 222222222, 'username': 'TenantBot'})

    bodies = []
    _, _, raw = api('post', crm_id, api_key, '/pair',
                    {'bot_mode': 'custom', 'bot_token': CUSTOM_TOKEN})
    bodies.append(('pair', raw))
    _, _, raw = api('get', crm_id, api_key, '')
    bodies.append(('get', raw))
    _, _, raw = api('patch', crm_id, api_key, '', {'event_types': ['new_tip']})
    bodies.append(('patch', raw))
    _, _, raw = api('post', crm_id, api_key, '/test')
    bodies.append(('test', raw))

    for label, raw in bodies:
        assert CUSTOM_TOKEN not in raw, f'{label} response leaked the token'
        # Not even a reversible prefix/suffix of the secret half.
        assert CUSTOM_TOKEN.split(':', 1)[1][:10] not in raw, \
            f'{label} response leaked part of the token'
        assert SHARED_TOKEN not in raw, f'{label} response leaked the shared token'

    payload = json.loads(bodies[1][1])['integration']
    assert payload['has_custom_token'] is True
    assert 'encrypted_bot_token' not in payload
    assert not any('token' in k for k in payload if k != 'has_custom_token'), payload.keys()


@scenario
def s03_panel_token_is_not_templated():
    """A secret must never pass through the template evaluator.

    Proven end-to-end: the stored token is given a value that WOULD be mangled
    by `{...}` substitution, then a real event is emitted. What lands in the
    outgoing URL has to be byte-identical to what was stored.
    """
    booby = '333333333:tok{payload.fan.username}-{payload.amount}-xxxxxxxxxxxx'
    crm_id, api_key = new_panel()
    HANDLERS['getMe'] = ok({'id': 333333333, 'username': 'TenantBot2'})
    status, data, _ = api('post', crm_id, api_key, '/pair',
                          {'bot_mode': 'custom', 'bot_token': booby})
    assert status == 200, (status, data)
    code = data['deep_link'].split('start=')[1]
    HANDLERS['getUpdates'] = ok([start_update(1, code)])
    telegram_updates.poll_custom_bots()
    HANDLERS.pop('getUpdates', None)

    CALLS.clear()
    emit(crm_id, 'new_tip', {'amount': 42, 'fan': {'username': 'whale'}})
    msgs = sent_messages()
    assert msgs, 'no message sent'
    assert f'/bot{booby}/sendMessage' in msgs[0]['url'], \
        f"token was rewritten in transit: {msgs[0]['url']}"
    assert 'whale' not in msgs[0]['url'].split('/sendMessage')[0], \
        'event data was substituted into the token'
    # The message body IS built from the event — that part is expected.
    assert 'whale' in msgs[0]['json']['text']


@scenario
def s04_automation_token_is_not_templated_either():
    """The pre-existing per-automation path ran the WHOLE action_params dict —
    bot token included — through _render_deep. Secret keys are now excluded."""
    booby = '444444444:tok{payload.fan.username}-yyyyyyyyyyyyyyyyyyyy'
    automation = {
        'id': 1, 'crm_id': 'crm_x', 'action_type': 'telegram',
        'action_params': {'bot_token': booby, 'chat_id': '{payload.fan.id}',
                          'message': 'hi {payload.fan.username}'},
    }
    event = {'event_type': 'new_tip',
             'payload': {'fan': {'id': '77', 'username': 'whale'}}}
    automation_engine._dispatch_action(automation, event)
    msgs = sent_messages()
    assert msgs, 'no message sent'
    body = msgs[0]['json']
    assert f'/bot{booby}/sendMessage' in msgs[0]['url'], 'token was templated'
    # Non-secret params still template, which is the documented behaviour.
    assert body['chat_id'] == '77', body
    assert body['text'] == 'hi whale', body


@scenario
def s05_pairing_code_is_single_use():
    crm_id, api_key = new_panel()
    status, data, _ = api('post', crm_id, api_key, '/pair', {'bot_mode': 'shared'})
    assert status == 200, (status, data)
    code = data['deep_link'].split('start=')[1]
    assert data['deep_link'] == f'https://t.me/{SHARED_USERNAME}?start={code}'

    assert db.redeem_telegram_pairing_code(code) == crm_id
    assert db.redeem_telegram_pairing_code(code) is None, 'code was reusable'
    assert db.redeem_telegram_pairing_code('never-issued') is None


@scenario
def s06_pairing_code_expires():
    crm_id, _ = new_panel()
    issued = db.create_telegram_pairing_code(crm_id, ttl_seconds=600)
    import sqlite3
    conn = sqlite3.connect(db.DB_FILE)
    conn.execute('UPDATE telegram_pairing_codes SET expires_at = ? WHERE code = ?',
                 ((datetime.utcnow() - timedelta(seconds=1)).isoformat(), issued['code']))
    conn.commit()
    conn.close()
    assert db.redeem_telegram_pairing_code(issued['code']) is None, 'expired code redeemed'
    assert crm_id not in db.list_crms_with_open_telegram_pairings()

    # A fresh issue supersedes the previous open code for that panel.
    first = db.create_telegram_pairing_code(crm_id)
    second = db.create_telegram_pairing_code(crm_id)
    assert db.redeem_telegram_pairing_code(first['code']) is None, 'stale code still live'
    assert db.redeem_telegram_pairing_code(second['code']) == crm_id


@scenario
def s07_start_command_binds_the_chat():
    crm_id, api_key = new_panel()
    _, data, _ = api('post', crm_id, api_key, '/pair', {'bot_mode': 'shared'})
    code = data['deep_link'].split('start=')[1]

    HANDLERS['getUpdates'] = ok([start_update(41, code, chat_id=-100777,
                                              title='Ops', chat_type='supergroup')])
    paired = telegram_updates.poll_token(SHARED_TOKEN)
    assert paired == 1, paired

    integ = db.get_telegram_integration(crm_id)
    assert integ['chat_id'] == '-100777'
    assert integ['chat_title'] == 'Ops'
    assert integ['chat_type'] == 'supergroup'
    assert integ['is_active'] == 1
    # Offset advanced past the handled update, so a re-poll can't replay it.
    assert db.get_telegram_offset(db.token_fingerprint(SHARED_TOKEN)) == 42
    # ...and the human got told it worked.
    assert any('Connected' in (c['json'] or {}).get('text', '') for c in sent_messages())


@scenario
def s08_event_filter_and_wildcard():
    crm_id, api_key = new_panel()
    pair_shared(crm_id, api_key, event_types=['new_tip'])

    CALLS.clear()
    emit(crm_id, 'new_tip', {'amount': 9})
    assert len(sent_messages()) == 1, 'subscribed type was not delivered'

    CALLS.clear()
    emit(crm_id, 'new_subscriber', {'fan': {'username': 'nope'}})
    assert sent_messages() == [], 'unsubscribed type was delivered'

    api('patch', crm_id, api_key, '', {'event_types': ['*']})
    CALLS.clear()
    emit(crm_id, 'new_subscriber', {'fan': {'username': 'yes'}})
    emit(crm_id, 'polling_paused', {'reason': 'session expired'})
    assert len(sent_messages()) == 2, 'wildcard did not deliver everything'

    # Inactive channel delivers nothing, even with a matching filter.
    api('patch', crm_id, api_key, '', {'is_active': False})
    CALLS.clear()
    emit(crm_id, 'new_tip', {'amount': 1})
    assert sent_messages() == [], 'deactivated channel still delivered'


@scenario
def s09_consecutive_failures_auto_deactivate():
    crm_id, api_key = new_panel()
    pair_shared(crm_id, api_key, event_types=['*'])
    HANDLERS['sendMessage'] = api_error(403, 'Forbidden: bot was blocked by the user')

    cap = config.TELEGRAM_MAX_CONSECUTIVE_FAILURES
    for i in range(cap):
        emit(crm_id, 'new_tip', {'amount': i})
        integ = db.get_telegram_integration(crm_id)
        assert integ['consecutive_failures'] == i + 1, (i, integ['consecutive_failures'])

    integ = db.get_telegram_integration(crm_id)
    assert integ['is_active'] == 0, 'channel not auto-deactivated'
    assert 'blocked by the user' in (integ['last_error'] or '')

    # Deactivated == stops spending requests.
    CALLS.clear()
    emit(crm_id, 'new_tip', {'amount': 99})
    assert sent_messages() == [], 'deactivated channel kept sending'

    # A success resets the counter, and re-enabling clears it too.
    HANDLERS['sendMessage'] = ok({'message_id': 1})
    api('patch', crm_id, api_key, '', {'is_active': True})
    integ = db.get_telegram_integration(crm_id)
    assert integ['consecutive_failures'] == 0 and integ['is_active'] == 1
    emit(crm_id, 'new_tip', {'amount': 100})
    assert db.get_telegram_integration(crm_id)['consecutive_failures'] == 0


@scenario
def s10_telegram_outage_does_not_break_emit():
    """Every failure mode Telegram can present must leave emit() intact: the
    event is still persisted, still SSE-broadcast, still webhook-fanned."""
    crm_id, api_key = new_panel()
    pair_shared(crm_id, api_key, event_types=['*'])

    broadcasts: list = []
    import sse_hub
    real_broadcast = sse_hub.hub.broadcast
    sse_hub.hub.broadcast = lambda cid, ev: broadcasts.append((cid, ev))

    def _explode(call):
        raise _requests.exceptions.ConnectTimeout('api.telegram.org timed out')

    try:
        for label, handler in (('timeout', _explode),
                               ('500', api_error(500, 'Internal Server Error')),
                               ('html', _Resp({}, status_code=502, text='<html>bad</html>')),
                               ('ok:false', _Resp({'ok': False, 'description': 'chat not found'}))):
            HANDLERS['sendMessage'] = handler
            before = len(db.list_events(crm_id, limit=500))
            evt = emit(crm_id, 'new_tip', {'amount': 1})
            assert evt is not None, f'{label}: emit returned None'
            after = db.list_events(crm_id, limit=500)
            assert len(after) == before + 1, f'{label}: event was not persisted'
            assert broadcasts and broadcasts[-1][0] == crm_id, f'{label}: SSE broadcast lost'
    finally:
        sse_hub.hub.broadcast = real_broadcast

    # The failures were counted, so the auto-deactivate rule still applies.
    assert db.get_telegram_integration(crm_id)['consecutive_failures'] >= 1


@scenario
def s11_shared_token_is_refused_where_a_tenant_supplies_one():
    crm_id, api_key = new_panel()
    status, data, _ = api('post', crm_id, api_key, '/pair',
                          {'bot_mode': 'custom', 'bot_token': SHARED_TOKEN})
    assert status == 400, (status, data)
    assert 'shared bot' in data['error']

    resp = CLIENT.post(f'/api/crm/{crm_id}/integrations/telegram/groups',
                       headers={'X-API-Key': api_key},
                       json={'bot_token': SHARED_TOKEN})
    assert resp.status_code == 400, resp.status_code
    assert 'shared bot' in resp.get_json()['error']
    assert not [c for c in CALLS if 'getUpdates' in c['url']], \
        'list_groups touched the shared bot channel'


@scenario
def s12_shared_mode_refuses_when_unconfigured():
    """No silent failure: with no shared token, shared pairing is an explicit
    409 rather than a deep link that can never resolve."""
    crm_id, api_key = new_panel()
    # Retire codes left open by earlier scenarios so "nothing to do" really is
    # nothing to do — drain() legitimately polls custom bots mid-pairing.
    import sqlite3
    conn = sqlite3.connect(db.DB_FILE)
    conn.execute('DELETE FROM telegram_pairing_codes')
    conn.commit()
    conn.close()

    saved_token, saved_user = config.TELEGRAM_SHARED_BOT_TOKEN, config.TELEGRAM_SHARED_BOT_USERNAME
    config.TELEGRAM_SHARED_BOT_TOKEN = None
    config.TELEGRAM_SHARED_BOT_USERNAME = None
    try:
        status, data, _ = api('post', crm_id, api_key, '/pair', {'bot_mode': 'shared'})
        assert status == 409, (status, data)
        assert 'not configured' in data['error']
        status, data, _ = api('get', crm_id, api_key, '')
        assert data['shared_bot_available'] is False
        # And the intake job has nothing to do rather than erroring.
        assert telegram_updates.drain() == 0
        assert CALLS == [], 'drain() called Telegram with no bot configured'
    finally:
        config.TELEGRAM_SHARED_BOT_TOKEN = saved_token
        config.TELEGRAM_SHARED_BOT_USERNAME = saved_user


@scenario
def s13_getupdates_conflict_is_surfaced_not_swallowed():
    """409 = another consumer owns the bot. It must not crash the job, must not
    advance the offset, and must be recorded."""
    HANDLERS['getUpdates'] = api_error(409, 'Conflict: can\'t use getUpdates while '
                                            'webhook is active')
    fp = db.token_fingerprint(SHARED_TOKEN)
    before = db.get_telegram_offset(fp)
    assert telegram_updates.poll_token(SHARED_TOKEN) == 0
    assert db.get_telegram_offset(fp) == before, 'offset advanced on a failed poll'

    import sqlite3
    conn = sqlite3.connect(db.DB_FILE)
    err = conn.execute('SELECT last_error FROM telegram_bot_state WHERE token_fingerprint = ?',
                       (fp,)).fetchone()[0]
    conn.close()
    assert '409' in (err or ''), err


@scenario
def s14_cross_panel_code_cannot_hijack_a_custom_bot():
    """A code issued for panel A, replayed into panel B's own bot, must not
    cross-wire the two panels' notifications."""
    crm_a, key_a = new_panel('A')
    crm_b, key_b = new_panel('B')
    api('post', crm_a, key_a, '/pair', {'bot_mode': 'shared'})
    code_a = db.create_telegram_pairing_code(crm_a)['code']

    HANDLERS['getMe'] = ok({'id': 222222222, 'username': 'BsBot'})
    api('post', crm_b, key_b, '/pair', {'bot_mode': 'custom', 'bot_token': CUSTOM_TOKEN})

    HANDLERS['getUpdates'] = ok([start_update(9001, code_a, chat_id=-1)])
    telegram_updates.poll_custom_bots()

    assert db.get_telegram_integration(crm_a)['chat_id'] is None, 'panel A was hijacked'
    assert db.get_telegram_integration(crm_b)['chat_id'] is None, 'panel B bound a foreign code'
    # ...and the replay must not have BURNED A's single-use code, or anyone who
    # learns a code could deny the owner their pairing.
    assert db.peek_telegram_pairing_code(code_a) == crm_a, "A's code was consumed by the replay"


@scenario
def s15_disconnect_removes_everything():
    crm_id, api_key = new_panel()
    pair_shared(crm_id, api_key)
    db.create_telegram_pairing_code(crm_id)

    status, _, _ = api('delete', crm_id, api_key, '')
    assert status == 200
    assert db.get_telegram_integration(crm_id) is None
    assert crm_id not in db.list_crms_with_open_telegram_pairings()

    CALLS.clear()
    emit(crm_id, 'new_tip', {'amount': 3})
    assert sent_messages() == [], 'disconnected panel still received notifications'
    # Second delete is a clean 404, not a 500.
    assert api('delete', crm_id, api_key, '')[0] == 404


@scenario
def s16_rebinding_a_bot_unpairs_the_old_chat():
    crm_id, api_key = new_panel()
    pair_shared(crm_id, api_key)
    assert db.get_telegram_integration(crm_id)['chat_id']

    HANDLERS['getMe'] = ok({'id': 222222222, 'username': 'TenantBot'})
    api('post', crm_id, api_key, '/pair',
        {'bot_mode': 'custom', 'bot_token': CUSTOM_TOKEN})
    integ = db.get_telegram_integration(crm_id)
    assert integ['chat_id'] is None, 'old chat survived a bot change'
    assert integ['is_active'] == 0
    assert integ['bot_mode'] == 'custom'

    CALLS.clear()
    emit(crm_id, 'new_tip', {'amount': 4})
    assert sent_messages() == [], 'unpaired channel delivered'


@scenario
def s17_panel_isolation():
    crm_a, key_a = new_panel('A')
    crm_b, key_b = new_panel('B')
    pair_shared(crm_a, key_a, event_types=['*'])
    pair_shared(crm_b, key_b, event_types=['*'])

    CALLS.clear()
    emit(crm_a, 'new_tip', {'amount': 7})
    msgs = sent_messages()
    assert len(msgs) == 1, msgs
    assert str(msgs[0]['json']['chat_id']) == db.get_telegram_integration(crm_a)['chat_id']

    # Another panel's API key can't read or change this panel's integration.
    status, _, _ = api('get', crm_a, key_b, '')
    assert status in (401, 403), status


@scenario
def s18_bad_input_is_rejected():
    crm_id, api_key = new_panel()
    for body, expect in (
        ({'bot_mode': 'nonsense'}, 400),
        ({'bot_mode': 'custom'}, 400),                       # missing token
        ({'bot_mode': 'custom', 'bot_token': 'not-a-token'}, 400),
        ({'bot_mode': 'custom', 'bot_token': '12345:short'}, 400),
        ({'bot_mode': 'shared', 'event_types': ['not_an_event']}, 400),
    ):
        status, data, _ = api('post', crm_id, api_key, '/pair', body)
        assert status == expect, (body, status, data)
    assert db.get_telegram_integration(crm_id) is None, 'a rejected pair wrote a row'

    # PATCH/test on a panel with no integration are 404, not 500.
    assert api('patch', crm_id, api_key, '', {'is_active': True})[0] == 404
    assert api('post', crm_id, api_key, '/test')[0] == 400


@scenario
def s19_test_send_uses_the_live_path():
    crm_id, api_key = new_panel()
    pair_shared(crm_id, api_key)
    CALLS.clear()
    status, data, _ = api('post', crm_id, api_key, '/test')
    assert status == 200 and data['success'] is True, (status, data)
    msgs = sent_messages()
    assert len(msgs) == 1 and 'Test message' in msgs[0]['json']['text']

    HANDLERS['sendMessage'] = api_error(400, 'chat not found')
    status, data, _ = api('post', crm_id, api_key, '/test')
    assert status == 400 and data['success'] is False, (status, data)
    assert 'chat not found' in data['error']
    assert db.get_telegram_integration(crm_id)['consecutive_failures'] == 1


@scenario
def s20_message_body_is_built_not_evaluated():
    """Payload strings are attacker-influenced (a fan picks their own display
    name). They land in the message text verbatim and are never expanded."""
    text = telegram_notify.format_event({
        'event_type': 'new_tip', 'of_user_id': '555',
        'payload': {'amount': 10, 'fan': {'username': '{payload.crm_id}'},
                    'text': 'thanks {payload.amount}'},
        'crm_id': 'crm_secret',
    })
    assert '{payload.crm_id}' in text, text
    assert 'crm_secret' not in text, 'templating expanded a payload string'
    assert '💸' in text and 'Amount: $10' in text


@scenario
def s21_telegram_table_is_panel_scoped_not_account_scoped():
    """Documents the deliberate omission from _ACCOUNT_SCOPED_PURGES: the
    channel belongs to the panel, so disconnecting one OF account must not
    silently kill notifications for the other accounts on that panel."""
    purged = {name for name, _ in db._ACCOUNT_SCOPED_PURGES}
    assert 'telegram_integrations' not in purged
    import sqlite3
    conn = sqlite3.connect(db.DB_FILE)
    cols = [r[1] for r in conn.execute('PRAGMA table_info(telegram_integrations)')]
    conn.close()
    assert 'of_user_id' not in cols, \
        'table gained an of_user_id column — it must now be registered in ' \
        '_ACCOUNT_SCOPED_PURGES (see tests/test_account_deletion.py::s12)'

    crm_id, api_key = new_panel()
    pair_shared(crm_id, api_key, event_types=['*'])
    db.add_of_account(crm_id, '999', 'x@y.test', password='pw', username='u999')
    db.delete_of_account(crm_id, '999', purge_now=True)
    assert db.get_telegram_integration(crm_id) is not None, \
        'disconnecting an account destroyed the panel Telegram channel'


def main():
    scenarios = [
        s01_custom_token_is_encrypted_at_rest,
        s02_token_never_appears_in_any_api_response,
        s03_panel_token_is_not_templated,
        s04_automation_token_is_not_templated_either,
        s05_pairing_code_is_single_use,
        s06_pairing_code_expires,
        s07_start_command_binds_the_chat,
        s08_event_filter_and_wildcard,
        s09_consecutive_failures_auto_deactivate,
        s10_telegram_outage_does_not_break_emit,
        s11_shared_token_is_refused_where_a_tenant_supplies_one,
        s12_shared_mode_refuses_when_unconfigured,
        s13_getupdates_conflict_is_surfaced_not_swallowed,
        s14_cross_panel_code_cannot_hijack_a_custom_bot,
        s15_disconnect_removes_everything,
        s16_rebinding_a_bot_unpairs_the_old_chat,
        s17_panel_isolation,
        s18_bad_input_is_rejected,
        s19_test_send_uses_the_live_path,
        s20_message_body_is_built_not_evaluated,
        s21_telegram_table_is_panel_scoped_not_account_scoped,
    ]
    print(f"Running {len(scenarios)} Telegram integration scenarios "
          f"(DB={db.DB_FILE}, network stubbed)")
    for s in scenarios:
        s()
    print()

    # Belt and braces: nothing may have restored the real HTTP client.
    for name, real in _REAL.items():
        if getattr(_requests, name) is real:
            print(f"FAILED: requests.{name} was restored — this suite must never "
                  f"be able to reach api.telegram.org")
            sys.exit(1)

    if _failures:
        print(f"FAILED: {len(_failures)}")
        for name, msg in _failures:
            print(f"  - {name}: {msg}")
        sys.exit(1)
    print(f"All {len(scenarios)} scenarios passed.")


if __name__ == "__main__":
    main()
