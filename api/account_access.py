"""
Per-account access control.

This is the tenant-isolation check: it verifies that the `of_user_id` in a URL
actually belongs to the `crm_id` the API key authenticated as. Without it, any
valid key could read any other panel's accounts.

In the hosted build this decorator lived alongside the billing code. None of
that is part of this build — there are no plans, no account slots and no call
counting — but the ownership check is security rather than billing, so it lives
on in its own module.

Must be applied AFTER `verify_api_key` has validated the `crm_id`.
"""

from functools import wraps

from flask import jsonify

import crm_database as db


def check_account_ownership(f):
    """Verify that the of_user_id in the URL belongs to this crm_id."""

    @wraps(f)
    def decorated(crm_id, of_user_id, *args, **kwargs):
        account = db.get_of_account(crm_id, of_user_id)
        if not account:
            return jsonify({
                'error': 'Account not found or does not belong to this CRM panel',
                'crm_id': crm_id,
                'of_user_id': of_user_id
            }), 403
        return f(crm_id, of_user_id, *args, **kwargs)

    return decorated
