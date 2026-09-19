#!/usr/bin/env python3
"""Forgiving parser for bulk account-import pastes.

The operator pastes whatever they have: a spreadsheet column selection, a
`.csv` a client emailed, a block of `email:password` lines from a chat message.
Refusing any of those is refusing the feature, so this module auto-detects the
shape instead of demanding one.

What it accepts
---------------
  * Delimited text — `,` `;` TAB `|` (auto-detected, whole-document)
  * Bare `email:password`, one per line (how these lists actually circulate)
  * Header row optional; without one the positional order is
    ``email, password, platform, proxy, totp_secret``
  * Column names case/underscore/space/hyphen-insensitive, with aliases
  * BOM (`utf-8-sig`), surrounding quotes, blank lines, `#` comments

What it guarantees
------------------
  * **Zero side effects.** Nothing here touches the DB, the network, or disk.
    ``POST /import/preview`` is this function and nothing else, which is what
    lets the UI show the operator exactly what will happen before it happens.
  * **One bad row never kills the batch.** A row that fails validation comes
    back ``valid=False`` with its own error list and a ``row_index``; the
    caller stores it as ``invalid`` and keeps going.
  * **Limits reject, never truncate.** Over 1000 rows or 2 MiB raises
    ``ImportLimitError``. Silently dropping row 1001 is how an operator ends up
    believing 1200 creators are connected when 200 were never attempted.

Validators are INJECTED (``proxy_validator``) rather than imported, so this
module stays free of any dependency on ``crm_api`` — the worker, the routes and
the tests all import it, and a cycle through the Flask app would be fatal to
two of the three.
"""

from __future__ import annotations

import csv
import io
import re
from collections import Counter

import config

# Candidate delimiters, in tie-break preference order.
DELIMITERS = (',', ';', '\t', '|')

# Positional order when there is no header row. Documented in the API contract;
# changing it silently re-maps every headerless paste.
POSITIONAL_FIELDS = ('email', 'password', 'platform', 'proxy', 'totp_secret')

PLATFORMS = ('onlyfans', 'fansly')
# Accepted spellings for the platform cell.
_PLATFORM_ALIASES = {
    'onlyfans': 'onlyfans', 'of': 'onlyfans', 'only fans': 'onlyfans',
    'fansly': 'fansly', 'fn': 'fansly',
}

# Normalized column name -> canonical field. Normalization collapses case and
# strips `_`, `-` and spaces, so `TOTP Secret`, `totp_secret` and `totp-secret`
# are one key.
_COLUMN_ALIASES = {
    # identity
    'email': 'email', 'login': 'email', 'user': 'email',
    'username': 'email', 'mail': 'email',
    # secret
    'password': 'password', 'pass': 'password', 'pwd': 'password',
    'haslo': 'password',
    # platform
    'platform': 'platform', 'site': 'platform',
    # transport
    'proxy': 'proxy',
    # TOTP
    'totpsecret': 'totp_secret', 'totp': 'totp_secret', '2fa': 'totp_secret',
    '2fasecret': 'totp_secret', 'otpsecret': 'totp_secret',
    'secret': 'totp_secret',
    # cookie / token mode
    'sess': 'sess', 'authid': 'auth_id', 'userid': 'auth_id', 'fp': 'fp',
    'authtoken': 'auth_token',
    # cosmetic
    'label': 'label', 'name': 'label', 'note': 'label',
}

# Fields whose presence flips a row into the cheap "cookie" lane.
_OF_COOKIE_FIELDS = ('sess', 'auth_id', 'fp')
_FANSLY_COOKIE_FIELDS = ('auth_token',)

_EMAIL_RE = re.compile(r'^[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}$')

# A bare `email:password` line. The address half must contain NO delimiter
# character and no colon, so `a@b.com,pw,of,http://u:p@h:1` (a CSV row that
# happens to hold a proxy URL) cannot masquerade as one.
_BARE_RE = re.compile(r'^[^,;|\t:\s]+@[^,;|\t:\s]+\.[A-Za-z]{2,}\s*:\s*\S.*$')

# Fraction of data lines that must look bare before the whole document is read
# in bare mode. Below it, delimiter detection runs and non-conforming lines
# become `invalid` rows instead of silently re-interpreting the file.
_BARE_THRESHOLD = 0.6


class ImportParseError(Exception):
    """Input could not be parsed at all (empty, undecodable)."""


class ImportLimitError(ImportParseError):
    """Input exceeded IMPORT_MAX_ROWS / IMPORT_MAX_BYTES. Rejected, not cut."""


# ---------------------------------------------------------------------------
# Credential validation
# ---------------------------------------------------------------------------

def check_credential_password(password):
    """Bounds check for a password we PASS THROUGH to the platform.

    Returns an error string, or None when acceptable.

    This is deliberately NOT ``crm_api.validate_password``. That one enforces
    >= 8 chars and rejects a list of common passwords, which is right for a
    password we are SETTING on our own system and wrong — actively harmful —
    for somebody else's existing OnlyFans credential. A creator whose password
    is `hunter2` or `password123` still has a real account; refusing to import
    it does not improve anyone's security, it just loses the row.
    """
    if password is None or not isinstance(password, str):
        return 'password is required'
    if len(password) < config.IMPORT_PASSWORD_MIN:
        return 'password is empty'
    if len(password) > config.IMPORT_PASSWORD_MAX:
        return f'password too long (max {config.IMPORT_PASSWORD_MAX} characters)'
    return None


# ---------------------------------------------------------------------------
# Text preparation
# ---------------------------------------------------------------------------

def _decode(raw):
    """Bytes/str -> str with the BOM gone and line endings normalized."""
    if isinstance(raw, bytes):
        try:
            text = raw.decode('utf-8-sig')
        except UnicodeDecodeError:
            # Spreadsheets exported on Windows are frequently cp1252. Losing the
            # whole paste over one smart quote in a label is not acceptable.
            text = raw.decode('cp1252', errors='replace')
    elif isinstance(raw, str):
        text = raw
    else:
        raise ImportParseError('input must be text')
    if text.startswith('\ufeff'):
        text = text[1:]
    return text.replace('\r\n', '\n').replace('\r', '\n')


def _strip_cell(value):
    """Trim whitespace and one layer of matching surrounding quotes."""
    if value is None:
        return None
    s = str(value).strip()
    if len(s) >= 2 and s[0] == s[-1] and s[0] in ('"', "'"):
        s = s[1:-1].strip()
    return s


def _data_lines(text):
    """(line_text, source_line_number) for every line that carries data.

    Blank lines and `#` comments are dropped here so neither delimiter
    detection nor row numbering ever sees them — but the original 1-based line
    number rides along, because "row 14 is malformed" has to point at the line
    the operator can actually see in their paste.
    """
    out = []
    for n, line in enumerate(text.split('\n'), start=1):
        stripped = line.strip()
        if not stripped or stripped.startswith('#'):
            continue
        out.append((line, n))
    return out


def _normalize_key(name):
    """Column name -> alias-lookup key: lowercase, no `_`, `-`, or spaces."""
    return re.sub(r'[\s_\-]+', '', str(name or '').strip().lower())


# ---------------------------------------------------------------------------
# Shape detection
# ---------------------------------------------------------------------------

def _looks_bare(lines):
    """True when the document is a list of `email:password` lines."""
    if not lines:
        return False
    hits = sum(1 for text, _n in lines if _BARE_RE.match(text.strip()))
    return (hits / len(lines)) >= _BARE_THRESHOLD


def detect_delimiter(lines):
    """Pick the delimiter for a delimited document, or None if there is none.

    Scored on (a) how many lines contain the character and (b) how consistent
    the resulting field count is — a delimiter that yields 4 fields on every
    line beats one that appears once inside a single password.
    """
    best = None
    best_score = None
    for d in DELIMITERS:
        counts = [text.count(d) for text, _n in lines]
        present = sum(1 for c in counts if c > 0)
        if not present:
            continue
        modal_count, modal_lines = Counter(counts).most_common(1)[0]
        score = (present, modal_lines, modal_count)
        if best_score is None or score > best_score:
            best, best_score = d, score
    return best


def _split_delimited(lines, delimiter):
    """csv.reader per line, so quoted cells containing the delimiter survive."""
    rows = []
    for text, n in lines:
        try:
            cells = next(csv.reader(io.StringIO(text), delimiter=delimiter))
        except (csv.Error, StopIteration):
            cells = text.split(delimiter)
        rows.append(([_strip_cell(c) for c in cells], n))
    return rows


def _detect_header(cells):
    """True when the first row names columns rather than holding data.

    Two signals, both required: at least one cell is a known column alias, and
    no cell contains `@`. An address in row 1 means row 1 is data, whatever it
    is called.
    """
    if not cells:
        return False
    if any('@' in (c or '') for c in cells):
        return False
    return any(_normalize_key(c) in _COLUMN_ALIASES for c in cells if c)


# ---------------------------------------------------------------------------
# Row assembly
# ---------------------------------------------------------------------------

def _blank_row(row_index, line_no):
    return {
        'row_index': row_index,
        'line': line_no,
        'email': None,
        'password': None,
        # None, not 'onlyfans' — _finalize distinguishes "the row named a
        # platform" from "the row said nothing, use the job default". Seeding
        # this with a value made every row look explicit and silently ignored
        # the caller's default_platform.
        'platform': None,
        'proxy': None,
        'totp_secret': None,
        'label': None,
        'cookies': None,
        'lane': 'password',
        'valid': True,
        'errors': [],
    }


def _assign(row, field, value):
    """Place one parsed cell onto the row dict, cookie fields nested."""
    if value in (None, ''):
        return
    if field in ('sess', 'auth_id', 'fp', 'auth_token'):
        row.setdefault('_cookies', {})[field] = value
        return
    row[field] = value


def _finalize(row, default_platform, proxy_validator):
    """Normalize + validate one assembled row in place. Never raises."""
    errors = row['errors']

    # ---- platform -------------------------------------------------------
    raw_platform = (row.get('platform') or '').strip().lower()
    if raw_platform:
        resolved = _PLATFORM_ALIASES.get(raw_platform)
        if resolved is None:
            errors.append(f"unknown platform '{raw_platform}' "
                          f"(expected one of {', '.join(PLATFORMS)})")
            resolved = default_platform
        row['platform'] = resolved
    else:
        row['platform'] = default_platform

    # ---- lane -----------------------------------------------------------
    # Lane is chosen on INTENT, not on completeness. A row carrying `sess` but
    # no `auth_id` is obviously a cookie row the operator got wrong, and
    # telling them "password is required" would send them off to find a
    # password they never meant to supply. `fp` alone does not count as intent
    # — it is an optional extra, not an identifier.
    cookies = row.pop('_cookies', None) or None
    row['cookies'] = cookies
    if row['platform'] == 'fansly':
        cookie_intent = bool(cookies and cookies.get('auth_token'))
    else:
        cookie_intent = bool(cookies and (cookies.get('sess') or cookies.get('auth_id')))
    row['lane'] = 'cookie' if cookie_intent else 'password'

    # ---- identity -------------------------------------------------------
    email = row.get('email')
    if email:
        email = email.strip()
        # Fansly's login field accepts a username OR an email, and an OF cookie
        # row may legitimately carry no address at all (the /users/me call
        # resolves it). Only an OF password login truly needs a valid address.
        if row['platform'] == 'onlyfans' and row['lane'] == 'password':
            if not _EMAIL_RE.match(email):
                errors.append(f"'{email}' is not a valid email address")
            else:
                email = email.lower()
        row['email'] = email

    # ---- lane-specific requirements -------------------------------------
    if row['lane'] == 'cookie':
        if row['platform'] == 'fansly':
            if not (cookies or {}).get('auth_token'):
                errors.append('auth_token is required for a Fansly token row')
        else:
            missing = [f for f in ('sess', 'auth_id') if not (cookies or {}).get(f)]
            if missing:
                errors.append(f"cookie row is missing {', '.join(missing)}")
        # A password on a cookie row is dead weight we would be storing for
        # nothing. Drop it rather than encrypt-and-keep somebody's secret that
        # no code path will ever use.
        row['password'] = None
    else:
        if not email:
            errors.append('email is required')
        pw_error = check_credential_password(row.get('password'))
        if pw_error:
            errors.append(pw_error)

    # ---- proxy ----------------------------------------------------------
    proxy = row.get('proxy')
    if proxy:
        if proxy_validator is not None:
            try:
                row['proxy'] = proxy_validator(proxy)
            except Exception as e:
                errors.append(f'invalid proxy: {e}')
                row['proxy'] = None
        else:
            row['proxy'] = proxy.strip()

    # ---- TOTP -----------------------------------------------------------
    secret = row.get('totp_secret')
    if secret:
        # Base32, case-insensitive, spaces allowed (that is how authenticator
        # apps display it). Validated here so a typo surfaces in /preview and
        # not 30 minutes into the run.
        cleaned = re.sub(r'\s+', '', secret).upper()
        if not re.fullmatch(r'[A-Z2-7]+=*', cleaned) or len(cleaned) < 8:
            errors.append('totp_secret is not a valid base32 secret')
            row['totp_secret'] = None
        else:
            row['totp_secret'] = cleaned

    row['valid'] = not errors
    return row


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def parse(raw, *, default_platform='onlyfans', proxy_validator=None,
          max_rows=None, max_bytes=None):
    """Parse a paste into normalized rows. Pure — no DB, no network, no disk.

    Returns::

        {
          'rows':        [ {row_index, line, email, password, platform, proxy,
                            totp_secret, label, cookies, lane, valid, errors}, ...],
          'format':      'bare' | 'delimited',
          'delimiter':   ',' | ';' | '\\t' | '|' | ':' (bare) | None,
          'has_header':  bool,
          'columns':     [canonical field per column]  (delimited only),
          'total':       len(rows),
          'valid_count': int,
          'invalid_count': int,
        }

    Raises ``ImportLimitError`` when the input is over the row/byte cap and
    ``ImportParseError`` when there is nothing parseable at all.
    """
    max_rows = max_rows or config.IMPORT_MAX_ROWS
    max_bytes = max_bytes or config.IMPORT_MAX_BYTES

    size = len(raw if isinstance(raw, bytes) else str(raw).encode('utf-8'))
    if size > max_bytes:
        raise ImportLimitError(
            f'Input is {size} bytes; the limit is {max_bytes} bytes '
            f'({max_bytes // (1024 * 1024)} MiB). Split the list and import it '
            f'in parts — nothing was imported.')

    text = _decode(raw)
    lines = _data_lines(text)
    if not lines:
        raise ImportParseError('No rows found — the input is empty or only comments.')

    bare = _looks_bare(lines)
    delimiter = None if bare else detect_delimiter(lines)

    # ---- header + column mapping ---------------------------------------
    has_header = False
    columns = []
    if bare:
        body = lines
    elif delimiter:
        split = _split_delimited(lines, delimiter)
        first_cells = split[0][0]
        has_header = _detect_header(first_cells)
        if has_header:
            columns = [_COLUMN_ALIASES.get(_normalize_key(c)) for c in first_cells]
            body = split[1:]
        else:
            columns = list(POSITIONAL_FIELDS)
            body = split
    else:
        # Single-column paste with no delimiter and not bare form: treat every
        # line as one cell so the positional mapping still gives it a shot.
        body = [([_strip_cell(text_)], n) for text_, n in lines]
        columns = list(POSITIONAL_FIELDS)

    if len(body) > max_rows:
        raise ImportLimitError(
            f'Input has {len(body)} rows; the limit is {max_rows}. Split the '
            f'list and import it in parts — nothing was imported.')
    if not body:
        raise ImportParseError('No data rows found (header only?).')

    default_platform = _PLATFORM_ALIASES.get(
        (default_platform or 'onlyfans').lower(), 'onlyfans')

    rows = []
    for idx, entry in enumerate(body):
        if bare:
            line_text, line_no = entry
            row = _blank_row(idx, line_no)
            stripped = line_text.strip()
            if not _BARE_RE.match(stripped):
                # Bare mode is a whole-document decision; a line that does not
                # fit becomes an invalid ROW, not a reason to re-read the file.
                row['errors'].append(
                    'expected email:password on this line')
                row['valid'] = False
                rows.append(row)
                continue
            email, password = stripped.split(':', 1)
            _assign(row, 'email', _strip_cell(email))
            # NB: no _strip_cell on the password — a trailing space may be part
            # of it, and stripping quotes off `"pw"` is only safe for cells that
            # a spreadsheet quoted. Only the outer whitespace of the line went.
            _assign(row, 'password', password.strip())
            rows.append(_finalize(row, default_platform, proxy_validator))
            continue

        cells, line_no = entry
        row = _blank_row(idx, line_no)
        for col_idx, cell in enumerate(cells):
            field = columns[col_idx] if col_idx < len(columns) else None
            if field is None:
                continue  # unrecognized / extra column — ignored, not an error
            _assign(row, field, cell)
        rows.append(_finalize(row, default_platform, proxy_validator))

    valid_count = sum(1 for r in rows if r['valid'])
    return {
        'rows': rows,
        'format': 'bare' if bare else 'delimited',
        'delimiter': ':' if bare else delimiter,
        'has_header': has_header,
        'columns': columns,
        'total': len(rows),
        'valid_count': valid_count,
        'invalid_count': len(rows) - valid_count,
    }


def redact(rows):
    """Rows with every secret removed, for /preview responses and logs.

    /preview must show the operator what WILL happen without ever echoing a
    password back over the wire — the paste already crossed the network once;
    reflecting it doubles the exposure for no benefit.
    """
    out = []
    for r in rows:
        cookies = r.get('cookies') or {}
        out.append({
            'row_index': r['row_index'],
            'line': r['line'],
            'email': r.get('email'),
            'platform': r.get('platform'),
            'lane': r.get('lane'),
            'label': r.get('label'),
            'proxy': _redact_proxy(r.get('proxy')),
            'has_password': bool(r.get('password')),
            'has_totp_secret': bool(r.get('totp_secret')),
            'cookie_fields': sorted(cookies.keys()) if cookies else [],
            'valid': r.get('valid', False),
            'errors': list(r.get('errors') or []),
        })
    return out


def _redact_proxy(proxy):
    """host:port only — a proxy URL carries user:pass credentials."""
    if not proxy:
        return None
    try:
        rest = proxy.split('://', 1)[-1]
        return rest.rsplit('@', 1)[-1]
    except Exception:
        return None
