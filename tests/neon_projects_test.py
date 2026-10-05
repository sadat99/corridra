"""Regression checks for project identity and pagination before any cloud mutation."""
import json
import os
from pathlib import Path
import runpy
import tempfile
import unittest
from unittest.mock import patch
from urllib.parse import urlparse, parse_qs

SCRIPT = Path(__file__).resolve().parents[1] / 'scripts' / 'neon-projects.py'
PRODUCTION = {
    'id': 'prod-id', 'name': 'neon-corridra', 'org_id': 'org-vercel',
    'region_id': 'aws-eu-central-1', 'pg_version': 18, 'history_retention_seconds': 21600,
}
NONPROD = {**PRODUCTION, 'id': 'nonprod-id', 'name': 'corridra-nonprod', 'org_id': 'org-console'}
HOST = 'ep-synthetic.c-5.eu-central-1.aws.neon.tech'

class Response:
    def __init__(self, data): self.data = data
    def __enter__(self): return self
    def __exit__(self, *_): return False
    def read(self): return json.dumps(self.data).encode()

class ProjectProvisioning(unittest.TestCase):
    def execute(self, pages, provision=False, host=HOST):
        calls = []
        def request(req, **_):
            path = urlparse(req.full_url).path
            query = parse_qs(urlparse(req.full_url).query)
            calls.append((req.get_method(), path, query))
            if path.endswith('/projects/prod-id'): return Response({'project': PRODUCTION})
            if path.endswith('/projects/nonprod-id'): return Response({'project': NONPROD})
            if path.endswith('/endpoints'): return Response({'endpoints': [{'host': HOST}]})
            if req.get_method() == 'POST':
                body = json.loads(req.data)['project']
                self.assertEqual(body['org_id'], 'org-console')
                self.assertEqual(body['pg_version'], 18)
                self.assertEqual(body['region_id'], 'aws-eu-central-1')
                self.assertEqual(body['branch']['name'], 'synthetic')
                return Response({'project': NONPROD})
            self.assertEqual(query['org_id'], ['org-console'])
            return Response(pages.pop(0))
        env = {'NEON_PRODUCTION_PROJECT_ID': 'prod-id', 'NEON_NONPROD_ORG_ID': 'org-console',
               'NEON_API_KEY': 'synthetic-test-only', 'DATABASE_URL': f'postgres://owner:synthetic@{host}/neondb'}
        previous = Path.cwd()
        with tempfile.TemporaryDirectory() as directory:
            try:
                os.chdir(directory)
                with patch.dict(os.environ, env), patch('sys.argv', [str(SCRIPT)] + (['--provision-nonprod'] if provision else [])), patch('urllib.request.urlopen', request), patch('builtins.print'):
                    runpy.run_path(str(SCRIPT), run_name='__main__')
                evidence = json.loads(Path('.cache/part03-cloud-projects.json').read_text())
            finally:
                os.chdir(previous)
        return calls, evidence

    def test_empty_page_with_repeated_cursor_terminates(self):
        calls, evidence = self.execute([
            {'projects': [PRODUCTION], 'pagination': {'cursor': 'prod-id'}},
            {'projects': [], 'pagination': {'cursor': 'prod-id'}},
        ])
        self.assertEqual(len(calls), 4)
        self.assertIsNone(evidence['nonprod'])

    def test_existing_project_is_reused_without_post(self):
        calls, evidence = self.execute([{'projects': [NONPROD]}], provision=True)
        self.assertFalse(any(method == 'POST' for method, *_ in calls))
        self.assertEqual(evidence['nonprod']['id'], 'nonprod-id')

    def test_create_only_nonproduction_in_selected_org(self):
        calls, evidence = self.execute([{'projects': []}], provision=True)
        self.assertEqual(sum(method == 'POST' for method, *_ in calls), 1)
        self.assertNotEqual(evidence['production']['id'], evidence['nonprod']['id'])

    def test_mismatched_production_connection_fails_before_creation(self):
        with self.assertRaisesRegex(SystemExit, 'does not belong'):
            self.execute([], provision=True, host='ep-unrelated.c-5.eu-central-1.aws.neon.tech')

    def test_nonempty_repeated_cursor_fails_instead_of_looping(self):
        with self.assertRaisesRegex(SystemExit, 'repeated pagination cursor'):
            self.execute([
                {'projects': [PRODUCTION], 'pagination': {'cursor': 'prod-id'}},
                {'projects': [PRODUCTION], 'pagination': {'cursor': 'prod-id'}},
            ])

    def test_incomplete_inventory_cannot_create_a_duplicate(self):
        with self.assertRaisesRegex(SystemExit, 'inventory is incomplete'):
            self.execute([{'projects': [], 'unavailable': ['unknown-id']}], provision=True)

    def test_ambiguous_names_cannot_provision(self):
        with self.assertRaisesRegex(SystemExit, 'Ambiguous'):
            self.execute([{'projects': [NONPROD, {**NONPROD, 'id': 'second-id'}]}], provision=True)

if __name__ == '__main__': unittest.main()
