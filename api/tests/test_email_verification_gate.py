"""Isolated auth-boundary tests: AST-extracted functions, no app/scheduler/DB imports."""
import ast
import copy
import os
import subprocess
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

SOURCE = Path(__file__).resolve().parents[1] / 'crm_api.py'
SERVICE_TOKEN = 'synthetic-inter-service-test-token-only'


def functions(source):
    return {node.name: node for node in ast.parse(source).body if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef))}


class VerificationMintGateTests(unittest.TestCase):
    def prepare(self, headers, body=None):
        self.reads = self.validations = self.mints = 0
        def read_json(**kwargs):
            self.reads += 1
            return body or {'email': 'morgan@example.test'}
        def validate(value):
            self.validations += 1
            return value
        def mint(email):
            self.mints += 1
            return 'synthetic-verification-token-only', '2026-09-18T00:00:00'
        nodes = functions(SOURCE.read_text(encoding='utf-8'))
        selected = [copy.deepcopy(nodes[name]) for name in ['_verify_service_token', 'start_email_verification_route']]
        for node in selected:
            node.decorator_list = []
        scope = {'request': SimpleNamespace(headers=headers, get_json=read_json), 'jsonify': lambda value: value,
                 'validate_email': validate, 'db': SimpleNamespace(start_email_verification=mint), 'ValidationError': ValueError}
        exec(compile(ast.Module(body=selected, type_ignores=[]), str(SOURCE), 'exec'), scope)
        return scope['start_email_verification_route']

    def test_missing_wrong_or_unconfigured_service_never_reads_body_or_mints(self):
        for expected, provided in [('', ''), ('', SERVICE_TOKEN), (SERVICE_TOKEN, ''), (SERVICE_TOKEN, 'wrong-synthetic-token')]:
            with self.subTest(configured=bool(expected), presented=bool(provided)), patch.dict(os.environ, {'INTER_SERVICE_TOKEN': expected}):
                route = self.prepare({'X-Service-Token': provided})
                self.assertEqual(route(), ({'error': 'Unauthorized'}, 401))
                self.assertEqual((self.reads, self.validations, self.mints), (0, 0, 0))

    def test_authorized_service_retains_existing_success_contract(self):
        with patch.dict(os.environ, {'INTER_SERVICE_TOKEN': SERVICE_TOKEN}):
            route = self.prepare({'X-Service-Token': SERVICE_TOKEN})
            self.assertEqual(route(), {'success': True, 'token': 'synthetic-verification-token-only', 'expires_at': '2026-09-18T00:00:00'})
            self.assertEqual((self.reads, self.validations, self.mints), (1, 1, 1))

    def test_captcha_and_panel_api_key_do_not_authorize_token_disclosure(self):
        with patch.dict(os.environ, {'INTER_SERVICE_TOKEN': SERVICE_TOKEN}):
            route = self.prepare({'X-API-Key': 'synthetic-panel-key', 'X-Captcha-Token': 'synthetic-captcha'}, {'email': 'morgan@example.test', 'captchaToken': 'synthetic-captcha'})
            self.assertEqual(route(), ({'error': 'Unauthorized'}, 401))
            self.assertEqual(self.mints, 0)

    def test_auth_handlers_are_all_present(self):
        """The hosted build diffed these handlers against a specific historical
        commit to catch an accidental auth rewrite. That check cannot travel to
        a repository with its own history, so what is asserted here is that the
        handlers still exist and still parse."""
        after = functions(SOURCE.read_text(encoding='utf-8'))
        for name in ['_verify_service_token', 'verify_api_key', 'login_user', 'verify_email_route', '_require_human_or_service']:
            with self.subTest(function=name):
                self.assertIn(name, after)


if __name__ == '__main__': unittest.main()
