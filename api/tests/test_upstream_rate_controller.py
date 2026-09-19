import importlib
import json
import threading
import time


class Response:
    def __init__(self, status_code=200, retry_after=None):
        self.status_code = status_code
        self.headers = {} if retry_after is None else {'Retry-After': retry_after}


def test_same_proxy_is_serialized_and_paced(tmp_path, monkeypatch):
    monkeypatch.setenv('OF_RATE_STATE_DIR', str(tmp_path))
    monkeypatch.setenv('OF_RATE_MIN_INTERVAL_SECONDS', '0.05')
    import upstream_rate_controller
    controller = importlib.reload(upstream_rate_controller)
    starts = []

    def run(user):
        with controller.limit({'crm_id': 'panel', 'user_id': user, 'proxy': 'shared'}) as lease:
            starts.append(time.time())
            time.sleep(0.02)
            lease.observe(Response())

    threads = [threading.Thread(target=run, args=(str(i),)) for i in range(3)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()

    starts.sort()
    assert starts[1] - starts[0] >= 0.045
    assert starts[2] - starts[1] >= 0.045


def test_retry_after_updates_account_and_proxy_budgets(tmp_path, monkeypatch):
    monkeypatch.setenv('OF_RATE_STATE_DIR', str(tmp_path))
    monkeypatch.setenv('OF_RATE_MIN_INTERVAL_SECONDS', '0')
    import upstream_rate_controller
    controller = importlib.reload(upstream_rate_controller)
    session = {'crm_id': 'panel', 'user_id': 'account', 'proxy': 'proxy'}
    before = time.time()
    with controller.limit(session) as lease:
        lease.observe(Response(429, '2'))
    values = []
    for path in tmp_path.glob('*.json'):
        values.append(json.loads(path.read_text())['next_allowed_at'])
    assert len(values) == 2
    assert all(value >= before + 1.8 for value in values)
