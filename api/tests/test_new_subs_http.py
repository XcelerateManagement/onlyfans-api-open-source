#!/usr/bin/env python3
"""HTTP-level tests for the new-subscriber tracking endpoints.

Covers:
  - GET /accounts/<id>/subscribers/new     (windowed list with timestamps)
  - GET /accounts/<id>/subscribers/stats   (hour/day/week/month buckets)
  - GET /events?types=&since=&until=       (until is new)
  - GET /events/stream?types=              (server-side SSE type filter)

Runs against a throwaway DB via Flask's test_client — zero network calls.

    python tests/test_new_subs_http.py
"""

import os
import sys
import tempfile

# Isolate from the real deployment BEFORE importing app modules.
os.environ['WERKZEUG_RUN_MAIN'] = 'false'          # don't auto-start scheduler
os.environ['DATABASE_PATH'] = tempfile.mktemp(suffix='.db')
os.environ.setdefault('SECRET_KEY', 'x' * 40)
os.environ.setdefault('ENCRYPTION_KEY', 'y' * 40)
os.environ.setdefault('TWOCAPTCHA_API_KEY', 'z' * 16)

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import crm_database as db          # noqa: E402
import crm_api                     # noqa: E402
import event_bus                   # noqa: E402
import sse_hub                     # noqa: E402

_failures = []


def check(name, cond, detail=''):
    if cond:
        print(f"  ✓ {name}")
    else:
        print(f"  ✗ {name} :: {detail}")
        _failures.append((name, detail))


CLIENT = crm_api.app.test_client()

panel = db.create_crm_panel('newsubs-test')
CRM_ID, API_KEY = panel['crm_id'], panel['api_key']
OF_ID = '911911911'
db.add_of_account(CRM_ID, OF_ID, 'newsubs@e.com', username='newsubs', platform='onlyfans')
HDRS = {'X-API-Key': API_KEY}
BASE = f'/api/crm/{CRM_ID}/accounts/{OF_ID}'


def _fan(fan_id, sub_at, expired_at='2099-01-01T00:00:00+00:00', spent=0):
    return {
        'id': fan_id,
        'username': f'fan{fan_id}',
        'name': f'Fan {fan_id}',
        'avatar': None,
        'subscribedOnData': {
            'subscribeAt': sub_at,
            'expiredAt': expired_at,
            'subscribePrice': 9.99,
            'totalSumm': spent,
        },
    }


# Seed: 2 subs on Jun 1, 1 on Jun 2 (different hours), 1 on Jul 3, 1 expired in May.
db.upsert_subscriber(CRM_ID, OF_ID, _fan(101, '2026-06-01T10:15:00+00:00'))
db.upsert_subscriber(CRM_ID, OF_ID, _fan(102, '2026-06-01T22:40:00+00:00', spent=50))
db.upsert_subscriber(CRM_ID, OF_ID, _fan(103, '2026-06-02T09:00:00+00:00'))
db.upsert_subscriber(CRM_ID, OF_ID, _fan(104, '2026-07-03T12:00:00+00:00'))
db.upsert_subscriber(CRM_ID, OF_ID, _fan(105, '2026-05-10T08:00:00+00:00',
                                         expired_at='2026-06-10T08:00:00+00:00'))

print("== /subscribers/new ==")
r = CLIENT.get(f'{BASE}/subscribers/new', headers=HDRS)
j = r.get_json()
check('200 + success', r.status_code == 200 and j.get('success'), str(j))
check('all 5 subs returned', j['total'] == 5, f"total={j['total']}")
check('newest first', j['subscribers'][0]['fan_of_user_id'] == '104',
      str([s['fan_of_user_id'] for s in j['subscribers']]))
check('flat shape has subscribed_at', 'subscribed_at' in j['subscribers'][0], str(j['subscribers'][0]))
check('no raw_json leaked', 'raw_json' not in j['subscribers'][0])

r = CLIENT.get(f'{BASE}/subscribers/new?since=2026-06-01T00:00:00%2B00:00&until=2026-06-30T23:59:59%2B00:00',
               headers=HDRS)
j = r.get_json()
check('June window → 3 subs', j['total'] == 3, f"total={j['total']}")
check('window echoed', j['window']['since'] is not None, str(j['window']))

r = CLIENT.get(f'{BASE}/subscribers/new?type=expired', headers=HDRS)
j = r.get_json()
check('type=expired → 1', j['total'] == 1 and j['subscribers'][0]['fan_of_user_id'] == '105', str(j))

r = CLIENT.get(f'{BASE}/subscribers/new?limit=2', headers=HDRS)
j = r.get_json()
check('limit=2 pagination', j['count'] == 2 and j['total'] == 5 and j['hasMore'], str(j))

r = CLIENT.get(f'{BASE}/subscribers/new?type=bogus', headers=HDRS)
check('bad type → 400', r.status_code == 400)

r = CLIENT.get(f'{BASE}/subscribers/new')
check('no api key → 401', r.status_code == 401)

print("== /subscribers/stats ==")
r = CLIENT.get(f'{BASE}/subscribers/stats', headers=HDRS)
j = r.get_json()
check('default granularity=day', j['granularity'] == 'day', str(j))
days = {b['bucket']: b['count'] for b in j['buckets']}
check('day buckets correct', days.get('2026-06-01') == 2 and days.get('2026-06-02') == 1
      and days.get('2026-07-03') == 1 and days.get('2026-05-10') == 1, str(days))
check('total_in_window = 5', j['total_in_window'] == 5, str(j['total_in_window']))
check('buckets ascending', [b['bucket'] for b in j['buckets']] == sorted(days), str(j['buckets']))
check('cache summary attached', j.get('cache', {}).get('total') == 5, str(j.get('cache')))

r = CLIENT.get(f'{BASE}/subscribers/stats?granularity=hour&since=2026-06-01&until=2026-06-02T23:59:59',
               headers=HDRS)
j = r.get_json()
hours = {b['bucket']: b['count'] for b in j['buckets']}
# Zero-filled server-side now: the axis is every hour of the requested window
# (2 days = 48 buckets), of which 3 carry subscriptions.
check('hour buckets', hours.get('2026-06-01T10:00:00Z') == 1
      and len(hours) == 48 and sum(hours.values()) == 3
      and j.get('zero_filled') is True, str(sorted(hours.items()))[:300])

r = CLIENT.get(f'{BASE}/subscribers/stats?granularity=month', headers=HDRS)
j = r.get_json()
months = {b['bucket']: b['count'] for b in j['buckets']}
check('month buckets', months == {'2026-05': 1, '2026-06': 3, '2026-07': 1}, str(months))

r = CLIENT.get(f'{BASE}/subscribers/stats?granularity=week', headers=HDRS)
j = r.get_json()
weeks = {b['bucket']: b['count'] for b in j['buckets']}
# 2026-06-01 is a Monday → Jun 1+2 land in the same Monday-start bucket
check('week buckets Monday-start', weeks.get('2026-06-01') == 3, str(weeks))

r = CLIENT.get(f'{BASE}/subscribers/stats?granularity=decade', headers=HDRS)
check('bad granularity → 400', r.status_code == 400)

print("== /events since/until + types ==")
event_bus.emit(CRM_ID, OF_ID, 'new_subscriber',
               {'fan': {'id': 101}, 'subscribed_at': '2026-06-01T10:15:00+00:00'},
               source_event_id='sub:101:2026-06-01T10:15:00+00:00',
               occurred_at='2026-06-01T10:15:00+00:00')
event_bus.emit(CRM_ID, OF_ID, 'new_tip',
               {'amount': 5}, source_event_id='tip:1')

r = CLIENT.get(f'/api/crm/{CRM_ID}/events?types=new_subscriber', headers=HDRS)
j = r.get_json()
check('events filtered by type', len(j['events']) == 1
      and j['events'][0]['event_type'] == 'new_subscriber', str(j))

r = CLIENT.get(f'/api/crm/{CRM_ID}/events?until=2000-01-01T00:00:00', headers=HDRS)
j = r.get_json()
check('until in the past → 0 events', len(j['events']) == 0, str(j))

r = CLIENT.get(f'/api/crm/{CRM_ID}/events?since=2000-01-01T00:00:00&until=2099-01-01T00:00:00',
               headers=HDRS)
j = r.get_json()
check('since+until window → 2 events', len(j['events']) == 2, str(j))

print("== SSE type filter ==")
r = CLIENT.get(f'/api/crm/{CRM_ID}/events/stream?types=bogus_type', headers=HDRS)
check('stream bad type → 400', r.status_code == 400)

# Drive the hub generator directly — filtered stream must skip non-matching types.
gen = sse_hub.hub.stream(CRM_ID, types=['new_subscriber'])
handshake = next(gen)
check('stream handshake', handshake == b': connected\n\n', str(handshake))
sse_hub.hub.broadcast(CRM_ID, {'event_type': 'new_tip', 'id': 1})
sse_hub.hub.broadcast(CRM_ID, {'event_type': 'new_subscriber', 'id': 2})
chunk = next(gen)
check('filter drops new_tip, passes new_subscriber',
      b'event: new_subscriber' in chunk and b'new_tip' not in chunk, str(chunk))
gen.close()

# Unfiltered stream still gets everything.
gen = sse_hub.hub.stream(CRM_ID)
next(gen)
sse_hub.hub.broadcast(CRM_ID, {'event_type': 'new_tip', 'id': 3})
chunk = next(gen)
check('unfiltered stream passes new_tip', b'event: new_tip' in chunk, str(chunk))
gen.close()

# OF moves subscribed_at forward on renewal, so the dashboard's New Subs count
# needs to know what the event AT subscribed_at was.
print("== subscribe_action ==")


def _action(fan_id):
    conn = db.sqlite3.connect(db.DB_FILE)
    try:
        return conn.execute(
            "SELECT subscribe_action, subscribed_at FROM subscribers_cache "
            "WHERE crm_id = ? AND fan_of_user_id = ?", (CRM_ID, str(fan_id))).fetchone()
    finally:
        conn.close()


db.upsert_subscriber(CRM_ID, OF_ID, {
    'id': 201, 'username': 'fan201',
    'subscribedByData': {'subscribeAt': '2026-07-10T10:00:00+00:00',
                         'expiredAt': '2099-01-01T00:00:00+00:00',
                         'subscribes': [{'action': 'subscribe'}, {'action': 'renewal'}]}})
check('latest subscribes[] action stored', _action(201)[0] == 'renewal', str(_action(201)))
db.upsert_subscriber(CRM_ID, OF_ID, {'id': 201, 'username': 'fan201'})
check('payload without subscribed_at keeps the action and the date',
      tuple(_action(201)) == ('renewal', '2026-07-10T10:00:00+00:00'), str(_action(201)))
db.upsert_subscriber(CRM_ID, OF_ID, {
    'id': 201, 'subscribedByData': {'subscribeAt': '2026-08-10T10:00:00+00:00'}})
check('a new date with no history resets the action (unknown → counted as new)',
      tuple(_action(201)) == (None, '2026-08-10T10:00:00+00:00'), str(_action(201)))
db.upsert_subscriber(CRM_ID, OF_ID, {
    'id': 202, 'subscribedByData': {'subscribeAt': '2026-08-11T10:00:00+00:00',
                                    'subscribes': [{'id': 1}]}})
check('history entry without an action reads as subscribe',
      _action(202)[0] == 'subscribe', str(_action(202)))
check('rows without history carry no action', _action(101)[0] is None, str(_action(101)))

print()
if _failures:
    print(f"FAILED: {len(_failures)} assertion(s)")
    sys.exit(1)
print("ALL PASSED")
