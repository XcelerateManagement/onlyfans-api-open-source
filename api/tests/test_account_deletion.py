#!/usr/bin/env python3
"""Scenario suite for account-deletion cleanup.

Covers db.delete_of_account / purge_account_data and the scheduled sweeper.
Pure DB — no OF/Fansly traffic, no Flask, no live scheduler. Runs against a
throwaway DB (DATABASE_PATH), never the real crm_data.db.

    cd onlyfans-api && python3 tests/test_account_deletion.py
"""

from __future__ import annotations

import os
import sqlite3
import sys
import tempfile
import traceback

# Isolate from the real deployment BEFORE importing app modules. setdefault so
# an externally supplied DATABASE_PATH (how the suite is normally driven) wins.
os.environ['WERKZEUG_RUN_MAIN'] = 'false'          # don't auto-start scheduler
os.environ.setdefault('DATABASE_PATH', tempfile.mktemp(suffix='.db'))
os.environ.setdefault('SECRET_KEY', 'x' * 40)
os.environ.setdefault('ENCRYPTION_KEY', 'y' * 40)
os.environ.setdefault('TWOCAPTCHA_API_KEY', 'z' * 16)

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import config                       # noqa: E402
import crm_database as db           # noqa: E402
import scheduler as scheduler_mod   # noqa: E402
import crm_api                      # noqa: E402 — WERKZEUG_RUN_MAIN guard keeps
                                    # the module-level scheduler start a no-op

db.init_database()

CLIENT = crm_api.app.test_client()

_failures: list[tuple[str, str]] = []


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


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

# Every table the seeder writes an account-scoped row into, with the predicate
# that finds it again. fan_tags / automation_runs are keyed by FK, not by
# (crm_id, of_user_id) — they're the ones a naive purge would strand.
_COUNTERS = {
    'account_events':
        'SELECT COUNT(*) FROM account_events WHERE crm_id = ? AND of_user_id = ?',
    'account_tags':
        'SELECT COUNT(*) FROM account_tags WHERE crm_id = ? AND of_user_id = ?',
    'automations':
        'SELECT COUNT(*) FROM automations WHERE crm_id = ? AND of_user_id = ?',
    'automation_runs':
        '''SELECT COUNT(*) FROM automation_runs WHERE automation_id IN
           (SELECT id FROM automations WHERE crm_id = ? AND of_user_id = ?)''',
    'campaign_claimers_cache':
        'SELECT COUNT(*) FROM campaign_claimers_cache WHERE crm_id = ? AND of_user_id = ?',
    'campaign_tags':
        'SELECT COUNT(*) FROM campaign_tags WHERE crm_id = ? AND of_user_id = ?',
    'export_jobs':
        'SELECT COUNT(*) FROM export_jobs WHERE crm_id = ? AND of_user_id = ?',
    # import_job_rows is the one purge rule that SCRUBS rather than DELETEs —
    # the row is a line of a bulk-import audit trail, so removing it would
    # rewrite that job's history, but it carries the account's of_user_id,
    # email and label, which must not outlive the account. Detaching it
    # (of_user_id -> NULL) takes this count to 0 either way, which is exactly
    # what "invisible to every account-scoped read" means.
    'import_job_rows':
        'SELECT COUNT(*) FROM import_job_rows WHERE crm_id = ? AND of_user_id = ?',
    # api_error_log scrubs rather than deletes for the same reason: a logged
    # failure is a fact about the PANEL's traffic and its error-rate history
    # should not shrink when an account is later disconnected — but the row
    # carries that account's id, so detaching takes this count to 0.
    'api_error_log':
        'SELECT COUNT(*) FROM api_error_log WHERE crm_id = ? AND of_user_id = ?',
    'fan_tags':
        '''SELECT COUNT(*) FROM fan_tags WHERE fan_id IN
           (SELECT id FROM fans WHERE crm_id = ? AND of_user_id = ?)''',
    'fans':
        'SELECT COUNT(*) FROM fans WHERE crm_id = ? AND of_user_id = ?',
    'subscribers_cache':
        'SELECT COUNT(*) FROM subscribers_cache WHERE crm_id = ? AND of_user_id = ?',
    'transactions_cache':
        'SELECT COUNT(*) FROM transactions_cache WHERE crm_id = ? AND of_user_id = ?',
}

_seq = [0]


def _uniq(prefix):
    _seq[0] += 1
    return f'{prefix}{_seq[0]}'


def _conn():
    return sqlite3.connect(db.DB_FILE)


def counts(crm_id, of_user_id):
    """{table: rows} for one account across every account-scoped table."""
    conn = _conn()
    try:
        cur = conn.cursor()
        return {t: cur.execute(q, (crm_id, str(of_user_id))).fetchone()[0]
                for t, q in _COUNTERS.items()}
    finally:
        conn.close()


def account_exists(crm_id, of_user_id):
    return db.get_of_account(crm_id, str(of_user_id)) is not None


def tombstone(crm_id, of_user_id):
    conn = _conn()
    try:
        row = conn.execute(
            'SELECT disconnected_at, purge_after FROM account_data_retention '
            'WHERE crm_id = ? AND of_user_id = ?', (crm_id, str(of_user_id))
        ).fetchone()
        return {'disconnected_at': row[0], 'purge_after': row[1]} if row else None
    finally:
        conn.close()


def seed(crm_id, of_user_id, email=None):
    """Connect an account and give it one row in every account-scoped table
    (plus a pending 2FA session), so a purge has something to miss."""
    of_user_id = str(of_user_id)
    email = email or f'{of_user_id}@seed.test'
    db.add_of_account(crm_id, of_user_id, email, password='pw',
                      username=f'u{of_user_id}', platform='onlyfans')
    db.store_2fa_session(crm_id, email, 'otp-state', 'xbc', 'xhash', '{}')

    db.insert_event(crm_id, of_user_id, 'new_tip',
                    {'amount': 5, 'fan': {'id': '77'}}, source_event_id=_uniq('src'))
    db.upsert_fan(crm_id, of_user_id, '77', username='fan77')
    db.add_fan_tag(crm_id, of_user_id, '77', 'whale')
    db.add_campaign_tag(crm_id, of_user_id, 'camp1', 'promo')
    db.add_account_tag(crm_id, of_user_id, 'agency-a')
    db.create_export_job(crm_id, of_user_id, _uniq('job'), data_types=['fans'])

    # A completed bulk-import row that produced this account.
    import_job = _uniq('imp')
    db.create_import_job(crm_id, import_job, total_rows=1)
    db.add_import_rows(crm_id, import_job, [{
        'row_index': 0, 'line': 1, 'email': email, 'password': 'pw',
        'platform': 'onlyfans', 'proxy': None, 'totp_secret': None,
        'label': None, 'cookies': None, 'lane': 'password',
        'valid': True, 'errors': [],
    }])
    conn = _conn()
    try:
        conn.execute(
            "UPDATE import_job_rows SET status = 'success', of_user_id = ? "
            'WHERE job_id = ?', (of_user_id, import_job))
        conn.commit()
    finally:
        conn.close()

    import api_errors as _api_errors
    _api_errors.record(
        crm_id=crm_id, route='/api/crm/<crm_id>/accounts/<of_user_id>/balances',
        method='GET', path=f'/api/crm/{crm_id}/accounts/{of_user_id}/balances',
        status_code=403, latency_ms=4,
        body_text='{"error": "Account not found", "code": "NOT_YOURS"}',
        of_user_id=of_user_id)

    auto = db.create_automation(crm_id, 'acct rule', 'new_tip', 'webhook',
                                {'url': 'https://x.test/h'}, of_user_id=of_user_id)
    db.record_automation_run(auto['id'], None, 'success')

    conn = _conn()
    try:
        cur = conn.cursor()
        cur.execute(
            '''INSERT INTO subscribers_cache
               (crm_id, of_user_id, fan_of_user_id, username, subscribed_at,
                total_spent, is_active, last_synced_at)
               VALUES (?, ?, '77', 'fan77', ?, 12.5, 1, ?)''',
            (crm_id, of_user_id, db.iso_utc_now(), db.iso_utc_now()))
        cur.execute(
            '''INSERT INTO transactions_cache
               (crm_id, of_user_id, tx_id, fan_of_user_id, amount, net,
                status, created_at, synced_at)
               VALUES (?, ?, ?, '77', 10.0, 8.0, 'done', ?, ?)''',
            (crm_id, of_user_id, _uniq('tx'), db.iso_utc_now(), db.iso_utc_now()))
        cur.execute(
            '''INSERT INTO campaign_claimers_cache
               (crm_id, of_user_id, campaign_id, fan_of_user_id, fan_username,
                claimed_at, synced_at)
               VALUES (?, ?, 'camp1', '77', 'fan77', ?, ?)''',
            (crm_id, of_user_id, db.iso_utc_now(), db.iso_utc_now()))
        conn.commit()
    finally:
        conn.close()

    seeded = counts(crm_id, of_user_id)
    assert all(v == 1 for v in seeded.values()), f'seed incomplete: {seeded}'
    return email


def expire_tombstone(crm_id, of_user_id):
    """Backdate purge_after so the sweeper considers this account due."""
    conn = _conn()
    try:
        conn.execute(
            'UPDATE account_data_retention SET purge_after = ? '
            'WHERE crm_id = ? AND of_user_id = ?',
            ('2000-01-01T00:00:00+00:00', crm_id, str(of_user_id)))
        conn.commit()
    finally:
        conn.close()


def panel():
    return db.create_crm_panel(_uniq('panel'))['crm_id']


def panel_with_key():
    p = db.create_crm_panel(_uniq('panel'))
    return p['crm_id'], {'X-API-Key': p['api_key']}


# ---------------------------------------------------------------------------
# Scenarios
# ---------------------------------------------------------------------------

@scenario
def s01_credentials_and_2fa_session_go_immediately():
    """Regression: the old 2FA delete used `email = (SELECT email FROM
    of_accounts ...)` AFTER deleting that very row in the same transaction, so
    the subquery returned NULL and matched nothing. 2FA sessions were never
    cleaned up. The email must be captured BEFORE the account row goes."""
    crm = panel()
    email = seed(crm, '111')
    assert db.get_2fa_session(crm, email) is not None, 'seed 2FA session missing'

    db.delete_of_account(crm, '111')

    assert not account_exists(crm, '111'), 'of_accounts row survived'
    assert db.get_2fa_session(crm, email) is None, '2FA session survived the delete'


@scenario
def s02_cached_data_is_retained_not_destroyed():
    """Chosen policy: disconnect tombstones the cached data, it is NOT wiped on
    the spot. Fan tags, campaign tags, fan notes and the local event log cannot
    be re-fetched from the platform, so a misclick must be undoable."""
    crm = panel()
    seed(crm, '222')
    result = db.delete_of_account(crm, '222')

    after = counts(crm, '222')
    assert all(v == 1 for v in after.values()), f'rows were destroyed: {after}'

    ts = tombstone(crm, '222')
    assert ts is not None, 'no tombstone written'
    assert result['purged'] is False, result
    assert result['purge_after'] == ts['purge_after'], result
    assert ts['purge_after'] > db.iso_utc_now(), ts
    assert config.ACCOUNT_DATA_RETENTION_DAYS > 0, 'retention window must be non-zero'


@scenario
def s03_sweeper_purges_every_account_scoped_table():
    """Once the window elapses the scheduled sweeper hard-deletes everything —
    including the FK-linked children (fan_tags, automation_runs) that a
    (crm_id, of_user_id)-only purge would strand."""
    crm = panel()
    seed(crm, '333')
    db.delete_of_account(crm, '333')
    expire_tombstone(crm, '333')

    swept = scheduler_mod._run_account_purge()
    assert swept >= 1, f'sweeper reported {swept} purges'

    after = counts(crm, '333')
    leftovers = {t: n for t, n in after.items() if n}
    assert not leftovers, f'orphans survived the purge: {leftovers}'
    assert tombstone(crm, '333') is None, 'tombstone survived its own purge'


@scenario
def s04_sibling_account_on_same_panel_is_untouched():
    """Two accounts on one panel: deleting one must not touch the other, at
    tombstone time or at purge time."""
    crm = panel()
    seed(crm, '441')
    seed(crm, '442')

    db.delete_of_account(crm, '441')
    assert all(v == 1 for v in counts(crm, '442').values()), 'sibling hit by delete'
    assert tombstone(crm, '442') is None, 'sibling was tombstoned'

    expire_tombstone(crm, '441')
    scheduler_mod._run_account_purge()

    assert not any(counts(crm, '441').values()), 'target not purged'
    sibling = counts(crm, '442')
    assert all(v == 1 for v in sibling.values()), f'sibling hit by purge: {sibling}'
    assert account_exists(crm, '442'), 'sibling account row deleted'


@scenario
def s05_same_of_user_id_on_another_panel_is_untouched():
    """Multi-tenant isolation. The same creator can be connected to two panels;
    every purge predicate must be (crm_id, of_user_id), never of_user_id alone.
    This is the one that would leak across tenants if a WHERE clause slipped."""
    crm_a = panel()
    crm_b = panel()
    seed(crm_a, '555', email='shared@seed.test')
    email_b = seed(crm_b, '555', email='shared@seed.test')

    db.delete_of_account(crm_a, '555')
    b_after_delete = counts(crm_b, '555')
    assert all(v == 1 for v in b_after_delete.values()), f'other panel hit: {b_after_delete}'
    assert account_exists(crm_b, '555'), 'other panel lost its account row'
    # two_fa_sessions is keyed (crm_id, email) — the identical email on the
    # other panel must keep its pending session.
    assert db.get_2fa_session(crm_b, email_b) is not None, 'other panel lost its 2FA session'

    expire_tombstone(crm_a, '555')
    scheduler_mod._run_account_purge()

    assert not any(counts(crm_a, '555').values()), 'panel A not purged'
    b_after_purge = counts(crm_b, '555')
    assert all(v == 1 for v in b_after_purge.values()), f'other panel purged too: {b_after_purge}'
    assert account_exists(crm_b, '555'), 'other panel lost its account row on purge'


@scenario
def s06_purge_now_erases_in_one_shot():
    """The explicit "delete my data" path (?purge=true) skips the window."""
    crm = panel()
    email = seed(crm, '666')
    result = db.delete_of_account(crm, '666', purge_now=True)

    assert result['purged'] is True, result
    assert result['purge_after'] is None, result
    assert result['counts'], 'no per-table counts reported'
    assert not any(counts(crm, '666').values()), 'rows survived purge_now'
    assert not account_exists(crm, '666')
    assert db.get_2fa_session(crm, email) is None
    assert tombstone(crm, '666') is None, 'purge_now left a tombstone with nothing to sweep'


@scenario
def s07_reconnect_inside_the_window_restores_history():
    """The undo the retention window exists for: reconnect the same account to
    the same panel and the cache lines back up on (crm_id, of_user_id)."""
    crm = panel()
    seed(crm, '777')
    db.delete_of_account(crm, '777')
    assert tombstone(crm, '777') is not None

    db.add_of_account(crm, '777', '777@seed.test', password='pw', platform='onlyfans')
    assert tombstone(crm, '777') is None, 'reconnect did not clear the tombstone'

    # A sweeper pass now finds nothing due for this account.
    scheduler_mod._run_account_purge()
    restored = counts(crm, '777')
    assert all(v == 1 for v in restored.values()), f'history lost on reconnect: {restored}'


@scenario
def s08_tombstoned_data_is_hidden_from_panel_wide_reads():
    """list_fans/list_events take of_user_id=None (the Fans + Activity pages).
    Without the tombstone filter a disconnected creator's fans and events would
    keep showing for the whole retention window."""
    crm = panel()
    seed(crm, '881')
    seed(crm, '882')

    fans_before = db.list_fans(crm, with_stats=False)
    assert len({f['of_user_id'] for f in fans_before}) == 2, fans_before

    db.delete_of_account(crm, '881')

    fan_owners = {f['of_user_id'] for f in db.list_fans(crm, with_stats=False)}
    assert fan_owners == {'882'}, f'disconnected account still listed: {fan_owners}'
    # …and with the stats join on, which is the path the dashboard actually uses.
    fan_owners = {f['of_user_id'] for f in db.list_fans(crm, with_stats=True)}
    assert fan_owners == {'882'}, f'disconnected account still listed (stats): {fan_owners}'

    evt_owners = {e['of_user_id'] for e in db.list_events(crm)}
    assert evt_owners == {'882'}, f'disconnected account still in activity: {evt_owners}'

    # Reconnecting brings it back into view.
    db.add_of_account(crm, '881', '881@seed.test', platform='onlyfans')
    fan_owners = {f['of_user_id'] for f in db.list_fans(crm, with_stats=False)}
    assert fan_owners == {'881', '882'}, f'reconnect did not un-hide: {fan_owners}'


@scenario
def s09_panel_wide_automations_survive():
    """automations.of_user_id IS NULL means "every account on this panel".
    Disconnecting one account must not delete the panel's global rules."""
    crm = panel()
    seed(crm, '991')
    glob = db.create_automation(crm, 'panel rule', 'new_tip', 'webhook',
                                {'url': 'https://x.test/g'}, of_user_id=None)
    db.record_automation_run(glob['id'], None, 'success')

    db.delete_of_account(crm, '991', purge_now=True)

    conn = _conn()
    try:
        cur = conn.cursor()
        n_auto = cur.execute(
            'SELECT COUNT(*) FROM automations WHERE crm_id = ? AND of_user_id IS NULL',
            (crm,)).fetchone()[0]
        n_runs = cur.execute(
            'SELECT COUNT(*) FROM automation_runs WHERE automation_id = ?',
            (glob['id'],)).fetchone()[0]
    finally:
        conn.close()
    assert n_auto == 1, f'panel-wide automation deleted ({n_auto})'
    assert n_runs == 1, f'panel-wide automation runs deleted ({n_runs})'


@scenario
def s10_delete_is_atomic():
    """One transaction, not a sequence that can half-apply. Blow up partway
    through the purge and nothing at all may be committed — not the cached
    rows, not the account row, not the tombstone."""
    crm = panel()
    email = seed(crm, '1010')
    original = db._purge_account_rows

    def exploding(cursor, crm_id, of_user_id):
        cursor.execute('DELETE FROM subscribers_cache WHERE crm_id = ? AND of_user_id = ?',
                       (crm_id, str(of_user_id)))
        raise RuntimeError('boom halfway through')

    db._purge_account_rows = exploding
    try:
        db.delete_of_account(crm, '1010', purge_now=True)
        raise AssertionError('expected the injected failure to propagate')
    except RuntimeError:
        pass
    finally:
        db._purge_account_rows = original

    after = counts(crm, '1010')
    assert all(v == 1 for v in after.values()), f'partial purge committed: {after}'
    assert account_exists(crm, '1010'), 'account row committed despite rollback'
    assert db.get_2fa_session(crm, email) is not None, '2FA session committed despite rollback'
    assert tombstone(crm, '1010') is None, 'tombstone committed despite rollback'


@scenario
def s11_repeat_disconnect_restarts_the_clock():
    """disconnect → reconnect → disconnect must not trip UNIQUE(crm_id,
    of_user_id) on the tombstone, and must re-stamp the deadline."""
    crm = panel()
    seed(crm, '1111')
    db.delete_of_account(crm, '1111')
    first = tombstone(crm, '1111')

    db.add_of_account(crm, '1111', '1111@seed.test', platform='onlyfans')
    db.delete_of_account(crm, '1111')
    second = tombstone(crm, '1111')

    assert second is not None, 'second disconnect left no tombstone'
    assert second['disconnected_at'] >= first['disconnected_at'], (first, second)

    conn = _conn()
    try:
        n = conn.execute(
            'SELECT COUNT(*) FROM account_data_retention WHERE crm_id = ? AND of_user_id = ?',
            (crm, '1111')).fetchone()[0]
    finally:
        conn.close()
    assert n == 1, f'duplicate tombstones ({n})'


@scenario
def s12_purge_list_covers_every_account_scoped_table():
    """Schema-drift guard. Any table carrying an of_user_id column is by
    definition account-scoped, so it must be in _ACCOUNT_SCOPED_PURGES or its
    rows outlive the account forever — which is the bug this suite exists for.
    Add a table, add it here."""
    conn = _conn()
    try:
        cur = conn.cursor()
        tables = [r[0] for r in cur.execute(
            "SELECT name FROM sqlite_master WHERE type='table' "
            "AND name NOT LIKE 'sqlite_%'")]
        found = set()
        for t in tables:
            cols = [r[1] for r in cur.execute(f'PRAGMA table_info({t})')]
            if 'of_user_id' in cols:
                found.add(t)
    finally:
        conn.close()

    # of_accounts IS the account; account_data_retention is the tombstone that
    # drives the purge. Both are handled directly by delete_of_account.
    exempt = {'of_accounts', 'account_data_retention'}
    covered = {t for t, _ in db._ACCOUNT_SCOPED_PURGES}
    missing = found - exempt - covered
    assert not missing, f'account-scoped tables with no purge rule: {sorted(missing)}'
    # Sanity: the seeder must exercise everything the purge list claims to cover.
    assert covered <= set(_COUNTERS), sorted(covered - set(_COUNTERS))


@scenario
def s12b_sweeper_adopts_pre_tombstone_orphans():
    """Data stranded by the OLD delete (account row removed, cache left behind,
    no tombstone) must get pulled into the retention flow — otherwise the fix
    only helps future deletions and the existing backlog lives forever. Adoption
    tombstones, it does not delete: the orphans still get the full window."""
    crm = panel()
    seed(crm, '1212')
    seed(crm, '1213')

    # Reproduce the pre-fix delete: account row gone, nothing else touched.
    conn = _conn()
    try:
        pid = conn.execute('SELECT id FROM crm_panels WHERE crm_id = ?',
                           (crm,)).fetchone()[0]
        conn.execute('DELETE FROM of_accounts WHERE crm_panel_id = ? AND of_user_id = ?',
                     (pid, '1212'))
        conn.commit()
    finally:
        conn.close()
    assert tombstone(crm, '1212') is None, 'precondition: no tombstone yet'
    assert all(v == 1 for v in counts(crm, '1212').values()), 'precondition: orphans present'

    # Force the flag on for this scenario. It ships enabled but a deployment can
    # set ACCOUNT_ORPHAN_ADOPTION=0 (this one does, because the existing orphan
    # backlog belongs to accounts that may still come back), and a test that
    # silently inverts its meaning based on the operator's .env is worse than no
    # test — it would report "adoption is broken" when adoption is merely off.
    _prev = config.ACCOUNT_ORPHAN_ADOPTION
    config.ACCOUNT_ORPHAN_ADOPTION = True
    try:
        scheduler_mod._run_account_purge()
    finally:
        config.ACCOUNT_ORPHAN_ADOPTION = _prev

    ts = tombstone(crm, '1212')
    assert ts is not None, 'orphan was not adopted'
    assert ts['purge_after'] > db.iso_utc_now(), f'adopted orphan purged immediately: {ts}'
    assert all(v == 1 for v in counts(crm, '1212').values()), 'adoption deleted rows'
    # The still-connected sibling must not be adopted.
    assert tombstone(crm, '1213') is None, 'live account was tombstoned'

    # Adoption is idempotent and must not keep pushing the deadline out, or
    # nothing would ever come due.
    scheduler_mod._run_account_purge()
    assert tombstone(crm, '1212')['purge_after'] == ts['purge_after'], 'deadline reset'

    # …and once it's due, the normal sweep clears it.
    expire_tombstone(crm, '1212')
    scheduler_mod._run_account_purge()
    assert not any(counts(crm, '1212').values()), counts(crm, '1212')
    assert all(v == 1 for v in counts(crm, '1213').values()), 'sibling swept too'


@scenario
def s13_delete_route_retains_by_default():
    """DELETE /accounts/<id> with no flag: account gone, data tombstoned, and
    the response tells the caller how long the undo lasts."""
    crm, hdr = panel_with_key()
    seed(crm, '1313')

    r = CLIENT.delete(f'/api/crm/{crm}/accounts/1313', headers=hdr)
    assert r.status_code == 200, (r.status_code, r.get_data(as_text=True)[:200])
    body = r.get_json() or {}
    assert body.get('success') is True, body
    assert body.get('data_purged') is False, body
    assert body.get('data_retained_until'), body

    assert not account_exists(crm, '1313')
    assert tombstone(crm, '1313') is not None
    assert all(v == 1 for v in counts(crm, '1313').values()), counts(crm, '1313')

    # Second DELETE 404s — the account row really is gone.
    r = CLIENT.delete(f'/api/crm/{crm}/accounts/1313', headers=hdr)
    assert r.status_code == 404, r.status_code


@scenario
def s14_delete_route_purge_flag():
    """?purge=true erases straight away and reports what it removed."""
    crm, hdr = panel_with_key()
    seed(crm, '1414')

    r = CLIENT.delete(f'/api/crm/{crm}/accounts/1414?purge=true', headers=hdr)
    assert r.status_code == 200, (r.status_code, r.get_data(as_text=True)[:200])
    body = r.get_json() or {}
    assert body.get('data_purged') is True, body
    assert body.get('data_retained_until') is None, body
    assert body.get('purged_rows'), body

    assert not any(counts(crm, '1414').values()), counts(crm, '1414')
    assert tombstone(crm, '1414') is None


@scenario
def s15_delete_route_cannot_reach_another_tenant():
    """The route is the only caller of delete_of_account — an API key for one
    panel must not be able to disconnect (or purge) another panel's account."""
    crm_a, hdr_a = panel_with_key()
    crm_b, _hdr_b = panel_with_key()
    seed(crm_a, '1515')
    seed(crm_b, '1515')

    r = CLIENT.delete(f'/api/crm/{crm_b}/accounts/1515?purge=true', headers=hdr_a)
    assert r.status_code in (401, 403, 404), r.status_code
    assert account_exists(crm_b, '1515'), 'cross-tenant delete succeeded'
    assert all(v == 1 for v in counts(crm_b, '1515').values()), counts(crm_b, '1515')


def main():
    scenarios = [
        s01_credentials_and_2fa_session_go_immediately,
        s02_cached_data_is_retained_not_destroyed,
        s03_sweeper_purges_every_account_scoped_table,
        s04_sibling_account_on_same_panel_is_untouched,
        s05_same_of_user_id_on_another_panel_is_untouched,
        s06_purge_now_erases_in_one_shot,
        s07_reconnect_inside_the_window_restores_history,
        s08_tombstoned_data_is_hidden_from_panel_wide_reads,
        s09_panel_wide_automations_survive,
        s10_delete_is_atomic,
        s11_repeat_disconnect_restarts_the_clock,
        s12_purge_list_covers_every_account_scoped_table,
        s12b_sweeper_adopts_pre_tombstone_orphans,
        s13_delete_route_retains_by_default,
        s14_delete_route_purge_flag,
        s15_delete_route_cannot_reach_another_tenant,
    ]
    print(f"Running {len(scenarios)} account-deletion scenarios "
          f"(db: {db.DB_FILE})")
    for s in scenarios:
        s()
    print()
    if _failures:
        print(f"FAILED: {len(_failures)}")
        for name, msg in _failures:
            print(f"  - {name}: {msg}")
        sys.exit(1)
    print(f"All {len(scenarios)} scenarios passed.")


if __name__ == "__main__":
    main()
