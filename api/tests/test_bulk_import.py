#!/usr/bin/env python3
"""Scenario suite for bulk account import.

Covers import_parser (every paste shape), the import_jobs/import_job_rows
schema, import_runner (two lanes, 2FA parking, resume, failure classification,
credential lifetime) and the eight HTTP routes.

ZERO network. Every platform call is stubbed at the account_connect boundary —
a suite that could perform a real bulk OnlyFans login would look exactly like
credential stuffing from our IP, which is the failure mode this whole feature
is built to avoid.

    cd onlyfans-api && python3 tests/test_bulk_import.py
"""

from __future__ import annotations

import json
import os
import queue
import sqlite3
import sys
import tempfile
import traceback

# Isolate from the real deployment BEFORE importing app modules.
os.environ['WERKZEUG_RUN_MAIN'] = 'false'          # don't auto-start scheduler
os.environ.setdefault('DATABASE_PATH', tempfile.mktemp(suffix='.db'))
os.environ.setdefault('SECRET_KEY', 'x' * 40)
os.environ.setdefault('ENCRYPTION_KEY', 'y' * 40)
os.environ.setdefault('TWOCAPTCHA_API_KEY', 'z' * 16)
os.environ.setdefault('EXPORTS_DIR', tempfile.mkdtemp(prefix='exports_test_'))

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import config                       # noqa: E402
import crm_database as db           # noqa: E402
import scheduler as scheduler_mod   # noqa: E402
import crm_api                      # noqa: E402
import account_connect              # noqa: E402
import import_parser                # noqa: E402
import import_runner                # noqa: E402
from sse_hub import hub             # noqa: E402

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
    run.__name__ = fn.__name__
    return run


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

_seq = [0]


def _uniq(prefix='p'):
    _seq[0] += 1
    return f'{prefix}{_seq[0]}'


def panel():
    p = db.create_crm_panel(_uniq('panel'))
    return p['crm_id'], {'X-API-Key': p['api_key']}


def _conn():
    return sqlite3.connect(db.DB_FILE)


def raw_row(row_id):
    """The row straight out of SQLite — the only honest way to assert that a
    ciphertext column really is NULL on disk."""
    conn = _conn()
    conn.row_factory = sqlite3.Row
    try:
        r = conn.execute('SELECT * FROM import_job_rows WHERE id = ?', (row_id,)).fetchone()
        return dict(r) if r else None
    finally:
        conn.close()


def raw_rows(job_id):
    conn = _conn()
    conn.row_factory = sqlite3.Row
    try:
        return [dict(r) for r in conn.execute(
            'SELECT * FROM import_job_rows WHERE job_id = ? ORDER BY row_index',
            (job_id,)).fetchall()]
    finally:
        conn.close()


def table_counts():
    conn = _conn()
    try:
        return (conn.execute('SELECT COUNT(*) FROM import_jobs').fetchone()[0],
                conn.execute('SELECT COUNT(*) FROM import_job_rows').fetchone()[0])
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# Network stubs — the whole platform boundary, replaced
# ---------------------------------------------------------------------------

class Stub:
    """Programmable stand-in for account_connect.

    `outcomes` maps an email to what the platform 'returns'. `calls` records
    every attempt so a test can assert how MANY logins a row cost — which is
    the entire point of permanent-vs-transient classification.
    """

    def __init__(self):
        self.outcomes = {}
        self.calls = []
        self.otp_calls = []
        self.next_user_id = 700000

    def reset(self):
        self.outcomes.clear()
        self.calls.clear()
        self.otp_calls.clear()

    # -- fakes installed onto account_connect ---------------------------
    def of_password_login(self, email, password, proxy=None, use_captcha=True):
        self.calls.append(('password', email, proxy))
        return self._resolve(email)

    def of_cookie_connect(self, sess, auth_id, fp=None, proxy=None):
        self.calls.append(('cookie', auth_id, proxy))
        return self._resolve(f'cookie:{auth_id}')

    def of_verify_otp(self, email, otp_code, x_bc, x_hash, cookies, proxy=None):
        self.otp_calls.append((email, otp_code))
        outcome = self.outcomes.get(f'otp:{email}')
        if outcome is not None:
            return outcome
        return self._authenticated(email)

    def persist(self, crm_id, platform, session, email=None, password=None,
                proxy=None, me=None):
        of_user_id = str(session['user_id'])
        db.add_of_account(crm_id, of_user_id, email or f'{of_user_id}@x.test',
                          password=password, username=f'u{of_user_id}',
                          proxy=proxy, platform=platform)
        return of_user_id, f'u{of_user_id}'

    def notify_slot(self, crm_id, of_user_id):
        return None

    # -- helpers ---------------------------------------------------------
    def _authenticated(self, email):
        self.next_user_id += 1
        return {'status': 'authenticated',
                'session': {'user_id': str(self.next_user_id), 'data': {},
                            'cookies': {}, 'x_bc': 'bc', 'x_hash': 'hash'}}

    def _resolve(self, key):
        outcome = self.outcomes.get(key)
        if outcome is None:
            return self._authenticated(key)
        if callable(outcome):
            return outcome(key)
        return outcome


STUB = Stub()
# Captured BEFORE the stub replaces it — s18 needs the real implementation to
# prove it degrades gracefully when login.verify_otp does not exist.
REAL_OF_VERIFY_OTP = account_connect.of_verify_otp
account_connect.of_password_login = STUB.of_password_login
account_connect.of_cookie_connect = STUB.of_cookie_connect
account_connect.of_verify_otp = STUB.of_verify_otp
account_connect.persist = STUB.persist
account_connect.notify_slot = STUB.notify_slot

# The 30-logins/min budget is real, correct, and the whole point in production
# — but honouring it here would make this suite spend ~20 minutes asleep. Swap
# in an effectively unlimited bucket; the throttle itself is exercised directly
# in s32, and what every other scenario tests is the machinery around it.
import_runner._login_bucket = import_runner.TokenBucket(1_000_000)
# Same for the per-proxy gate: with no proxies every row shares ':direct', so
# the production setting serializes them. Correct on a real box, pointless
# here. s32 asserts the gate's actual behaviour.
import_runner._host_gate = import_runner.HostGate(64)

# Jobs are run by hand so every test is deterministic.
_dispatched: list[tuple] = []
scheduler_mod.run_in_background = lambda fn, *a, **k: (_dispatched.append((fn, a)) or 'stub')


def run_job(crm_id, job_id):
    import_runner.run_import(crm_id, job_id)


def create_job(crm_id, headers, text, **body):
    payload = {'text': text}
    payload.update(body)
    r = CLIENT.post(f'/api/crm/{crm_id}/import/jobs', json=payload, headers=headers)
    return r


# ===========================================================================
# 1. Parser — every paste shape the operator might arrive with
# ===========================================================================

@scenario
def s01_bare_email_password():
    """The most common way these lists circulate: one `email:password` per
    line, no header, no delimiter."""
    p = import_parser.parse('a@b.com:secret1\nc@d.com:secret2\n')
    assert p['format'] == 'bare', p['format']
    assert p['delimiter'] == ':', p['delimiter']
    assert p['valid_count'] == 2, p
    assert [r['email'] for r in p['rows']] == ['a@b.com', 'c@d.com']
    assert [r['password'] for r in p['rows']] == ['secret1', 'secret2']
    assert all(r['platform'] == 'onlyfans' for r in p['rows'])
    assert all(r['lane'] == 'password' for r in p['rows'])

    # A password containing the delimiter characters must survive: the address
    # half of the regex is what disambiguates, not the password half.
    p = import_parser.parse('a@b.com:pa,ss;wo|rd\n' * 3)
    assert p['format'] == 'bare', p['format']
    assert p['rows'][0]['password'] == 'pa,ss;wo|rd', p['rows'][0]


@scenario
def s02_headerless_positional():
    """No header -> email, password, platform, proxy, totp_secret."""
    text = 'a@b.com,pw1\nc@d.com,pw2,fansly\n'
    p = import_parser.parse(text)
    assert p['format'] == 'delimited' and p['delimiter'] == ',', p
    assert p['has_header'] is False, p['has_header']
    assert p['columns'] == list(import_parser.POSITIONAL_FIELDS), p['columns']
    assert p['rows'][0]['email'] == 'a@b.com' and p['rows'][0]['password'] == 'pw1'
    assert p['rows'][1]['platform'] == 'fansly', p['rows'][1]

    # Full positional line including proxy + totp.
    p = import_parser.parse('e@f.com,pw,of,http://u:p@1.2.3.4:8080,JBSWY3DPEHPK3PXP\n')
    r = p['rows'][0]
    assert r['platform'] == 'onlyfans', r
    assert r['proxy'] == 'http://u:p@1.2.3.4:8080', r['proxy']
    assert r['totp_secret'] == 'JBSWY3DPEHPK3PXP', r['totp_secret']
    assert r['valid'], r['errors']


@scenario
def s03_all_delimiters_and_aliases():
    """`,` `;` TAB `|` all auto-detect, and column names are matched
    case/underscore/space/hyphen-insensitively through the alias table."""
    for delim in (',', ';', '\t', '|'):
        text = (f'Login{delim}Pass{delim}Site{delim}2FA Secret\n'
                f'x@y.com{delim}pw{delim}Fansly{delim}JBSWY3DPEHPK3PXP\n')
        p = import_parser.parse(text)
        assert p['delimiter'] == delim, (delim, p['delimiter'])
        assert p['has_header'] is True, (delim, p)
        r = p['rows'][0]
        assert r['email'] == 'x@y.com', (delim, r)
        assert r['password'] == 'pw', (delim, r)
        assert r['platform'] == 'fansly', (delim, r)
        assert r['totp_secret'] == 'JBSWY3DPEHPK3PXP', (delim, r)

    # Every documented alias resolves.
    for alias in ('email', 'login', 'user', 'username', 'mail'):
        p = import_parser.parse(f'{alias},password\nq@w.com,pw\n')
        assert p['rows'][0]['email'] == 'q@w.com', alias
    for alias in ('password', 'pass', 'pwd', 'haslo'):
        p = import_parser.parse(f'email,{alias}\nq@w.com,pw\n')
        assert p['rows'][0]['password'] == 'pw', alias
    for alias in ('totp_secret', 'totp', '2fa', '2fa_secret', 'otp_secret', 'secret'):
        p = import_parser.parse(f'email,password,{alias}\nq@w.com,pw,JBSWY3DPEHPK3PXP\n')
        assert p['rows'][0]['totp_secret'] == 'JBSWY3DPEHPK3PXP', alias
    for alias in ('label', 'name', 'note'):
        p = import_parser.parse(f'email,password,{alias}\nq@w.com,pw,Ana\n')
        assert p['rows'][0]['label'] == 'Ana', alias
    for alias in ('platform', 'site'):
        p = import_parser.parse(f'email,password,{alias}\nq@w.com,pw,of\n')
        assert p['rows'][0]['platform'] == 'onlyfans', alias


@scenario
def s04_cookie_mode_rows():
    """`sess`/`auth_id`/`fp` (OF) and `auth_token` (Fansly) flip a row into the
    cheap lane, and a cookie row carries no password."""
    p = import_parser.parse('sess,auth_id,fp\nSESSVAL,12345,FPVAL\n')
    r = p['rows'][0]
    assert r['lane'] == 'cookie', r
    assert r['cookies'] == {'sess': 'SESSVAL', 'auth_id': '12345', 'fp': 'FPVAL'}, r
    assert r['password'] is None, r
    assert r['valid'], r['errors']

    # `user_id` is an accepted spelling of auth_id.
    p = import_parser.parse('sess,user_id\nS,999\n')
    assert p['rows'][0]['cookies']['auth_id'] == '999', p['rows'][0]

    # Fansly token row.
    p = import_parser.parse('platform,auth_token\nfansly,TOKEN123\n')
    r = p['rows'][0]
    assert r['lane'] == 'cookie' and r['platform'] == 'fansly', r
    assert r['valid'], r['errors']

    # An OF cookie row missing auth_id is invalid, and names the missing field.
    # Lane is chosen on intent, so this must NOT come back as "password is
    # required" — the operator never meant to supply one.
    p = import_parser.parse('sess,fp\nSESSONLY,FPV\n')
    r = p['rows'][0]
    assert r['lane'] == 'cookie', r
    assert not r['valid'] and 'auth_id' in ' '.join(r['errors']), r
    assert 'password' not in ' '.join(r['errors']).lower(), r


@scenario
def s05_hygiene_bom_quotes_comments_blanks():
    """BOM stripped, surrounding quotes stripped, blank lines and `#` comments
    skipped — and the reported line number still points at the operator's own
    paste, not at the compacted list."""
    raw = ('﻿# my accounts\n'
           '\n'
           'email,password\n'
           '"  a@b.com  ","  pw1  "\n'
           '\n'
           '# a comment mid-file\n'
           "'c@d.com','pw2'\n")
    p = import_parser.parse(raw)
    assert p['has_header'] is True, p
    assert [r['email'] for r in p['rows']] == ['a@b.com', 'c@d.com'], p['rows']
    assert [r['password'] for r in p['rows']] == ['pw1', 'pw2'], p['rows']
    # `"  a@b.com  "` is on source line 4; blank/comment lines were skipped but
    # the number was not renumbered.
    assert p['rows'][0]['line'] == 4, p['rows'][0]
    assert p['rows'][1]['line'] == 7, p['rows'][1]
    # utf-8-sig on bytes too.
    p = import_parser.parse('﻿a@b.com:pw\n'.encode('utf-8'))
    assert p['rows'][0]['email'] == 'a@b.com', p['rows'][0]


@scenario
def s06_malformed_rows_become_invalid_not_fatal():
    """One bad row must never kill the batch — the whole reason /preview and
    the runner treat validation per-row."""
    text = ('a@b.com,goodpw\n'
            'not-an-email,pw\n'
            'c@d.com,\n'
            ',pw\n'
            'e@f.com,pw,mastodon\n'
            'g@h.com,pw,,not-a-proxy\n'
            'i@j.com,pw,,,NOT-BASE32-!!\n'
            'k@l.com,finepw\n')
    p = import_parser.parse(text, proxy_validator=crm_api.validate_proxy)
    assert p['total'] == 8, p['total']
    valid = [r for r in p['rows'] if r['valid']]
    assert [r['email'] for r in valid] == ['a@b.com', 'k@l.com'], [r['email'] for r in valid]
    assert p['invalid_count'] == 6, p

    by_line = {r['line']: r for r in p['rows']}
    assert 'not a valid email' in ' '.join(by_line[2]['errors']), by_line[2]
    assert 'password' in ' '.join(by_line[3]['errors']).lower(), by_line[3]
    assert 'email is required' in ' '.join(by_line[4]['errors']), by_line[4]
    assert 'unknown platform' in ' '.join(by_line[5]['errors']), by_line[5]
    assert 'proxy' in ' '.join(by_line[6]['errors']).lower(), by_line[6]
    assert 'base32' in ' '.join(by_line[7]['errors']), by_line[7]

    # In bare mode a non-conforming line is one invalid ROW, not a reason to
    # re-read the whole document under different rules.
    p = import_parser.parse('a@b.com:pw\ngarbage line\nc@d.com:pw\n')
    assert p['format'] == 'bare', p['format']
    assert p['valid_count'] == 2 and p['invalid_count'] == 1, p
    assert 'email:password' in ' '.join(p['rows'][1]['errors']), p['rows'][1]


@scenario
def s07_limits_reject_they_do_not_truncate():
    """Over the cap is an error, not a silent cut. A truncating importer is how
    an operator ends up believing 1200 creators are connected."""
    ok = ''.join(f'a{i}@b.com:pw\n' for i in range(config.IMPORT_MAX_ROWS))
    p = import_parser.parse(ok)
    assert p['total'] == config.IMPORT_MAX_ROWS, p['total']

    over = ok + 'one@too.many:pw\n'
    try:
        import_parser.parse(over)
        raise AssertionError('1001 rows was accepted')
    except import_parser.ImportLimitError as e:
        assert str(config.IMPORT_MAX_ROWS) in str(e), str(e)

    # Byte cap: one row, but too many bytes.
    big = 'a@b.com:' + ('x' * (config.IMPORT_MAX_BYTES + 10))
    try:
        import_parser.parse(big)
        raise AssertionError('2 MiB+ was accepted')
    except import_parser.ImportLimitError as e:
        assert 'bytes' in str(e), str(e)

    # And over HTTP the row cap is a 413 with the limits echoed back.
    crm_id, headers = panel()
    r = CLIENT.post(f'/api/crm/{crm_id}/import/preview', json={'text': over},
                    headers=headers)
    assert r.status_code == 413, r.status_code
    body = r.get_json()
    assert body['code'] == 'IMPORT_LIMIT', body
    assert body['limits']['max_rows'] == config.IMPORT_MAX_ROWS, body


@scenario
def s08_credential_password_bounds_only():
    """validate_credential_password must NOT apply validate_password's rules.
    Rejecting a creator's real 7-character password loses the row and improves
    nobody's security."""
    for pw in ('hunter2', 'password123', '1234', 'a'):
        assert import_parser.check_credential_password(pw) is None, pw
        assert crm_api.validate_credential_password(pw) == pw, pw

    # …while validate_password still rejects exactly those, unchanged.
    for pw in ('hunter2', 'password123'):
        try:
            crm_api.validate_password(pw)
            raise AssertionError(f'validate_password accepted {pw!r}')
        except crm_api.ValidationError:
            pass

    assert import_parser.check_credential_password('') is not None
    assert import_parser.check_credential_password(None) is not None
    assert import_parser.check_credential_password(12345) is not None
    assert import_parser.check_credential_password('x' * 5000) is not None


# ===========================================================================
# 2. /preview — no side effects
# ===========================================================================

@scenario
def s09_preview_writes_nothing():
    """/preview is parse+validate and NOTHING else. If it ever starts writing,
    the UI's 'here is what will happen' promise becomes a lie."""
    crm_id, headers = panel()
    before = table_counts()
    accounts_before = len(db.get_of_accounts(crm_id))

    r = CLIENT.post(f'/api/crm/{crm_id}/import/preview',
                    json={'text': 'a@b.com:pw\nbad line\nc@d.com:pw\n'},
                    headers=headers)
    assert r.status_code == 200, (r.status_code, r.get_json())
    body = r.get_json()
    assert body['total'] == 3 and body['valid_count'] == 2, body
    assert body['format'] == 'bare' and body['delimiter'] == ':', body
    assert body['lanes'] == {'password': 2}, body['lanes']
    assert body['limits']['max_rows'] == config.IMPORT_MAX_ROWS, body

    assert table_counts() == before, (before, table_counts())
    assert len(db.get_of_accounts(crm_id)) == accounts_before

    # No secret is ever echoed back.
    blob = json.dumps(body)
    assert 'pw' not in json.loads(blob)['rows'][0].get('email', ''), body
    for row in body['rows']:
        assert 'password' not in row, row
        assert 'totp_secret' not in row, row
        assert row['has_password'] is True or not row['valid'], row

    # Proxy credentials are redacted down to host:port.
    r = CLIENT.post(f'/api/crm/{crm_id}/import/preview',
                    json={'text': 'e@f.com,pw,of,http://user:sekrit@1.2.3.4:8080\n'},
                    headers=headers)
    row = r.get_json()['rows'][0]
    assert row['proxy'] == '1.2.3.4:8080', row
    assert 'sekrit' not in json.dumps(r.get_json()), r.get_json()


@scenario
def s10_preview_applies_the_ssrf_guard():
    """The proxy validator carries is_safe_outbound_url. A preview that skipped
    it would tell the operator a loopback proxy is a perfectly good row."""
    crm_id, headers = panel()
    r = CLIENT.post(f'/api/crm/{crm_id}/import/preview',
                    json={'text': 'a@b.com,pw,of,http://127.0.0.1:6379\n'},
                    headers=headers)
    row = r.get_json()['rows'][0]
    assert row['valid'] is False, row
    assert 'proxy' in ' '.join(row['errors']).lower(), row


# ===========================================================================
# 3. Storage — encrypted at rest, destroyed at terminal
# ===========================================================================

@scenario
def s11_secrets_are_encrypted_at_rest():
    """No plaintext credential ever reaches the file."""
    STUB.reset()
    crm_id, headers = panel()
    text = ('email,password,totp_secret\n'
            'enc1@t.com,PLAINTEXT-PW,JBSWY3DPEHPK3PXP\n')
    r = create_job(crm_id, headers, text)
    assert r.status_code == 202, (r.status_code, r.get_json())
    job_id = r.get_json()['job']['job_id']

    rows = raw_rows(job_id)
    assert len(rows) == 1, rows
    row = rows[0]
    assert row['encrypted_password'], row
    assert row['encrypted_password'] != 'PLAINTEXT-PW', row
    assert row['encrypted_totp_secret'] != 'JBSWY3DPEHPK3PXP', row
    assert db.decrypt_password(row['encrypted_password']) == 'PLAINTEXT-PW'
    assert db.decrypt_password(row['encrypted_totp_secret']) == 'JBSWY3DPEHPK3PXP'

    # And nowhere in the whole file, in any column, is the plaintext present.
    conn = _conn()
    try:
        blob = ''.join(str(v) for r in conn.execute(
            'SELECT * FROM import_job_rows').fetchall() for v in r)
    finally:
        conn.close()
    assert 'PLAINTEXT-PW' not in blob, 'plaintext password found on disk'

    # A row that never parsed stores NO credential at all — keeping one for a
    # row we will never attempt is pure liability.
    r = create_job(crm_id, headers, 'good@t.com,pw\nbad-email,alsosecret\n')
    bad = [x for x in raw_rows(r.get_json()['job']['job_id'])
           if x['status'] == 'invalid'][0]
    assert bad['encrypted_password'] is None, bad


@scenario
def s12_secrets_zeroed_at_terminal_state():
    """The requirement in one sentence: 600 OnlyFans passwords must not sit in
    a SQLite file after the import finishes."""
    STUB.reset()
    crm_id, headers = panel()
    STUB.outcomes['perm@t.com'] = {'status': 'failed', 'error': 'Wrong email or password',
                                   'reason': 'invalid_credentials', 'permanent': True}
    text = ('email,password,totp_secret\n'
            'ok@t.com,pw-ok,JBSWY3DPEHPK3PXP\n'
            'perm@t.com,pw-bad,JBSWY3DPEHPK3PXP\n'
            'notanemail,pw-invalid,\n')
    r = create_job(crm_id, headers, text)
    job_id = r.get_json()['job']['job_id']

    # Before the run, live rows hold ciphertext.
    pre = raw_rows(job_id)
    assert sum(1 for x in pre if x['encrypted_password']) == 2, pre

    run_job(crm_id, job_id)

    post = raw_rows(job_id)
    states = {x['email']: x['status'] for x in post}
    assert states['ok@t.com'] == 'success', states
    assert states['perm@t.com'] == 'failed', states
    assert states['notanemail'] == 'invalid', states

    for row in post:
        assert row['status'] in db.TERMINAL_ROW_STATES, row['status']
        for col in db._IMPORT_ROW_SECRET_COLUMNS:
            assert row[col] is None, f"{row['email']} still holds {col}"

    conn = _conn()
    try:
        blob = ''.join(str(v) for r in conn.execute(
            'SELECT * FROM import_job_rows WHERE job_id = ?', (job_id,)).fetchall()
            for v in r)
    finally:
        conn.close()
    for secret in ('pw-ok', 'pw-bad', 'JBSWY3DPEHPK3PXP'):
        assert secret not in blob, f'{secret} survived the run'


# ===========================================================================
# 4. Runner — lanes, 2FA, classification
# ===========================================================================

@scenario
def s13_needs_2fa_does_not_block_the_others():
    """A parked row must not hold up the other 599. It is one row's state, not
    the job's."""
    STUB.reset()
    crm_id, headers = panel()
    STUB.outcomes['park3@t.com'] = {'status': 'needs_2fa', 'otp_state': 'ST',
                                    'x_bc': 'BC', 'x_hash': 'HS',
                                    'cookies': {'sess': 'S'}, 'twofa_type': 'totp'}
    text = ''.join(f'row{i}@t.com:pw{i}\n' for i in range(10))
    text = text.replace('row3@t.com', 'park3@t.com')
    r = create_job(crm_id, headers, text)
    job_id = r.get_json()['job']['job_id']
    run_job(crm_id, job_id)

    counts = db.count_import_rows(job_id)
    assert counts['success'] == 9, counts
    assert counts['needs_2fa'] == 1, counts
    assert counts['pending'] == 0 and counts['running'] == 0, counts

    job = db.get_import_job(crm_id, job_id)
    assert job['status'] == 'complete', job['status']

    parked = [x for x in raw_rows(job_id) if x['status'] == 'needs_2fa'][0]
    assert parked['otp_state'] == 'ST' and parked['x_bc'] == 'BC', parked
    assert parked['encrypted_2fa_cookies'], parked
    # Still holds its credential — a human is expected to come back.
    assert parked['encrypted_password'], parked
    assert parked['two_fa_expires_at'], parked

    # Countdown is exposed, and it is inside the configured window.
    remaining = import_runner.remaining_seconds(parked['two_fa_expires_at'])
    assert 0 < remaining <= config.TWO_FA_SESSION_EXPIRY, remaining

    # Panel-wide badge sees it, even though the job is over.
    r = CLIENT.get(f'/api/crm/{crm_id}/import/pending-2fa', headers=headers)
    body = r.get_json()
    assert body['count'] == 1, body
    assert body['rows'][0]['two_fa_remaining_seconds'] > 0, body['rows'][0]
    assert body['expiry_seconds'] == config.TWO_FA_SESSION_EXPIRY, body
    # …and never leaks the parked challenge material over the API.
    assert 'otp_state' not in body['rows'][0], body['rows'][0]
    assert 'x_bc' not in body['rows'][0], body['rows'][0]


@scenario
def s14_totp_secret_auto_generates_and_never_parks():
    """A row that brought its own secret answers its own challenge. This is
    what lets a 600-account import run unattended."""
    STUB.reset()
    crm_id, headers = panel()
    challenge = {'status': 'needs_2fa', 'otp_state': 'ST', 'x_bc': 'BC',
                 'x_hash': 'HS', 'cookies': {}, 'twofa_type': 'totp'}
    STUB.outcomes['auto@t.com'] = challenge
    STUB.outcomes['manual@t.com'] = challenge

    text = ('email,password,totp_secret\n'
            'auto@t.com,pw,JBSWY3DPEHPK3PXP\n'
            'manual@t.com,pw,\n')
    r = create_job(crm_id, headers, text)
    job_id = r.get_json()['job']['job_id']
    run_job(crm_id, job_id)

    states = {x['email']: x['status'] for x in raw_rows(job_id)}
    assert states['auto@t.com'] == 'success', states
    assert states['manual@t.com'] == 'needs_2fa', states

    # The worker generated a real 6-digit TOTP for the secret it was given.
    assert len(STUB.otp_calls) == 1, STUB.otp_calls
    email, code = STUB.otp_calls[0]
    assert email == 'auto@t.com', STUB.otp_calls
    assert code.isdigit() and len(code) == 6, code
    import pyotp
    assert code == pyotp.TOTP('JBSWY3DPEHPK3PXP').now(), code


@scenario
def s15_expiry_and_expired_retry_relogins_from_scratch():
    """needs_2fa -> needs_2fa_expired: the dead challenge is destroyed, the
    credential survives, and retry re-runs the login."""
    STUB.reset()
    crm_id, headers = panel()
    STUB.outcomes['exp@t.com'] = {'status': 'needs_2fa', 'otp_state': 'ST',
                                  'x_bc': 'BC', 'x_hash': 'HS',
                                  'cookies': {'sess': 'S'}, 'twofa_type': 'totp'}
    r = create_job(crm_id, headers, 'exp@t.com:pw-secret\n')
    job_id = r.get_json()['job']['job_id']
    run_job(crm_id, job_id)

    row = raw_rows(job_id)[0]
    assert row['status'] == 'needs_2fa', row['status']
    row_id = row['id']

    # Force the window shut and let the scheduler sweep run.
    db.update_import_row(row_id, two_fa_expires_at='2000-01-01T00:00:00+00:00')
    expired, scrubbed = import_runner.sweep_pending_2fa()
    assert expired == 1, (expired, scrubbed)

    row = raw_row(row_id)
    assert row['status'] == 'needs_2fa_expired', row['status']
    # Dead challenge material gone…
    assert row['otp_state'] is None and row['x_bc'] is None, row
    assert row['encrypted_2fa_cookies'] is None, row
    # …but the password survives, because the documented behaviour of retrying
    # an expired row is "re-run the login from scratch" and that needs it.
    assert row['encrypted_password'], 'expired row lost the credential it needs to retry'
    assert import_runner.remaining_seconds(row['two_fa_expires_at']) == 0

    # Submitting a code now is refused with a 409, not a 500.
    r = CLIENT.post(f'/api/crm/{crm_id}/import/jobs/{job_id}/rows/{row_id}/otp',
                    json={'code': '123456'}, headers=headers)
    assert r.status_code == 409, (r.status_code, r.get_json())

    # Retry re-queues it, and this time the platform lets it through.
    STUB.outcomes.pop('exp@t.com')
    r = CLIENT.post(f'/api/crm/{crm_id}/import/jobs/{job_id}/rows/{row_id}/retry',
                    headers=headers)
    assert r.status_code == 202, (r.status_code, r.get_json())
    assert raw_row(row_id)['status'] == 'pending', raw_row(row_id)
    run_job(crm_id, job_id)
    row = raw_row(row_id)
    assert row['status'] == 'success', row
    assert row['encrypted_password'] is None, 'terminal row kept its credential'


@scenario
def s16_credential_ttl_destroys_aged_out_parked_rows():
    """A password may not live in this file forever just because nobody typed
    a code. The parked state is bounded."""
    STUB.reset()
    crm_id, headers = panel()
    STUB.outcomes['ttl@t.com'] = {'status': 'needs_2fa', 'otp_state': 'ST',
                                  'x_bc': 'BC', 'x_hash': None, 'cookies': {},
                                  'twofa_type': 'totp'}
    r = create_job(crm_id, headers, 'ttl@t.com:pw\n')
    job_id = r.get_json()['job']['job_id']
    run_job(crm_id, job_id)
    row_id = raw_rows(job_id)[0]['id']
    assert raw_row(row_id)['encrypted_password'], raw_row(row_id)

    # Age the row past the hard TTL.
    conn = _conn()
    try:
        conn.execute("UPDATE import_job_rows SET created_at = '2000-01-01T00:00:00+00:00' "
                     'WHERE id = ?', (row_id,))
        conn.commit()
    finally:
        conn.close()

    _expired, scrubbed = import_runner.sweep_pending_2fa()
    assert scrubbed == 1, scrubbed
    row = raw_row(row_id)
    assert row['status'] == 'failed' and row['permanent'] == 1, row
    assert row['error_reason'] == 'credential_ttl', row
    for col in db._IMPORT_ROW_SECRET_COLUMNS:
        assert row[col] is None, col


@scenario
def s17_manual_otp_completes_a_parked_row():
    """The operator comes back after closing the importer and enters a code."""
    STUB.reset()
    crm_id, headers = panel()
    STUB.outcomes['otp@t.com'] = {'status': 'needs_2fa', 'otp_state': 'ST',
                                  'x_bc': 'BC', 'x_hash': 'HS',
                                  'cookies': {'sess': 'S'}, 'twofa_type': 'totp'}
    r = create_job(crm_id, headers, 'otp@t.com:pw\n')
    job_id = r.get_json()['job']['job_id']
    run_job(crm_id, job_id)
    row_id = raw_rows(job_id)[0]['id']

    # A malformed code is rejected before it costs a platform call.
    for bad in ('', 'ab', 'x' * 20, '12 34'):
        r = CLIENT.post(f'/api/crm/{crm_id}/import/jobs/{job_id}/rows/{row_id}/otp',
                        json={'code': bad}, headers=headers)
        assert r.status_code == 400, (bad, r.status_code)
    assert STUB.otp_calls == [], STUB.otp_calls

    r = CLIENT.post(f'/api/crm/{crm_id}/import/jobs/{job_id}/rows/{row_id}/otp',
                    json={'code': '654321'}, headers=headers)
    assert r.status_code == 200, (r.status_code, r.get_json())
    body = r.get_json()
    assert body['success'] is True, body
    assert body['row']['status'] == 'success', body['row']
    assert STUB.otp_calls == [('otp@t.com', '654321')], STUB.otp_calls
    # The parked challenge cookies really were handed to the verifier.
    assert raw_row(row_id)['encrypted_2fa_cookies'] is None, 'secrets not zeroed'
    # The badge is empty again.
    r = CLIENT.get(f'/api/crm/{crm_id}/import/pending-2fa', headers=headers)
    assert r.get_json()['count'] == 0, r.get_json()


@scenario
def s18_missing_verify_otp_parks_cleanly_never_500s():
    """login.verify_otp is being written by a concurrent change. Until it lands
    the attribute does not exist, and a bulk import must degrade, not explode."""
    import login as login_module
    STUB.reset()
    crm_id, headers = panel()
    STUB.outcomes['nover@t.com'] = {'status': 'needs_2fa', 'otp_state': 'ST',
                                    'x_bc': 'BC', 'x_hash': 'HS', 'cookies': {},
                                    'twofa_type': 'totp'}
    r = create_job(crm_id, headers, 'nover@t.com:pw\n')
    job_id = r.get_json()['job']['job_id']
    run_job(crm_id, job_id)
    row_id = raw_rows(job_id)[0]['id']

    # Swap the REAL implementation back in, against a login module that has no
    # verify_otp (which is the state of the tree today).
    had = hasattr(login_module, 'verify_otp')
    saved = getattr(login_module, 'verify_otp', None)
    if had:
        delattr(login_module, 'verify_otp')
    account_connect.of_verify_otp = REAL_OF_VERIFY_OTP
    try:
        assert getattr(login_module, 'verify_otp', None) is None, \
            'precondition: login.verify_otp must be absent'

        # Direct call: a clean parked result, no AttributeError.
        out = REAL_OF_VERIFY_OTP('nover@t.com', '123456', 'BC', 'HS', {})
        assert out['status'] == 'needs_2fa', out
        assert out['reason'] == 'verify_otp_unavailable', out

        # …and through the route: a 503 the UI can render, not a 500.
        r = CLIENT.post(f'/api/crm/{crm_id}/import/jobs/{job_id}/rows/{row_id}/otp',
                        json={'code': '123456'}, headers=headers)
        assert r.status_code == 503, (r.status_code, r.get_json())
        body = r.get_json()
        assert body['reason'] == 'verify_otp_unavailable', body
        assert body['status'] == 'needs_2fa', body
        # The row is untouched — still parked, still actionable once 2FA lands.
        assert raw_row(row_id)['status'] == 'needs_2fa', raw_row(row_id)
    finally:
        account_connect.of_verify_otp = STUB.of_verify_otp
        if had:
            setattr(login_module, 'verify_otp', saved)


@scenario
def s19_permanent_vs_transient_classification():
    """A misclassified permanent failure costs three more logins against an
    account OF already rejected. Both directions are asserted."""
    # The classifier itself, on real-world strings.
    reason, permanent, _msg = account_connect.classify_failure(
        Exception('Login failed: Wrong email or password'))
    assert permanent is True and reason == 'invalid_credentials', (reason, permanent)

    for transient in ('curl: (56) CONNECT tunnel failed, response 407',
                      'Failed to perform, curl: (28) Operation timed out',
                      'curl: (7) Failed to connect to proxy'):
        reason, permanent, _msg = account_connect.classify_failure(Exception(transient))
        assert permanent is False, (transient, reason, permanent)
        assert reason.startswith('proxy_'), (transient, reason)

    reason, _p, _m = account_connect.classify_failure(
        Exception('Login failed: enter your two-factor code'))
    assert reason == 'needs_2fa', reason

    # …and end to end: attempt counts are what actually cost money.
    STUB.reset()
    crm_id, headers = panel()
    STUB.outcomes['perm@t.com'] = {'status': 'failed', 'error': 'Wrong email or password',
                                   'reason': 'invalid_credentials', 'permanent': True}
    STUB.outcomes['trans@t.com'] = {'status': 'failed', 'error': 'proxy timed out',
                                    'reason': 'proxy_timeout', 'permanent': False}
    r = create_job(crm_id, headers, 'perm@t.com:pw\ntrans@t.com:pw\n')
    job_id = r.get_json()['job']['job_id']
    run_job(crm_id, job_id)

    rows = {x['email']: x for x in raw_rows(job_id)}
    assert rows['perm@t.com']['status'] == 'failed', rows['perm@t.com']
    assert rows['perm@t.com']['permanent'] == 1, rows['perm@t.com']
    assert rows['perm@t.com']['attempts'] == 1, \
        f"permanent failure was retried {rows['perm@t.com']['attempts']} times"

    assert rows['trans@t.com']['status'] == 'failed', rows['trans@t.com']
    assert rows['trans@t.com']['permanent'] == 0, rows['trans@t.com']
    assert rows['trans@t.com']['attempts'] == config.IMPORT_MAX_ATTEMPTS, \
        rows['trans@t.com']['attempts']

    perm_calls = [c for c in STUB.calls if c[1] == 'perm@t.com']
    trans_calls = [c for c in STUB.calls if c[1] == 'trans@t.com']
    assert len(perm_calls) == 1, f'permanent rejection cost {len(perm_calls)} logins'
    assert len(trans_calls) == config.IMPORT_MAX_ATTEMPTS, len(trans_calls)


@scenario
def s20_skip_and_cancel_states():
    """`skipped` and `canceled` are real terminal states, not dressed-up
    failures. (The hosted build also had `slot_exhausted`; there are no account
    slots in this build.)"""
    STUB.reset()
    crm_id, headers = panel()
    # Already connected -> skipped, and it costs ZERO logins.
    db.add_of_account(crm_id, '424242', 'dupe@t.com', username='dupe',
                      platform='onlyfans')
    r = create_job(crm_id, headers, 'dupe@t.com:pw\nfresh@t.com:pw\n')
    job_id = r.get_json()['job']['job_id']
    run_job(crm_id, job_id)
    rows = {x['email']: x for x in raw_rows(job_id)}
    assert rows['dupe@t.com']['status'] == 'skipped', rows['dupe@t.com']
    assert rows['dupe@t.com']['of_user_id'] == '424242', rows['dupe@t.com']
    assert not [c for c in STUB.calls if c[1] == 'dupe@t.com'], 'skipped row cost a login'
    assert rows['fresh@t.com']['status'] == 'success', rows['fresh@t.com']


    # Cancel before the worker starts -> every pending row canceled.
    STUB.reset()
    crm_id3, headers3 = panel()
    r = create_job(crm_id3, headers3, ''.join(f'c{i}@t.com:pw\n' for i in range(5)))
    job_id3 = r.get_json()['job']['job_id']
    r = CLIENT.post(f'/api/crm/{crm_id3}/import/jobs/{job_id3}/cancel', headers=headers3)
    assert r.status_code == 200, (r.status_code, r.get_json())
    assert r.get_json()['canceled_rows'] == 5, r.get_json()
    run_job(crm_id3, job_id3)
    assert STUB.calls == [], 'canceled job still made platform calls'
    for row in raw_rows(job_id3):
        assert row['status'] == 'canceled', row
        assert row['encrypted_password'] is None, row
    # Cancelling a finished job is a 409, not a silent no-op.
    r = CLIENT.post(f'/api/crm/{crm_id3}/import/jobs/{job_id3}/cancel', headers=headers3)
    assert r.status_code == 409, r.status_code


@scenario
def s21_two_lanes_and_batch_claiming():
    """Cookie rows and password rows run in separate pools, and the worker
    claims work rather than holding a list."""
    STUB.reset()
    crm_id, headers = panel()
    text = 'email,password,sess,auth_id\n'
    for i in range(8):
        text += f'p{i}@t.com,pw,,\n'
    for i in range(8):
        text += f',,SESS{i},{9000 + i}\n'
    r = create_job(crm_id, headers, text)
    body = r.get_json()
    assert body['lanes'] == {'password': 8, 'cookie': 8}, body['lanes']
    job_id = body['job']['job_id']

    # Claiming is a single UPDATE and hands back exactly what it took.
    claimed = db.claim_import_rows(job_id, 'cookie', 'tok-a', 3)
    assert len(claimed) == 3, len(claimed)
    assert all(c['lane'] == 'cookie' and c['status'] == 'running' for c in claimed), claimed
    # A second claimer gets a DISJOINT set — never the same rows.
    again = db.claim_import_rows(job_id, 'cookie', 'tok-b', 3)
    assert len(again) == 3, len(again)
    assert not ({c['id'] for c in claimed} & {c['id'] for c in again}), 'claims overlapped'
    # Claiming decrypts for the worker (and only for the worker).
    pw_claim = db.claim_import_rows(job_id, 'password', 'tok-c', 1)
    assert pw_claim[0]['password'] == 'pw', pw_claim[0].keys()
    assert 'encrypted_password' not in pw_claim[0], pw_claim[0].keys()

    # Put them all back and let the runner do the whole job.
    db.release_stale_import_rows(job_id)
    run_job(crm_id, job_id)
    counts = db.count_import_rows(job_id)
    assert counts['success'] == 16, counts
    lanes = [c[0] for c in STUB.calls]
    assert lanes.count('cookie') == 8 and lanes.count('password') == 8, lanes


@scenario
def s22_resume_after_a_simulated_restart():
    """An import that got half way through is RESUMED, not restarted — and no
    account is connected twice."""
    STUB.reset()
    crm_id, headers = panel()
    r = create_job(crm_id, headers, ''.join(f'r{i}@t.com:pw\n' for i in range(6)))
    job_id = r.get_json()['job']['job_id']

    # Simulate a process that got 2 rows done and died holding 2 more.
    db.update_import_job(job_id, status='running', started_at=db.iso_utc_now())
    claimed = db.claim_import_rows(job_id, 'password', 'dead-worker', 4)
    assert len(claimed) == 4, len(claimed)
    for row in claimed[:2]:
        import_runner._finish_row(row['id'], 'success', of_user_id=str(880000 + row['id']))
    # …the other two are left `running` with nothing behind them.
    mid = db.count_import_rows(job_id)
    assert mid == {**mid, 'success': 2, 'running': 2, 'pending': 2}, mid

    # Restart. Other scenarios leave their own unrun jobs behind, so assert on
    # OUR job rather than on the global count.
    _dispatched.clear()
    resumed = import_runner.reconcile_stale_imports(dispatch=True)
    assert resumed >= 1, resumed
    ours = [(fn, args) for fn, args in _dispatched if args == (crm_id, job_id)]
    assert len(ours) == 1, (ours, _dispatched)
    assert ours[0][0] is import_runner.run_import, ours[0]

    after = db.count_import_rows(job_id)
    assert after['running'] == 0, after
    assert after['pending'] == 4, after     # the 2 orphans went back on the queue
    assert after['success'] == 2, after     # …and the finished ones were not touched
    assert db.get_import_job(crm_id, job_id)['status'] == 'queued'

    run_job(crm_id, job_id)
    counts = db.count_import_rows(job_id)
    assert counts['success'] == 6, counts
    assert db.get_import_job(crm_id, job_id)['status'] == 'complete'

    # The two rows that had already succeeded were never re-attempted, so no
    # account was connected twice.
    attempted = [c[1] for c in STUB.calls]
    assert len(attempted) == len(set(attempted)) == 4, attempted

    # A job whose rows all finished before the restart is simply closed out.
    r = create_job(crm_id, headers, 'done@t.com:pw\n')
    job2 = r.get_json()['job']['job_id']
    run_job(crm_id, job2)
    db.update_import_job(job2, status='running', completed_at=None)
    import_runner.reconcile_stale_imports(dispatch=False)
    assert db.get_import_job(crm_id, job2)['status'] == 'complete'


@scenario
def s23_resume_gives_up_on_a_poison_row():
    """A row that kills the worker every time must not resurrect itself
    forever — otherwise one bad row is an infinite restart loop."""
    STUB.reset()
    crm_id, headers = panel()
    r = create_job(crm_id, headers, 'poison@t.com:pw\n')
    job_id = r.get_json()['job']['job_id']

    for n in range(config.IMPORT_MAX_ATTEMPTS):
        claimed = db.claim_import_rows(job_id, 'password', f'crash{n}', 5)
        assert len(claimed) == 1, (n, claimed)
        requeued, exhausted = db.release_stale_import_rows(job_id)
        if n < config.IMPORT_MAX_ATTEMPTS - 1:
            assert (requeued, exhausted) == (1, 0), (n, requeued, exhausted)
        else:
            assert exhausted == 1, (n, requeued, exhausted)

    row = raw_rows(job_id)[0]
    assert row['status'] == 'failed', row
    assert row['error_reason'] == 'attempts_exhausted', row
    assert row['encrypted_password'] is None, 'exhausted row kept its credential'


# ===========================================================================
# 5. HTTP surface
# ===========================================================================

@scenario
def s24_tenant_isolation():
    """A job_id alone never crosses tenants — the crm_id filter IS the
    access-control boundary, exactly as it is for exports."""
    STUB.reset()
    crm_a, head_a = panel()
    crm_b, head_b = panel()

    r = create_job(crm_a, head_a, 'iso@t.com:pw\n')
    job_id = r.get_json()['job']['job_id']
    run_job(crm_a, job_id)
    row_id = raw_rows(job_id)[0]['id']

    # B cannot read, cancel, retry or OTP A's job even knowing its id.
    assert CLIENT.get(f'/api/crm/{crm_b}/import/jobs/{job_id}',
                      headers=head_b).status_code == 404
    assert CLIENT.post(f'/api/crm/{crm_b}/import/jobs/{job_id}/cancel',
                       headers=head_b).status_code == 404
    assert CLIENT.post(f'/api/crm/{crm_b}/import/jobs/{job_id}/rows/{row_id}/retry',
                       headers=head_b).status_code == 404
    assert CLIENT.post(f'/api/crm/{crm_b}/import/jobs/{job_id}/rows/{row_id}/otp',
                       json={'code': '123456'}, headers=head_b).status_code == 404

    # B's own listings are empty; A's are not.
    assert CLIENT.get(f'/api/crm/{crm_b}/import/jobs', headers=head_b
                      ).get_json()['total'] == 0
    assert CLIENT.get(f'/api/crm/{crm_a}/import/jobs', headers=head_a
                      ).get_json()['total'] >= 1

    # A's key against B's URL is rejected by verify_api_key, not by luck.
    assert CLIENT.get(f'/api/crm/{crm_b}/import/jobs', headers=head_a
                      ).status_code in (401, 403)
    # And no key at all is a 401 on every route.
    for path, method in (
            (f'/api/crm/{crm_a}/import/preview', 'post'),
            (f'/api/crm/{crm_a}/import/jobs', 'post'),
            (f'/api/crm/{crm_a}/import/jobs', 'get'),
            (f'/api/crm/{crm_a}/import/jobs/{job_id}', 'get'),
            (f'/api/crm/{crm_a}/import/jobs/{job_id}/cancel', 'post'),
            (f'/api/crm/{crm_a}/import/pending-2fa', 'get'),
            (f'/api/crm/{crm_a}/import/jobs/{job_id}/rows/{row_id}/otp', 'post'),
            (f'/api/crm/{crm_a}/import/jobs/{job_id}/rows/{row_id}/retry', 'post')):
        resp = getattr(CLIENT, method)(path, json={'text': 'a@b.com:pw', 'code': '123456'})
        assert resp.status_code == 401, (path, resp.status_code)

    # pending-2fa is panel-scoped too.
    STUB.outcomes['park@t.com'] = {'status': 'needs_2fa', 'otp_state': 'S',
                                   'x_bc': 'B', 'x_hash': None, 'cookies': {},
                                   'twofa_type': 'totp'}
    r = create_job(crm_a, head_a, 'park@t.com:pw\n')
    run_job(crm_a, r.get_json()['job']['job_id'])
    assert CLIENT.get(f'/api/crm/{crm_a}/import/pending-2fa',
                      headers=head_a).get_json()['count'] == 1
    assert CLIENT.get(f'/api/crm/{crm_b}/import/pending-2fa',
                      headers=head_b).get_json()['count'] == 0


@scenario
def s25_job_detail_listing_and_validation():
    """The GET routes' contract: job + counts + rows, filterable, and a bad
    filter is a 400 rather than a silently empty list."""
    STUB.reset()
    crm_id, headers = panel()
    STUB.outcomes['bad@t.com'] = {'status': 'failed', 'error': 'Wrong email or password',
                                  'reason': 'invalid_credentials', 'permanent': True}
    text = 'good@t.com:pw\nbad@t.com:pw\nnot-an-email\n'
    r = create_job(crm_id, headers, text)
    body = r.get_json()
    assert body['warning'] and '1 row' in body['warning'], body
    job_id = body['job']['job_id']
    run_job(crm_id, job_id)

    r = CLIENT.get(f'/api/crm/{crm_id}/import/jobs/{job_id}', headers=headers)
    assert r.status_code == 200, r.status_code
    body = r.get_json()
    assert body['job']['status'] == 'complete', body['job']
    assert body['job']['total_rows'] == 3, body['job']
    assert body['counts']['success'] == 1, body['counts']
    assert body['counts']['failed'] == 1, body['counts']
    assert body['counts']['invalid'] == 1, body['counts']
    assert body['counts']['total'] == 3 and body['counts']['done'] == 3, body['counts']
    assert body['total'] == 3 and len(body['rows']) == 3, body
    assert body['row_states'] == list(db.ROW_STATES), body['row_states']

    # Row shape the UI binds to.
    row = body['rows'][0]
    for key in ('id', 'row_index', 'source_line', 'lane', 'platform', 'email',
                'status', 'attempts', 'error', 'error_reason', 'permanent',
                'of_user_id', 'username', 'has_password', 'has_totp_secret',
                'two_fa_remaining_seconds'):
        assert key in row, (key, sorted(row))
    # …and nothing internal or secret rides along.
    for key in ('encrypted_password', 'encrypted_totp_secret', 'encrypted_cookies',
                'encrypted_2fa_cookies', 'otp_state', 'x_bc', 'x_hash',
                'claim_token', 'password', 'totp_secret', 'cookies'):
        assert key not in row, f'{key} leaked into the API response'

    r = CLIENT.get(f'/api/crm/{crm_id}/import/jobs/{job_id}?status=failed',
                   headers=headers)
    assert r.get_json()['total'] == 1, r.get_json()
    r = CLIENT.get(f'/api/crm/{crm_id}/import/jobs/{job_id}?status=nonsense',
                   headers=headers)
    assert r.status_code == 400, r.status_code
    assert CLIENT.get(f'/api/crm/{crm_id}/import/jobs/deadbeef',
                      headers=headers).status_code == 404

    # List view carries counts per job.
    r = CLIENT.get(f'/api/crm/{crm_id}/import/jobs', headers=headers)
    listed = r.get_json()['jobs'][0]
    assert listed['job_id'] == job_id, listed
    assert listed['counts']['success'] == 1, listed['counts']


@scenario
def s26_create_rejects_a_paste_with_nothing_usable():
    """Zero valid rows is a 400 with the reasons, not a job that is 100%
    `invalid` and looks like a backend bug."""
    crm_id, headers = panel()
    before = table_counts()
    r = create_job(crm_id, headers, 'garbage\nmore garbage\n')
    assert r.status_code == 400, (r.status_code, r.get_json())
    body = r.get_json()
    assert body['success'] is False and body['invalid_count'] == 2, body
    assert body['rows'][0]['errors'], body['rows'][0]
    assert table_counts() == before, 'a rejected create still wrote rows'

    # Missing text, and a bad default_platform.
    assert CLIENT.post(f'/api/crm/{crm_id}/import/jobs', json={},
                       headers=headers).status_code == 400
    assert CLIENT.post(f'/api/crm/{crm_id}/import/jobs',
                       json={'text': 'a@b.com:pw', 'default_platform': 'mastodon'},
                       headers=headers).status_code == 400


@scenario
def s27_default_platform_applies_to_rows_without_one():
    STUB.reset()
    crm_id, headers = panel()
    r = CLIENT.post(f'/api/crm/{crm_id}/import/preview',
                    json={'text': 'a@b.com:pw\nc@d.com:pw\n',
                          'default_platform': 'fansly'}, headers=headers)
    body = r.get_json()
    assert body['platforms'] == {'fansly': 2}, body['platforms']
    # An explicit per-row platform still wins over the default.
    r = CLIENT.post(f'/api/crm/{crm_id}/import/preview',
                    json={'text': 'email,password,platform\na@b.com,pw,of\n',
                          'default_platform': 'fansly'}, headers=headers)
    assert r.get_json()['platforms'] == {'onlyfans': 1}, r.get_json()['platforms']


# ===========================================================================
# 6. SSE + scheduler wiring
# ===========================================================================

@scenario
def s28_progress_is_coalesced_not_per_row():
    """sse_hub queues are maxsize=200 and DROP on overflow. 600 per-row events
    would evict exactly the ones the UI is waiting for."""
    STUB.reset()
    crm_id, headers = panel()
    q = hub.subscribe(crm_id)
    try:
        n = 60
        r = create_job(crm_id, headers, ''.join(f'sse{i}@t.com:pw\n' for i in range(n)))
        job_id = r.get_json()['job']['job_id']
        run_job(crm_id, job_id)

        events = []
        while True:
            try:
                events.append(q.get_nowait())
            except queue.Empty:
                break
    finally:
        hub.unsubscribe(crm_id, q)

    progress = [e for e in events if e['event_type'] == 'import.progress']
    complete = [e for e in events if e['event_type'] == 'import.complete']
    assert len(complete) == 1, len(complete)
    assert len(progress) < n, f'{len(progress)} progress events for {n} rows — not coalesced'
    assert len(events) < 200, f'{len(events)} events would overflow the SSE queue'

    final = complete[0]['payload']
    assert final['status'] == 'complete', final
    assert final['counts']['success'] == n, final['counts']
    assert final['job_id'] == job_id, final
    # Each frame carries a bounded tail of recent transitions, never the lot.
    for e in progress + complete:
        assert len(e['payload']['recent']) <= config.IMPORT_PROGRESS_TAIL, \
            len(e['payload']['recent'])
        # Counts are a full snapshot, so a client that missed a frame recovers.
        assert 'counts' in e['payload'] and 'total' in e['payload']['counts']


@scenario
def s29_internal_event_types_are_streamable_but_not_webhookable():
    """import.* must be subscribable over SSE without becoming a legal webhook
    subscription or automation trigger."""
    crm_id, headers = panel()
    for t in ('import.progress', 'import.complete', 'export.progress',
              'refresh.progress'):
        assert t in crm_api.STREAMABLE_EVENT_TYPES, t
        assert t not in crm_api.ALLOWED_EVENT_TYPES, f'{t} leaked into the webhook list'

    # A webhook may not subscribe to one.
    r = CLIENT.post(f'/api/crm/{crm_id}/webhooks',
                    json={'url': 'https://example.com/hook',
                          'event_types': ['import.progress']}, headers=headers)
    assert r.status_code == 400, (r.status_code, r.get_json())
    assert 'import.progress' in r.get_json()['error'], r.get_json()

    # But the SSE filter accepts it (previously a 400, which left "everything
    # or nothing" as the only options).
    r = CLIENT.get(f'/api/crm/{crm_id}/events/stream?types=import.progress',
                   headers=headers)
    assert r.status_code == 200, r.status_code
    r.close()
    r = CLIENT.get(f'/api/crm/{crm_id}/events/stream?types=not.a.type',
                   headers=headers)
    assert r.status_code == 400, r.status_code


@scenario
def s30_scheduler_wiring():
    """The two scheduler hooks this feature depends on must actually exist:
    the startup resume and the 2FA expiry sweep."""
    assert hasattr(scheduler_mod, '_run_import_2fa_sweep'), 'sweep job function missing'
    assert scheduler_mod.IMPORT_2FA_SWEEP_JOB_ID == 'internal.import_2fa_sweep'
    # The sweep must run several times inside one 2FA window or the countdown
    # the UI renders would outlive the row it describes.
    assert scheduler_mod.IMPORT_2FA_SWEEP_SECONDS < config.TWO_FA_SESSION_EXPIRY / 5, \
        scheduler_mod.IMPORT_2FA_SWEEP_SECONDS
    ex, grace = scheduler_mod._desired_job_policy(scheduler_mod.IMPORT_2FA_SWEEP_JOB_ID)
    assert ex == 'default', ex
    assert grace >= scheduler_mod.IMPORT_2FA_SWEEP_SECONDS, grace
    # Module-level (picklable by the SQLAlchemy jobstore).
    assert scheduler_mod._run_import_2fa_sweep.__module__ == 'scheduler'
    assert import_runner.run_import.__module__ == 'import_runner'
    # And it is dispatched as ONE background job, never one per row.
    _dispatched.clear()
    STUB.reset()
    crm_id, headers = panel()
    create_job(crm_id, headers, ''.join(f'sch{i}@t.com:pw\n' for i in range(20)))
    assert len(_dispatched) == 1, f'{len(_dispatched)} scheduler jobs for one import'


@scenario
def s31_polling_is_not_auto_enabled():
    """Importing 600 accounts must register ZERO poll jobs. Flipping polling
    off->on triggers a 7-day backfill pinned to the 16-worker heavy pool; 600
    of those would starve every other job on the box."""
    STUB.reset()
    crm_id, headers = panel()
    r = create_job(crm_id, headers, ''.join(f'poll{i}@t.com:pw\n' for i in range(5)))
    run_job(crm_id, r.get_json()['job']['job_id'])
    accounts = db.get_of_accounts(crm_id)
    assert len(accounts) == 5, len(accounts)
    for a in accounts:
        assert not a.get('polling_enabled'), f"{a['of_user_id']} came out polling"


@scenario
def s32_throttles_behave():
    """The token bucket and the per-proxy gate are the difference between a
    bulk import and something that looks like credential stuffing."""
    # Bucket: capacity is one minute of tokens, and it refuses to over-issue.
    bucket = import_runner.TokenBucket(60, capacity=3)
    assert all(bucket.acquire(timeout=0.1) for _ in range(3))
    assert bucket.acquire(timeout=0.05) is False, 'bucket issued a token it did not have'

    # Proxy grouping ignores credentials — two rows through one gateway with
    # different logins still share an egress IP, and so must serialize.
    assert import_runner.proxy_key('http://u1:p1@gw.example:8080') == 'gw.example:8080'
    assert import_runner.proxy_key('http://u2:p2@gw.example:8080') == 'gw.example:8080'
    assert import_runner.proxy_key('socks5://gw.example:1080') == 'gw.example:1080'
    assert import_runner.proxy_key(None) == ':direct'
    assert import_runner.proxy_key('') == ':direct'

    gate = import_runner.HostGate(1)
    g1 = gate.gate('a:1')
    assert gate.gate('a:1') is g1, 'gate registry handed back a different semaphore'
    assert gate.gate('b:1') is not g1
    assert g1.acquire(blocking=False) is True
    assert g1.acquire(blocking=False) is False, 'per-proxy gate allowed 2 at once'
    g1.release()


@scenario
def s33_account_scoped_purge_scrubs_import_rows():
    """import_job_rows carries an of_user_id, so it must be reachable from
    delete_of_account. It SCRUBS rather than deletes — see the comment on the
    rule in _ACCOUNT_SCOPED_PURGES."""
    covered = {t for t, _ in db._ACCOUNT_SCOPED_PURGES}
    assert 'import_job_rows' in covered, sorted(covered)

    STUB.reset()
    crm_id, headers = panel()
    r = create_job(crm_id, headers, 'purge@t.com:pw\n')
    job_id = r.get_json()['job']['job_id']
    run_job(crm_id, job_id)
    row = raw_rows(job_id)[0]
    assert row['status'] == 'success' and row['of_user_id'], row
    of_user_id = row['of_user_id']

    db.delete_of_account(crm_id, of_user_id, purge_now=True)

    scrubbed = raw_row(row['id'])
    assert scrubbed is not None, 'the audit row was deleted, not scrubbed'
    assert scrubbed['status'] == 'success', scrubbed   # the job history still adds up
    assert scrubbed['of_user_id'] is None, scrubbed
    assert scrubbed['email'] is None and scrubbed['username'] is None, scrubbed
    # …and it is invisible to every (crm_id, of_user_id) read, which is what the
    # schema-drift guard in test_account_deletion.py counts.
    conn = _conn()
    try:
        n = conn.execute('SELECT COUNT(*) FROM import_job_rows '
                         'WHERE crm_id = ? AND of_user_id = ?',
                         (crm_id, of_user_id)).fetchone()[0]
    finally:
        conn.close()
    assert n == 0, n
    # The job itself survives — it is panel-scoped, not account-scoped.
    assert db.get_import_job(crm_id, job_id) is not None


def main():
    print('\nParser — paste formats')
    s01_bare_email_password()
    s02_headerless_positional()
    s03_all_delimiters_and_aliases()
    s04_cookie_mode_rows()
    s05_hygiene_bom_quotes_comments_blanks()
    s06_malformed_rows_become_invalid_not_fatal()
    s07_limits_reject_they_do_not_truncate()
    s08_credential_password_bounds_only()

    print('\nPreview — no side effects')
    s09_preview_writes_nothing()
    s10_preview_applies_the_ssrf_guard()

    print('\nCredential lifetime')
    s11_secrets_are_encrypted_at_rest()
    s12_secrets_zeroed_at_terminal_state()

    print('\nRunner — 2FA, classification, states')
    s13_needs_2fa_does_not_block_the_others()
    s14_totp_secret_auto_generates_and_never_parks()
    s15_expiry_and_expired_retry_relogins_from_scratch()
    s16_credential_ttl_destroys_aged_out_parked_rows()
    s17_manual_otp_completes_a_parked_row()
    s18_missing_verify_otp_parks_cleanly_never_500s()
    s19_permanent_vs_transient_classification()
    s20_skip_and_cancel_states()

    print('\nRunner — lanes + resume')
    s21_two_lanes_and_batch_claiming()
    s22_resume_after_a_simulated_restart()
    s23_resume_gives_up_on_a_poison_row()

    print('\nHTTP surface')
    s24_tenant_isolation()
    s25_job_detail_listing_and_validation()
    s26_create_rejects_a_paste_with_nothing_usable()
    s27_default_platform_applies_to_rows_without_one()

    print('\nSSE + scheduler wiring')
    s28_progress_is_coalesced_not_per_row()
    s29_internal_event_types_are_streamable_but_not_webhookable()
    s30_scheduler_wiring()
    s31_polling_is_not_auto_enabled()
    s32_throttles_behave()
    s33_account_scoped_purge_scrubs_import_rows()

    print()
    if _failures:
        print(f'FAILED: {len(_failures)}')
        for n, d in _failures:
            print(f'  - {n}: {d}')
        sys.exit(1)
    print('All bulk-import tests passed.')


if __name__ == '__main__':
    main()
