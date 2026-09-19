import importlib


def test_operator_pause_opens_signed_job_circuit(tmp_path, monkeypatch):
    pause_file = tmp_path / 'pause'
    monkeypatch.setenv('OF_SIGNED_JOBS_PAUSE_FILE', str(pause_file))
    import runtime_readiness
    readiness = importlib.reload(runtime_readiness)
    monkeypatch.setattr(
        readiness, 'signer_status', lambda force=False: {'ready': True, 'reason': None}
    )
    pause_file.write_text('incident threshold exceeded')

    assert readiness.signed_jobs_ready() is False
    try:
        readiness.ensure_signer_ready()
    except readiness.SignedJobsPausedError:
        pass
    else:
        raise AssertionError('operator pause did not block a direct signed call')
    state = readiness.service_readiness(__file__, scheduler_running=True)
    assert state['ready'] is False
    assert state['checks']['operator_pause'] is False
    assert state['reason'] == 'operator_paused'
