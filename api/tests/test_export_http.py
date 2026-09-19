#!/usr/bin/env python3
"""HTTP-level tests for the "Download your data" export feature.

Runs against a throwaway DB + exports dir via Flask's test_client. The export
worker is invoked synchronously (background dispatch is stubbed) so the test is
deterministic and makes zero network calls — it only exercises the cached data
types (account/subscribers/transactions/fans).

    python tests/test_export_http.py
"""

import io
import os
import sys
import tempfile
import zipfile

# Isolate from the real deployment BEFORE importing app modules.
os.environ['WERKZEUG_RUN_MAIN'] = 'false'          # don't auto-start scheduler
os.environ['DATABASE_PATH'] = tempfile.mktemp(suffix='.db')
os.environ['EXPORTS_DIR'] = tempfile.mkdtemp(prefix='exports_test_')
os.environ.setdefault('SECRET_KEY', 'x' * 40)
os.environ.setdefault('ENCRYPTION_KEY', 'y' * 40)
os.environ.setdefault('TWOCAPTCHA_API_KEY', 'z' * 16)

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import crm_database as db          # noqa: E402
import scheduler as scheduler_mod  # noqa: E402
import crm_api                     # noqa: E402
import export_runner               # noqa: E402

_failures = []


def check(name, cond, detail=''):
    if cond:
        print(f"  ✓ {name}")
    else:
        print(f"  ✗ {name} :: {detail}")
        _failures.append((name, detail))


# Stub background dispatch so jobs stay queued until we run them by hand.
scheduler_mod.run_in_background = lambda *a, **k: 'stub'

CLIENT = crm_api.app.test_client()


def _mk_account(name):
    panel = db.create_crm_panel(name)
    crm_id, api_key = panel['crm_id'], panel['api_key']
    db.add_of_account(crm_id, '900900900', f'{name}@e.com',
                      username=name, platform='onlyfans')
    return crm_id, api_key


ME = '900900900'   # the connected creator account in these fixtures
FAN = '555000111'


def _raw(msg_id, mine, at, **extra):
    """A synthetic raw OF chat-message, shaped like the real
    `api2_chat_message` payload (see of-scripts/ws_live_dump.jsonl)."""
    raw = {
        'id': msg_id,
        'fromUser': {'id': ME if mine else FAN},
        'createdAt': at,
        'text': f'<p>m{msg_id}</p>',
        'price': 0,
        'isTip': False,
        'isFree': True,
        'media': [],
    }
    raw.update(extra)
    return raw


def _thread(*raws):
    """Adapt + derive, the way _export_messages does for an oldest-first thread."""
    msgs = [export_runner._adapt_of_message(r, ME) for r in raws]
    return export_runner._derive_reply_status(msgs)


def _statuses(thread):
    return [m['reply_status'] for m in thread]


def test_liked_flag():
    print("\nLiked flag (OF `isLiked`)")

    liked = export_runner._adapt_of_message(
        _raw(1, True, '2026-07-01T10:00:00+00:00', isLiked=True), ME)
    unliked = export_runner._adapt_of_message(
        _raw(2, True, '2026-07-01T10:00:00+00:00', isLiked=False), ME)
    absent = export_runner._adapt_of_message(
        _raw(3, True, '2026-07-01T10:00:00+00:00'), ME)

    check('isLiked True  -> is_liked True', liked['is_liked'] is True, str(liked))
    check('isLiked False -> is_liked False', unliked['is_liked'] is False, str(unliked))
    check('isLiked absent -> is_liked None (unknown, not False)',
          absent['is_liked'] is None, str(absent))

    # False must survive into the per-conversation JSON — omitting it would make
    # "not liked" indistinguishable from "platform does not expose likes".
    check('clean_message keeps liked=False',
          export_runner._clean_message(unliked).get('liked') is False,
          str(export_runner._clean_message(unliked)))
    check('clean_message keeps liked=True',
          export_runner._clean_message(liked).get('liked') is True,
          str(export_runner._clean_message(liked)))
    check('clean_message omits liked when unknown',
          'liked' not in export_runner._clean_message(absent),
          str(export_runner._clean_message(absent)))

    # Fansly exposes no message like state.
    fansly = export_runner._adapt_fansly_message(
        {'id': 'f1', 'isFromSelf': True, 'createdAt': '2026-07-01T10:00:00+00:00',
         'text': 'hi', 'attachments': []})
    check('fansly is_liked is None', fansly['is_liked'] is None, str(fansly))

    # Media: can_view explains a missing url.
    locked = export_runner._of_media({'media': [
        {'id': 77, 'type': 'photo', 'canView': False,
         'files': {'preview': {'url': 'https://cdn/x-preview.jpg'}}}]})
    check('locked media keeps id + type', locked[0]['id'] == 77, str(locked))
    check('locked media has no url', 'url' not in locked[0], str(locked))
    check('locked media flags can_view False', locked[0]['can_view'] is False, str(locked))

    viewable = export_runner._of_media({'media': [
        {'id': 78, 'type': 'video', 'canView': True,
         'files': {'full': {'url': 'https://cdn/x-full.mp4'}}}]})
    check('viewable media keeps url', viewable[0].get('url') == 'https://cdn/x-full.mp4',
          str(viewable))
    check('viewable media flags can_view True', viewable[0]['can_view'] is True, str(viewable))

    # The CSV must carry the new columns.
    for col in ('message_id', 'is_liked', 'reply_status', 'replied_at',
                'reply_latency_seconds', 'reply_to_message_id'):
        check(f'messages.csv has `{col}` column', col in export_runner._MSG_CSV_COLS,
              str(export_runner._MSG_CSV_COLS))


def test_reply_derivation():
    print("\nReply derivation (`reply_status`)")

    # Empty thread — must not blow up.
    check('empty thread is fine', _thread() == [], 'expected []')

    # Plain sent -> fan replies.
    t = _thread(_raw(1, True,  '2026-07-01T10:00:00+00:00'),
                _raw(2, False, '2026-07-01T10:02:30+00:00'))
    check('sent then fan reply -> replied', _statuses(t) == ['replied', ''], str(_statuses(t)))
    check('replied_at is the fan message time',
          t[0]['replied_at'] == '2026-07-01T10:02:30+00:00', str(t[0]))
    check('latency is 150s', t[0]['reply_latency_seconds'] == 150, str(t[0]))
    check('inbound message gets no reply fields',
          t[1]['reply_status'] == '' and t[1]['replied_at'] is None, str(t[1]))

    # Fan messaged only BEFORE us — that is not a reply.
    t = _thread(_raw(1, False, '2026-07-01T09:00:00+00:00'),
                _raw(2, True,  '2026-07-01T09:05:00+00:00'))
    check('fan message before ours -> no_reply', _statuses(t) == ['', 'no_reply'],
          str(_statuses(t)))

    # Consecutive outbound then a reply: only the LAST of the burst is credited.
    t = _thread(_raw(1, True,  '2026-07-01T10:00:00+00:00'),
                _raw(2, True,  '2026-07-01T10:01:00+00:00'),
                _raw(3, True,  '2026-07-01T10:02:00+00:00'),
                _raw(4, False, '2026-07-01T10:03:00+00:00'))
    check('outbound burst -> only last is replied',
          _statuses(t) == ['no_reply', 'no_reply', 'replied', ''], str(_statuses(t)))
    check('superseded burst message has no replied_at',
          t[0]['replied_at'] is None and t[1]['replied_at'] is None, str(t[:2]))

    # Trailing outbound (conversation still open) -> no_reply.
    t = _thread(_raw(1, False, '2026-07-01T10:00:00+00:00'),
                _raw(2, True,  '2026-07-01T10:01:00+00:00'),
                _raw(3, False, '2026-07-01T10:02:00+00:00'),
                _raw(4, True,  '2026-07-01T10:03:00+00:00'))
    check('trailing outbound -> no_reply',
          _statuses(t) == ['', 'replied', '', 'no_reply'], str(_statuses(t)))

    # All-inbound thread -> nothing is 'no_reply'.
    t = _thread(_raw(1, False, '2026-07-01T10:00:00+00:00'),
                _raw(2, False, '2026-07-01T10:01:00+00:00'))
    check('all-inbound thread -> all NA', _statuses(t) == ['', ''], str(_statuses(t)))

    # Single outbound message, nothing after it.
    t = _thread(_raw(1, True, '2026-07-01T10:00:00+00:00'))
    check('lone outbound -> no_reply', _statuses(t) == ['no_reply'], str(_statuses(t)))

    # Native quote-reply rescues a message buried mid-burst.
    t = _thread(_raw(1, True,  '2026-07-01T10:00:00+00:00'),
                _raw(2, True,  '2026-07-01T10:01:00+00:00'),
                _raw(3, False, '2026-07-01T10:05:00+00:00',
                     replyToMessage={'id': 1}))
    check('quote-reply credits the quoted message, not just the last',
          _statuses(t) == ['replied', 'replied', ''], str(_statuses(t)))
    check('quote-reply latency measured from the quoted message',
          t[0]['reply_latency_seconds'] == 300, str(t[0]))
    check('reply_to_message_id captured on the fan message',
          t[2]['reply_to_message_id'] == '1', str(t[2]))

    # A quote-reply pointing BACKWARDS in time (malformed) must not be credited.
    t = _thread(_raw(1, False, '2026-07-01T10:00:00+00:00',
                     replyToMessage={'id': 9}),
                _raw(9, True,  '2026-07-01T10:01:00+00:00'))
    check('quote-reply that precedes its target is ignored',
          _statuses(t) == ['', 'no_reply'], str(_statuses(t)))

    # Unparseable timestamps: status still derived, latency withheld.
    t = _thread(_raw(1, True,  'not-a-date'),
                _raw(2, False, 'also-not-a-date'))
    check('bad timestamps still derive status', _statuses(t) == ['replied', ''],
          str(_statuses(t)))
    check('bad timestamps yield no latency', t[0]['reply_latency_seconds'] is None,
          str(t[0]))


def main():
    print("Running export HTTP tests")

    crm_id, api_key = _mk_account('exporter')
    H = {'X-API-Key': api_key}
    base = f'/api/crm/{crm_id}/accounts/900900900/exports'

    # 1. Create a cached-only export → 202 queued.
    r = CLIENT.post(base, json={'data_types': ['account', 'subscribers',
                                               'transactions', 'fans']}, headers=H)
    check('create returns 202', r.status_code == 202, str(r.status_code))
    job = (r.get_json() or {}).get('job') or {}
    job_id = job.get('job_id')
    check('job is queued', job.get('status') == 'queued', str(job))

    # 2. Invalid data_types → 400.
    r = CLIENT.post(base, json={'data_types': ['nonsense']}, headers=H)
    check('bad data_types 400', r.status_code == 400, str(r.status_code))

    # 3. Run the worker synchronously.
    export_runner.run_export(crm_id, '900900900', job_id)

    # 4. Status is complete.
    r = CLIENT.get(f'{base}/{job_id}', headers=H)
    check('status 200', r.status_code == 200, str(r.status_code))
    check('status complete',
          (r.get_json() or {}).get('job', {}).get('status') == 'complete',
          str(r.get_json()))

    # 5. Download returns a valid ZIP with the expected layout.
    r = CLIENT.get(f'{base}/{job_id}/download', headers=H)
    check('download 200', r.status_code == 200, str(r.status_code))
    is_zip = False
    names = []
    try:
        zf = zipfile.ZipFile(io.BytesIO(r.data))
        names = zf.namelist()
        is_zip = zf.testzip() is None
    except Exception as e:  # noqa: BLE001
        is_zip = False
        names = [f'(zip open failed: {e})']
    check('download is a valid zip', is_zip, str(names)[:200])
    check('zip has manifest.json', any('manifest.json' in n for n in names), str(names))
    check('zip has data/fans.csv', any('data/fans.csv' in n for n in names), str(names))
    check('zip has account.json', any('account.json' in n for n in names), str(names))

    # 6. History lists the job.
    r = CLIENT.get(base, headers=H)
    jobs = (r.get_json() or {}).get('jobs') or []
    check('history lists job', any(j['job_id'] == job_id for j in jobs), str(len(jobs)))

    # 7. Cross-tenant isolation — another CRM cannot see this job.
    crm2, key2 = _mk_account('intruder')
    r = CLIENT.get(f'/api/crm/{crm2}/accounts/900900900/exports/{job_id}',
                   headers={'X-API-Key': key2})
    check('cross-tenant status 404', r.status_code == 404, str(r.status_code))
    r = CLIENT.get(f'/api/crm/{crm2}/accounts/900900900/exports/{job_id}/download',
                   headers={'X-API-Key': key2})
    check('cross-tenant download 404', r.status_code == 404, str(r.status_code))

    # 8. Not-ready download → 409 (create a fresh queued job, don't run it).
    r = CLIENT.post(base, json={'data_types': ['account']}, headers=H)
    qjob = (r.get_json() or {}).get('job') or {}
    qid = qjob.get('job_id')
    r = CLIENT.get(f"{base}/{qid}/download", headers=H)
    check('not-ready download 409', r.status_code == 409, str(r.status_code))

    # 8b. API-call counter present on the completed (cached-only) job — should be 0.
    r = CLIENT.get(f"{base}/{job_id}", headers=H)
    cnt = (r.get_json() or {}).get('job', {}).get('counts') or {}
    check('api_calls counter present', 'api_calls' in cnt, str(cnt))

    # 9. Concurrency guard — a second create while one (qid) is queued is rejected.
    r = CLIENT.post(base, json={'data_types': ['fans']}, headers=H)
    body = r.get_json() or {}
    check('concurrency guard already_running',
          r.status_code == 202 and body.get('already_running') is True, str(body)[:160])

    # 9b. Cancel the queued job → 200 + status canceled; cancelling a completed one → 409.
    r = CLIENT.post(f"{base}/{qid}/cancel", headers=H)
    check('cancel queued 200', r.status_code == 200, str(r.status_code))
    r = CLIENT.get(f"{base}/{qid}", headers=H)
    check('canceled status', (r.get_json() or {}).get('job', {}).get('status') == 'canceled',
          str(r.get_json()))
    r = CLIENT.post(f"{base}/{job_id}/cancel", headers=H)
    check('cancel completed 409', r.status_code == 409, str(r.status_code))

    # 10. Delete removes the completed job.
    r = CLIENT.delete(f'{base}/{job_id}', headers=H)
    check('delete 200', r.status_code == 200, str(r.status_code))
    r = CLIENT.get(f'{base}/{job_id}', headers=H)
    check('deleted job gone (404)', r.status_code == 404, str(r.status_code))

    test_liked_flag()
    test_reply_derivation()

    print()
    if _failures:
        print(f"FAILED: {len(_failures)}")
        for n, d in _failures:
            print(f"  - {n}: {d}")
        sys.exit(1)
    print("All export HTTP tests passed.")


if __name__ == '__main__':
    main()
