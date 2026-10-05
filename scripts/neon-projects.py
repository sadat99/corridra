"""Inspect/reuse the connected EU project and provision its separate non-production peer.
Only non-secret resource metadata is printed or saved. Never clone production.
"""
import argparse
import json
import os
from pathlib import Path
import urllib.error
import urllib.parse
import urllib.request

parser = argparse.ArgumentParser()
parser.add_argument('--provision-nonprod', action='store_true')
args = parser.parse_args()
production_id = os.environ['NEON_PRODUCTION_PROJECT_ID']
if not production_id or any(c not in 'abcdefghijklmnopqrstuvwxyz0123456789-' for c in production_id):
    raise SystemExit('An inspected production project ID is required')

def api(path, body=None):
    request = urllib.request.Request('https://console.neon.tech/api/v2' + path,
        headers={'Authorization': 'Bearer ' + os.environ['NEON_API_KEY'], 'Content-Type': 'application/json'},
        data=None if body is None else json.dumps(body).encode())
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            return json.load(response)
    except urllib.error.HTTPError as error:
        raise SystemExit(f'Neon API rejected the operation: HTTP {error.code}') from None

production = api('/projects/' + production_id)['project']
region = production['region_id']
if region not in ('aws-eu-central-1', 'aws-eu-west-1', 'aws-eu-west-3'):
    raise SystemExit('The existing project must be in an approved EU region')
if production['pg_version'] not in (17, 18):
    raise SystemExit('The project PostgreSQL version requires foundation validation')
if production.get('history_retention_seconds', 0) < 21600:
    raise SystemExit('The existing project must have at least six hours of recovery history')
# Verify that the supplied connection actually belongs to this project before reusing it.
url = urllib.parse.urlparse(os.environ['DATABASE_URL'])
endpoints = api('/projects/' + production_id + '/endpoints')['endpoints']
host = url.hostname.replace('-pooler.', '.')
if not any(endpoint['host'] == host for endpoint in endpoints):
    raise SystemExit('The supplied database does not belong to the inspected project')
org_id = os.environ.get('NEON_NONPROD_ORG_ID', production['org_id'])
if not org_id or any(c not in 'abcdefghijklmnopqrstuvwxyz0123456789-' for c in org_id):
    raise SystemExit('An inspected non-production organization ID is required')
projects = []
cursor = None
while True:
    query = {'org_id': org_id, 'limit': 100}
    if cursor:
        query['cursor'] = cursor
    data = api('/projects?' + urllib.parse.urlencode(query))
    if data.get('unavailable'):
        raise SystemExit('Neon inventory is incomplete; creation is unsafe')
    if not data['projects']:
        break
    projects.extend(data['projects'])
    next_cursor = data.get('pagination', {}).get('cursor')
    if not next_cursor:
        break
    if next_cursor == cursor:
        raise SystemExit('Neon returned a repeated pagination cursor')
    cursor = next_cursor
matches = [project for project in projects if project['name'] == 'corridra-nonprod']
if len(matches) > 1:
    raise SystemExit('Ambiguous non-production projects; inspect their IDs')
nonprod = api('/projects/' + matches[0]['id'])['project'] if matches else None
if nonprod is None and args.provision_nonprod:
    nonprod = api('/projects', {'project': {
        'name': 'corridra-nonprod', 'org_id': org_id, 'region_id': region,
        'pg_version': production['pg_version'], 'history_retention_seconds': 21600,
        'default_endpoint_settings': {'autoscaling_limit_min_cu': 0.25, 'autoscaling_limit_max_cu': 0.25},
        'branch': {'name': 'synthetic', 'database_name': 'corridra', 'role_name': 'corridra_migrator'}
    }})['project']
if nonprod and (nonprod['id'] == production_id or nonprod['region_id'] != region
               or nonprod['pg_version'] != production['pg_version']
               or nonprod.get('history_retention_seconds', 0) < 21600):
    raise SystemExit('Non-production isolation, region, version or recovery window mismatch')
fields = ['id', 'name', 'org_id', 'region_id', 'pg_version', 'history_retention_seconds']
evidence = {'production': {key: production[key] for key in fields},
            'nonprod': None if nonprod is None else {key: nonprod[key] for key in fields}}
Path('.cache').mkdir(exist_ok=True)
Path('.cache/part03-cloud-projects.json').write_text(json.dumps(evidence, indent=2) + '\n')
print(json.dumps(evidence))
