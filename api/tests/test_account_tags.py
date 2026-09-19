#!/usr/bin/env python3
"""Scenario suite for account tags + the server-side accounts search/filter.

HTTP-level via the Flask test_client, zero network, throwaway DB. Covers the
third instance of the fan_tags / campaign_tags pattern:

    POST   /accounts/<id>/tags          {"tag": "agency-a"}
    DELETE /accounts/<id>/tags/<tag>
    GET    /accounts?search=&tag=       server-side filtering + `tags`/`all_tags`

...plus the two properties that make it usable at the ~600-account scale this
was built for and that a plain "does it filter?" test would not catch:

  * the tag filter must ride idx_account_tags_tag, not scan (s16/s17). The plan
    is taken from the ACTUAL statement the route issued, captured off a sqlite
    trace callback, so it cannot drift away from the code it claims to check.
  * GET /accounts must cost the same number of SQL statements for 30 accounts
    as for 3 (s18) — the N+1 shape that was removed from this page once already.

Run:

    cd onlyfans-api && venv/bin/python tests/test_account_tags.py
"""

from __future__ import annotations

import os
import sqlite3 as _real_sqlite3
import sys
import tempfile
import traceback

os.environ['WERKZEUG_RUN_MAIN'] = 'false'
os.environ.setdefault('DATABASE_PATH', tempfile.mktemp(suffix='.db'))
os.environ.setdefault('SECRET_KEY', 'x' * 40)
os.environ.setdefault('ENCRYPTION_KEY', 'y' * 40)
os.environ.setdefault('TWOCAPTCHA_API_KEY', 'z' * 16)

# Lift the rate limits for this process, BEFORE config imports. This suite
# issues far more requests per minute than a human would, and the DEPLOYED
# limits (.env: 100/min default, 10/min sensitive) would answer most of them
# with a 429 — the suite would then be testing flask-limiter.
#
# Note these are the values that actually matter: config.py's fallbacks are
# 600/120/10 and apply only when .env is missing, which is exactly what a git
# worktree looks like (.env is gitignored). Measure limits on the real box.
# load_dotenv() does not override an already-set variable, so this wins.
os.environ['RATE_LIMIT_DEFAULT'] = '10000000 per minute'
os.environ['RATE_LIMIT_SENSITIVE'] = '10000000 per minute'
# The status column's honesty gate asserts Fansly polling is off. That is a
# deployment choice, not a code property — this box has it ON — so pin it here
# rather than letting the suite read whatever the operator happens to have set.
os.environ['FANSLY_POLLING_ENABLED'] = 'false'

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import crm_database as db          # noqa: E402
import crm_api                     # noqa: E402
import scheduler as scheduler_mod  # noqa: E402

scheduler_mod.schedule_account = lambda *a, **k: None
scheduler_mod.unschedule_account = lambda *a, **k: None
scheduler_mod.start_ws_listener = lambda *a, **k: None
scheduler_mod.start_fansly_ws_listener = lambda *a, **k: None

db.init_database()


# ── SQL tracing ────────────────────────────────────────────────────────────
# crm_database does `sqlite3.connect(DB_FILE)` at module scope, so swapping the
# module-level name gives us every statement the DB layer runs — with bound
# values already inlined by sqlite's tracer, which is what lets s16/s17 EXPLAIN
# the real query instead of a hand-copied lookalike.

_traced: list[str] = []
_tracing = [False]


class _SqliteProxy:
    def __getattr__(self, name):
        return getattr(_real_sqlite3, name)

    def connect(self, *a, **k):
        conn = _real_sqlite3.connect(*a, **k)
        if _tracing[0]:
            conn.set_trace_callback(_traced.append)
        return conn


db.sqlite3 = _SqliteProxy()


def trace(fn):
    """Run fn() while recording SQL; return (result, [statements])."""
    _traced.clear()
    _tracing[0] = True
    try:
        result = fn()
    finally:
        _tracing[0] = False
    return result, list(_traced)


def plan_for(sql):
    conn = _real_sqlite3.connect(db.DB_FILE)
    try:
        return [' '.join(str(c) for c in r[3:])
                for r in conn.execute('EXPLAIN QUERY PLAN ' + sql)]
    finally:
        conn.close()


# ── Fixtures ───────────────────────────────────────────────────────────────
panel = db.create_crm_panel('Account Tags Panel')
CRM_ID, KEY = panel['crm_id'], panel['api_key']
OTHER = db.create_crm_panel('Other Tenant Panel')
OTHER_CRM_ID, OTHER_KEY = OTHER['crm_id'], OTHER['api_key']

A1 = '482000111'   # username 'roxy',  agency-a + vip
A2 = '482000222'   # username 'daisy', agency-b
A3 = '847000000000000333'  # fansly, username 'nova', untagged
OTHER_ACCT = '482000999'

db.add_of_account(crm_id=CRM_ID, of_user_id=A1, email='roxy@test.com',
                  password=None, username='roxy')
db.add_of_account(crm_id=CRM_ID, of_user_id=A2, email='daisy@example.com',
                  password=None, username='daisy')
db.add_of_account(crm_id=CRM_ID, of_user_id=A3, email='nova@test.com',
                  password=None, username='nova', platform='fansly')
db.add_of_account(crm_id=OTHER_CRM_ID, of_user_id=OTHER_ACCT,
                  email='x@test.com', password=None, username='someoneelse')

client = crm_api.app.test_client()
H = {'X-API-Key': KEY, 'User-Agent': 'Mozilla/5.0 test'}
OTHER_H = {'X-API-Key': OTHER_KEY, 'User-Agent': 'Mozilla/5.0 test'}
ACCOUNTS = f'/api/crm/{CRM_ID}/accounts'

_failures: list = []


def reset_tags():
    conn = _real_sqlite3.connect(db.DB_FILE)
    try:
        conn.execute('DELETE FROM account_tags')
        conn.commit()
    finally:
        conn.close()
    db.add_account_tag(CRM_ID, A1, 'agency-a')
    db.add_account_tag(CRM_ID, A1, 'vip')
    db.add_account_tag(CRM_ID, A2, 'agency-b')
    db.add_account_tag(OTHER_CRM_ID, OTHER_ACCT, 'agency-a')


def scenario(fn):
    def run():
        reset_tags()
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


def get_accounts(query=''):
    r = client.get(f'{ACCOUNTS}{query}', headers=H)
    assert r.status_code == 200, f'{r.status_code}: {r.get_data(as_text=True)[:200]}'
    return r.get_json()


def ids(body):
    return sorted(str(a['of_user_id']) for a in body['accounts'])


# ── Tag CRUD ───────────────────────────────────────────────────────────────

@scenario
def s01_tags_ride_along_on_the_accounts_list():
    """No second request: the page gets tags from the list it already fetched."""
    by_id = {str(a['of_user_id']): a for a in get_accounts()['accounts']}
    assert by_id[A1]['tags'] == ['agency-a', 'vip'], by_id[A1]['tags']
    assert by_id[A2]['tags'] == ['agency-b'], by_id[A2]['tags']
    # An untagged account gets [], never a missing key — the UI maps over it.
    assert by_id[A3]['tags'] == [], by_id[A3]['tags']


@scenario
def s02_add_tag_route():
    r = client.post(f'{ACCOUNTS}/{A3}/tags', json={'tag': 'new-signup'}, headers=H)
    assert r.status_code == 200, r.status_code
    assert r.get_json()['success'] is True
    by_id = {str(a['of_user_id']): a for a in get_accounts()['accounts']}
    assert by_id[A3]['tags'] == ['new-signup'], by_id[A3]['tags']


@scenario
def s03_adding_the_same_tag_twice_is_idempotent():
    """UNIQUE(crm_id, of_user_id, tag) — a double-click must not 500 or dupe."""
    for _ in range(2):
        r = client.post(f'{ACCOUNTS}/{A1}/tags', json={'tag': 'vip'}, headers=H)
        assert r.status_code == 200, r.status_code
        assert r.get_json()['success'] is True
    by_id = {str(a['of_user_id']): a for a in get_accounts()['accounts']}
    assert by_id[A1]['tags'] == ['agency-a', 'vip'], by_id[A1]['tags']


@scenario
def s04_remove_tag_route():
    r = client.delete(f'{ACCOUNTS}/{A1}/tags/vip', headers=H)
    assert r.status_code == 200, r.status_code
    assert r.get_json()['success'] is True
    by_id = {str(a['of_user_id']): a for a in get_accounts()['accounts']}
    assert by_id[A1]['tags'] == ['agency-a'], by_id[A1]['tags']


@scenario
def s05_removing_a_tag_that_isnt_there_reports_false_not_500():
    r = client.delete(f'{ACCOUNTS}/{A1}/tags/nope', headers=H)
    assert r.status_code == 200, r.status_code
    assert r.get_json()['success'] is False


@scenario
def s06_tags_are_per_account_not_per_panel():
    """Removing a tag from one account must leave the sibling's copy alone."""
    db.add_account_tag(CRM_ID, A2, 'vip')
    client.delete(f'{ACCOUNTS}/{A1}/tags/vip', headers=H)
    by_id = {str(a['of_user_id']): a for a in get_accounts()['accounts']}
    assert 'vip' not in by_id[A1]['tags'], by_id[A1]['tags']
    assert 'vip' in by_id[A2]['tags'], by_id[A2]['tags']


# ── Validation ─────────────────────────────────────────────────────────────

@scenario
def s07_empty_tag_is_rejected():
    r = client.post(f'{ACCOUNTS}/{A1}/tags', json={'tag': '   '}, headers=H)
    assert r.status_code == 400, r.status_code


@scenario
def s08_overlong_tag_is_rejected_on_both_write_paths():
    long_tag = 'x' * 41
    r = client.post(f'{ACCOUNTS}/{A1}/tags', json={'tag': long_tag}, headers=H)
    assert r.status_code == 400, r.status_code
    r = client.delete(f'{ACCOUNTS}/{A1}/tags/{long_tag}', headers=H)
    assert r.status_code == 400, r.status_code


@scenario
def s09_non_numeric_account_id_is_rejected_before_the_db():
    r = client.post(f'{ACCOUNTS}/..%2F..%2Fetc/tags', json={'tag': 'x'}, headers=H)
    assert r.status_code in (400, 403, 404), r.status_code


@scenario
def s10_overlong_search_and_tag_params_are_rejected():
    assert client.get(f'{ACCOUNTS}?search={"x" * 81}', headers=H).status_code == 400
    assert client.get(f'{ACCOUNTS}?tag={"x" * 41}', headers=H).status_code == 400


# ── Filtering ──────────────────────────────────────────────────────────────

@scenario
def s11_tag_filter_narrows_server_side():
    body = get_accounts('?tag=agency-a')
    assert ids(body) == [A1], ids(body)
    assert body['count'] == 1, body['count']
    body = get_accounts('?tag=agency-b')
    assert ids(body) == [A2], ids(body)
    body = get_accounts('?tag=does-not-exist')
    assert body['accounts'] == [], body['accounts']


@scenario
def s12_search_matches_username_email_and_exact_id():
    assert ids(get_accounts('?search=rox')) == [A1]
    assert ids(get_accounts('?search=example.com')) == [A2]
    assert ids(get_accounts(f'?search={A3}')) == [A3]
    # SQLite LIKE is ASCII-case-insensitive by default — relied on instead of a
    # LOWER() wrapper, which would be a derived predicate.
    assert ids(get_accounts('?search=ROX')) == [A1]


@scenario
def s13_search_and_tag_combine_as_and():
    assert ids(get_accounts('?search=roxy&tag=agency-a')) == [A1]
    # daisy exists and agency-a exists, but not together.
    assert get_accounts('?search=daisy&tag=agency-a')['accounts'] == []


@scenario
def s14_all_tags_is_the_unfiltered_panel_universe():
    """The filter control must not delete its own options once one is picked."""
    unfiltered = get_accounts()['all_tags']
    assert unfiltered == ['agency-a', 'agency-b', 'vip'], unfiltered
    filtered = get_accounts('?tag=agency-a')
    assert filtered['all_tags'] == unfiltered, filtered['all_tags']
    assert len(filtered['accounts']) == 1


@scenario
def s15_tags_never_cross_the_tenant_boundary():
    """The other panel also has an 'agency-a' tag on its own account."""
    assert ids(get_accounts('?tag=agency-a')) == [A1]
    other = client.get(f'/api/crm/{OTHER_CRM_ID}/accounts?tag=agency-a',
                       headers=OTHER_H).get_json()
    assert ids(other) == [OTHER_ACCT], ids(other)
    assert other['all_tags'] == ['agency-a'], other['all_tags']


# ── Index / cost ───────────────────────────────────────────────────────────

@scenario
def s16_tag_filter_uses_its_index_and_never_a_temp_btree():
    """The plan is EXPLAINed from the statement the route actually issued.

    The filter is an `IN (subquery)` and not a correlated EXISTS for a reason
    this scenario locks in: EXISTS also 'uses an index' — it just uses the
    WRONG one, probing account_tags once per account in the panel, and once
    ANALYZE has run SQLite abandons the outer index and picks SCAN of_accounts.
    Measured at 600 accounts returning 5: ~110us for EXISTS vs ~5.8us here.
    """
    _, stmts = trace(lambda: get_accounts('?tag=agency-a'))
    sel = [s for s in stmts if s.startswith('SELECT id, crm_panel_id')]
    assert len(sel) == 1, f'expected one accounts SELECT, got {sel}'
    plan = plan_for(sel[0])
    joined = ' | '.join(plan)
    assert 'idx_account_tags_tag' in joined, joined
    assert 'SCAN account_tags' not in joined, joined
    assert 'TEMP B-TREE' not in joined.upper(), joined
    # The whole point: no full scan of the accounts table either.
    assert 'SCAN of_accounts' not in joined, joined


@scenario
def s17_the_tag_lookup_is_covered_by_the_index():
    """A covering index means the filter never touches the account_tags heap —
    and it must be the tag-leading index, not the UNIQUE auto-index, or the
    optimiser has quietly inverted the loop order (see s16)."""
    _, stmts = trace(lambda: get_accounts('?tag=agency-a'))
    sel = [s for s in stmts if s.startswith('SELECT id, crm_panel_id')][0]
    tag_lines = [l for l in plan_for(sel) if 'account_tags' in l]
    assert tag_lines, plan_for(sel)
    assert any('COVERING INDEX idx_account_tags_tag' in l for l in tag_lines), tag_lines


@scenario
def s18_accounts_read_is_o1_in_statements_not_o_accounts():
    """The N+1 that was already removed from this page once must not return.
    Same statement count for 30 accounts as for 3."""
    small, _ = trace(lambda: None)  # noqa: F841 — warm caches below instead
    get_accounts()                  # warm the rate-limit-exempt TTL cache
    _, few = trace(lambda: get_accounts())
    base = len(few)

    bulk = db.create_crm_panel('Bulk Panel')
    bulk_h = {'X-API-Key': bulk['api_key'], 'User-Agent': 'Mozilla/5.0 test'}
    for i in range(30):
        uid = f'4830000{i:03d}'
        db.add_of_account(crm_id=bulk['crm_id'], of_user_id=uid,
                          email=f'a{i}@bulk.test', password=None,
                          username=f'creator{i}')
        db.add_account_tag(bulk['crm_id'], uid, 'agency-a')

    def read_bulk():
        r = client.get(f"/api/crm/{bulk['crm_id']}/accounts", headers=bulk_h)
        assert r.status_code == 200, r.status_code
        return r.get_json()

    read_bulk()                     # warm this panel's caches too
    body, many = trace(read_bulk)
    assert len(body['accounts']) == 30, len(body['accounts'])
    assert all(a['tags'] == ['agency-a'] for a in body['accounts']), 'tags lost'
    assert len(many) == base, (
        f'statement count grew with account count: {base} for 3 accounts, '
        f'{len(many)} for 30 — an N+1 crept back in:\n' + '\n'.join(many))


# ── Auth ───────────────────────────────────────────────────────────────────

@scenario
def s19_another_tenants_account_is_403_on_both_writes():
    assert client.post(f'{ACCOUNTS}/{OTHER_ACCT}/tags', json={'tag': 'x'},
                       headers=H).status_code == 403
    assert client.delete(f'{ACCOUNTS}/{OTHER_ACCT}/tags/agency-a',
                         headers=H).status_code == 403
    # ...and the other tenant's tag really is still there.
    assert db.get_account_tags(OTHER_CRM_ID)[OTHER_ACCT] == ['agency-a']


@scenario
def s20_missing_or_foreign_api_key_is_rejected():
    ua = {'User-Agent': 'Mozilla/5.0 test'}
    assert client.get(ACCOUNTS, headers=ua).status_code in (401, 403)
    assert client.post(f'{ACCOUNTS}/{A1}/tags', json={'tag': 'x'},
                       headers=ua).status_code in (401, 403)
    foreign = {'X-API-Key': OTHER_KEY, **ua}
    assert client.post(f'{ACCOUNTS}/{A1}/tags', json={'tag': 'x'},
                       headers=foreign).status_code in (401, 403)


# ── Regression guard on the untouched payload ──────────────────────────────

@scenario
def s21_status_fields_the_table_renders_are_all_present():
    """The row-level status column reads these off the list response; if any
    one silently stops being emitted the column lies instead of erroring."""
    a = get_accounts()['accounts'][0]
    for k in ('polling_enabled', 'polling_interval_seconds', 'last_polled_at',
              'polling_failure_count', 'needs_reconnect', 'last_balance_at',
              'last_balance_available', 'capabilities', 'platform'):
        assert k in a, f'{k} missing from the accounts payload: {sorted(a)}'


@scenario
def s22_fansly_polling_capability_is_false_by_default():
    """The honesty gate for the status column: FANSLY_POLLING_ENABLED ships
    false, so a Fansly row must never be able to claim it is being polled."""
    import config
    assert config.FANSLY_POLLING_ENABLED is False, 'test env has it enabled'
    by_id = {str(a['of_user_id']): a for a in get_accounts()['accounts']}
    assert by_id[A3]['platform'] == 'fansly'
    assert by_id[A3]['capabilities']['polling'] is False, by_id[A3]['capabilities']
    assert by_id[A1]['capabilities']['polling'] is True, by_id[A1]['capabilities']


def main():
    scenarios = [
        s01_tags_ride_along_on_the_accounts_list,
        s02_add_tag_route,
        s03_adding_the_same_tag_twice_is_idempotent,
        s04_remove_tag_route,
        s05_removing_a_tag_that_isnt_there_reports_false_not_500,
        s06_tags_are_per_account_not_per_panel,
        s07_empty_tag_is_rejected,
        s08_overlong_tag_is_rejected_on_both_write_paths,
        s09_non_numeric_account_id_is_rejected_before_the_db,
        s10_overlong_search_and_tag_params_are_rejected,
        s11_tag_filter_narrows_server_side,
        s12_search_matches_username_email_and_exact_id,
        s13_search_and_tag_combine_as_and,
        s14_all_tags_is_the_unfiltered_panel_universe,
        s15_tags_never_cross_the_tenant_boundary,
        s16_tag_filter_uses_its_index_and_never_a_temp_btree,
        s17_the_tag_lookup_is_covered_by_the_index,
        s18_accounts_read_is_o1_in_statements_not_o_accounts,
        s19_another_tenants_account_is_403_on_both_writes,
        s20_missing_or_foreign_api_key_is_rejected,
        s21_status_fields_the_table_renders_are_all_present,
        s22_fansly_polling_capability_is_false_by_default,
    ]
    print(f"Running {len(scenarios)} account-tag scenarios (db: {db.DB_FILE})")
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
