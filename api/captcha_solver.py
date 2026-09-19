#!/usr/bin/env python3
"""
2captcha Cloudflare Turnstile solver for OnlyFans

This module provides a function to solve Cloudflare Turnstile challenges
using the 2captcha service.

Usage:
    from captcha_solver import solve_turnstile
    import config

    token = solve_turnstile(
        api_key=config.TWOCAPTCHA_API_KEY,
        site_url='https://onlyfans.com/',
        sitekey=config.TURNSTILE_SITEKEY
    )
"""

import os
import requests
import time


# 2captcha API configuration
TWOCAPTCHA_API_URL = 'https://2captcha.com'

# (connect, read) timeout for every 2captcha HTTP call.
#
# `max_wait` bounds the polling LOOP, not an individual socket: a single
# request that hangs open never returns, so the elapsed-time check at the top
# of the loop is never reached and the caller blocks indefinitely. That is a
# wedged worker thread with no error and no log line. These are small JSON
# calls against a third party, so a short ceiling is right.
HTTP_TIMEOUT = (
    float(os.environ.get('CAPTCHA_CONNECT_TIMEOUT', 10)),
    float(os.environ.get('CAPTCHA_READ_TIMEOUT', 30)),
)


def solve_turnstile(api_key, site_url, sitekey, action=None, user_agent=None, max_wait=120, poll_interval=5):
    """
    Solve Cloudflare Turnstile challenge using 2captcha.

    Args:
        api_key (str): Your 2captcha API key (from config.TWOCAPTCHA_API_KEY)
        site_url (str): The URL where the captcha is located (e.g., 'https://onlyfans.com/')
        sitekey (str): The Turnstile sitekey (from config.TURNSTILE_SITEKEY)
        action (str, optional): The action parameter (e.g., 'login')
        user_agent (str, optional): User agent string to use
        max_wait (int): Maximum time to wait for solution in seconds (default: 120)
        poll_interval (int): How often to check for solution in seconds (default: 5)

    Returns:
        str: The Turnstile response token

    Raises:
        Exception: If the captcha solving fails or times out

    Example:
        >>> import config
        >>> token = solve_turnstile(
        ...     api_key=config.TWOCAPTCHA_API_KEY,
        ...     site_url='https://onlyfans.com/',
        ...     sitekey=config.TURNSTILE_SITEKEY,
        ...     action='login',
        ...     user_agent=config.USER_AGENT
        ... )
        >>> print(token)
    """
    if not api_key:
        raise ValueError("API key is required. Set TWOCAPTCHA_API_KEY environment variable.")
    
    print(f'Solving Turnstile captcha for {site_url}...')

    # Step 1: Submit the captcha task
    submit_url = f'{TWOCAPTCHA_API_URL}/in.php'
    submit_params = {
        'key': api_key,
        'method': 'turnstile',
        'sitekey': sitekey,
        'pageurl': site_url,
        'json': 1
    }

    # Add optional parameters
    if action:
        submit_params['action'] = action
    if user_agent:
        submit_params['userAgent'] = user_agent

    print('Submitting captcha task to 2captcha...')
    response = requests.post(submit_url, data=submit_params, timeout=HTTP_TIMEOUT)
    result = response.json()

    if result.get('status') != 1:
        error_text = result.get('request', 'Unknown error')
        raise Exception(f'Failed to submit captcha: {error_text}')

    task_id = result['request']
    print(f'Task ID: {task_id}')
    print('Waiting for solution...')

    # Step 2: Poll for the solution
    result_url = f'{TWOCAPTCHA_API_URL}/res.php'
    start_time = time.time()

    while True:
        # Check if we've exceeded max wait time
        elapsed = time.time() - start_time
        if elapsed > max_wait:
            raise Exception(f'Captcha solving timed out after {max_wait} seconds')

        # Wait before polling
        time.sleep(poll_interval)

        # Poll for result
        result_params = {
            'key': api_key,
            'action': 'get',
            'id': task_id,
            'json': 1
        }

        response = requests.get(result_url, params=result_params, timeout=HTTP_TIMEOUT)
        result = response.json()

        if result.get('status') == 1:
            # Solution found
            token = result['request']
            print(f'Captcha solved successfully! (took {elapsed:.1f}s)')
            return token

        elif result.get('request') == 'CAPCHA_NOT_READY':
            # Still processing
            print(f'Still processing... ({elapsed:.1f}s elapsed)')
            continue

        else:
            # Error occurred
            error_text = result.get('request', 'Unknown error')
            raise Exception(f'Captcha solving failed: {error_text}')


def get_balance(api_key):
    """
    Get your 2captcha account balance.

    Args:
        api_key (str): Your 2captcha API key

    Returns:
        float: Account balance in USD

    Example:
        >>> import config
        >>> balance = get_balance(config.TWOCAPTCHA_API_KEY)
        >>> print(f'Balance: ${balance}')
    """
    if not api_key:
        raise ValueError("API key is required. Set TWOCAPTCHA_API_KEY environment variable.")
    
    url = f'{TWOCAPTCHA_API_URL}/res.php'
    params = {
        'key': api_key,
        'action': 'getbalance',
        'json': 1
    }

    response = requests.get(url, params=params, timeout=HTTP_TIMEOUT)
    result = response.json()

    if result.get('status') == 1:
        return float(result['request'])
    else:
        error_text = result.get('request', 'Unknown error')
        raise Exception(f'Failed to get balance: {error_text}')


if __name__ == '__main__':
    # Example usage and testing
    print('=== 2captcha Cloudflare Turnstile Solver ===')
    print()
    print('This script requires environment variables to be set:')
    print('  - TWOCAPTCHA_API_KEY')
    print()
    
    try:
        import config
        
        print('Configuration loaded from config.py')
        print('Using API Key: [redacted]')
        print()

        # Check balance first
        try:
            balance = get_balance(config.TWOCAPTCHA_API_KEY)
            print(f'Account balance: ${balance:.2f}')
            print()
        except Exception as e:
            print(f'Warning: Could not get balance - {e}')
            print()

        # Solve the captcha
        try:
            token = solve_turnstile(
                api_key=config.TWOCAPTCHA_API_KEY,
                site_url='https://onlyfans.com/',
                sitekey=config.TURNSTILE_SITEKEY,
                action=config.TURNSTILE_ACTION,
                user_agent=config.USER_AGENT,
                max_wait=120,
                poll_interval=5
            )

            print()
            print('=== SUCCESS ===')
            print('Turnstile token:')
            print(token)
            print()
            print('Use this token in the "turnstile-invisible-response" field')

        except Exception as e:
            print()
            print('=== FAILED ===')
            print(f'Error: {e}')
            exit(1)
            
    except ValueError as e:
        print(f'Configuration Error: {e}')
        print()
        print('Please set the required environment variables:')
        print('  export TWOCAPTCHA_API_KEY=your_api_key_here')
        exit(1)
    except ImportError:
        print('Error: Could not import config.py')
        print('Make sure you are running this from the onlyfans-api directory.')
        exit(1)
