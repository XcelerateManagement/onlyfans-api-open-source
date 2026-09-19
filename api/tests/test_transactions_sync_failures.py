#!/usr/bin/env python3
"""A failed transactions page must be recorded, not swallowed.

Runs either way:
    python tests/test_transactions_sync_failures.py     (standalone, like its siblings)
    python -m pytest tests/test_transactions_sync_failures.py

The sys.path bootstrap below is what makes `import transactions_sync` resolve
when the file is executed directly (Python puts tests/ on sys.path, not the
package root) — without it the module was an ImportError, not a failing test.
"""

import os
import sys

os.environ.setdefault('WERKZEUG_RUN_MAIN', 'false')
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import transactions_sync  # noqa: E402


def test_failed_page_increments_persistent_refresh_counter(monkeypatch):
    marks = []
    connection_errors = []
    monkeypatch.setattr(
        transactions_sync,
        '_fetch_page',
        lambda *args: (False, {'error': 'temporary upstream failure'}, 502, {}),
    )
    monkeypatch.setattr(
        transactions_sync.db,
        'mark_transactions_refresh',
        lambda crm_id, of_user_id, success, latest_marker=None:
            marks.append((crm_id, of_user_id, success, latest_marker)),
    )
    monkeypatch.setattr(
        transactions_sync.db,
        'set_connection_error',
        lambda crm_id, of_user_id, state, code=None:
            connection_errors.append((crm_id, of_user_id, state, code)),
    )

    result = transactions_sync._walk(
        'panel', 'account', None, mode='delta', max_pages=1
    )

    assert result['success'] is False
    assert result['stopped_reason'] == 'error'
    assert marks == [('panel', 'account', False, None)]
    assert connection_errors == [(
        'panel', 'account', 'temporary_error', 'transactions_unavailable'
    )]


class _MonkeyPatch:
    """The three lines of pytest's monkeypatch these tests actually use, so the
    file runs without pytest installed (a self-host build has no dev deps)."""

    def __init__(self):
        self._undo = []

    def setattr(self, target, name, value):
        self._undo.append((target, name, getattr(target, name)))
        setattr(target, name, value)

    def undo(self):
        for target, name, old in reversed(self._undo):
            setattr(target, name, old)
        self._undo = []


if __name__ == '__main__':
    failures = []
    for _name, _fn in sorted(
            (n, f) for n, f in list(globals().items())
            if n.startswith('test_') and callable(f)):
        mp = _MonkeyPatch()
        try:
            _fn(mp)
            print(f'  [PASS] {_name}')
        except Exception as exc:  # noqa: BLE001 - a red test, not a crash
            failures.append(_name)
            print(f'  [FAIL] {_name}  ({exc})')
        finally:
            mp.undo()

    print()
    if failures:
        print(f'{len(failures)} FAILURE(S): {failures}')
        sys.exit(1)
    print('ALL PASS')
