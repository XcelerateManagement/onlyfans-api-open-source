"""Regression checks for the OAuth flow-signing secret."""

import os


# The module imports database helpers but does not initialize an application.
from oauth_routes import _flow_secret


original = os.environ.pop("INTER_SERVICE_TOKEN", None)
try:
    try:
        _flow_secret()
    except RuntimeError as exc:
        assert "INTER_SERVICE_TOKEN" in str(exc)
    else:
        raise AssertionError("OAuth flow signing accepted a missing service token")

    os.environ["INTER_SERVICE_TOKEN"] = "x" * 32
    assert _flow_secret() == b"x" * 32
finally:
    if original is None:
        os.environ.pop("INTER_SERVICE_TOKEN", None)
    else:
        os.environ["INTER_SERVICE_TOKEN"] = original


print("ok - OAuth flow signing requires INTER_SERVICE_TOKEN")
