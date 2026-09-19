#!/usr/bin/env python3
"""
Simple OnlyFans header generator wrapper for Node.js script.

Usage:
    from header_generator import generate_headers

    headers = generate_headers('/api2/v2/users/me', user_id=509955039)
    print(headers)
"""

import subprocess
import json
import os
import runtime_readiness

# Wall-clock ceiling for one `node onlyfans-sign-generator.js` run.
# Env-overridable so a slow/cold box can be nursed without a code change.
SIGN_TIMEOUT_SECONDS = int(os.environ.get('SIGN_TIMEOUT_SECONDS', 20))


def generate_headers(path, user_id=None, timestamp=None):
    """
    Generate OnlyFans headers by calling the Node.js script.

    Args:
        path (str): API endpoint path (e.g., '/api2/v2/users/me')
        user_id (int, optional): User ID for authentication
        timestamp (int, optional): Override timestamp in milliseconds

    Returns:
        dict: Headers dictionary with 'sign', 'time', and 'app-token'

    Example:
        >>> headers = generate_headers('/api2/v2/users/me', user_id=509955039)
        >>> print(headers['sign'])
    """
    script_dir = os.path.dirname(os.path.abspath(__file__))
    generator_script = os.path.join(script_dir, 'onlyfans-sign-generator.js')

    # Fail closed before spawning Node.  This error is deliberately typed so
    # API callers can return sync_blocked/503 instead of a misleading login
    # failure or a generic 500.
    runtime_readiness.ensure_signer_ready()

    # Build command
    cmd = ['node', generator_script, path]

    if user_id is not None:
        cmd.append(str(user_id))

    if timestamp is not None:
        cmd.append(f'--timestamp={timestamp}')

    # Execute Node.js script.
    #
    # The timeout is not optional. Every signed OF request goes through here,
    # and a `node` that wedges (bad install, OOM, a hung require) with no
    # timeout holds its caller's thread forever. Serially that's one stuck
    # request; from a pool of background workers it silently drains the pool
    # until the whole background engine stops with nothing in the logs.
    # Signing is pure local CPU and normally takes ~100ms, so 20s is already
    # two orders of magnitude of headroom.
    try:
        result = subprocess.run(cmd, capture_output=True, text=True,
                                cwd=script_dir, timeout=SIGN_TIMEOUT_SECONDS)
    except subprocess.TimeoutExpired:
        # Raise something callers can classify as transient/retryable rather
        # than letting a TimeoutExpired escape as an unknown error type.
        raise runtime_readiness.SignerUnavailableError(
            f'Header generation timed out after {SIGN_TIMEOUT_SECONDS}s '
            f'(node did not exit)')
    except FileNotFoundError:
        raise runtime_readiness.SignerUnavailableError(
            'Header generation failed: `node` not found on PATH')

    if result.returncode != 0:
        # stderr may contain implementation details. Log it server-side in the
        # caller if needed, but never let it become a customer-facing API body.
        raise runtime_readiness.SignerUnavailableError(
            'Header generation failed: signer process exited unsuccessfully')

    # Parse JSON output
    lines = result.stdout.split('\n')
    json_lines = []
    json_started = False

    for line in lines:
        if line.strip().startswith('{'):
            json_started = True
        if json_started:
            json_lines.append(line)
            if line.strip() == '}':
                break

    if not json_lines:
        raise Exception('Could not find JSON in output')

    return json.loads('\n'.join(json_lines))


if __name__ == '__main__':
    # Test the function
    test_path = '/api2/v2/users/me'
    test_user_id = 509955039

    print('Testing header generator...')
    print(f'Path: {test_path}')
    print(f'User ID: {test_user_id}')
    print()

    headers = generate_headers(test_path, user_id=test_user_id)

    print('Generated headers:')
    print(json.dumps(headers, indent=2))
