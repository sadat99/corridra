"""Provision separate EU projects. Requires a scoped Neon API key in secure environment settings.
No credentials from Neon responses are printed or saved. Retrieve restricted roles separately.
"""
import json, os, urllib.request, urllib.error

def api(path, body=None):
    request = urllib.request.Request('https://console.neon.tech/api/v2' + path,
        headers={'Authorization': 'Bearer ' + os.environ['NEON_API_KEY'], 'Content-Type': 'application/json'},
        data=None if body is None else json.dumps(body).encode())
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            return json.load(response)
    except urllib.error.HTTPError as error:
        raise SystemExit(f'Neon API rejected the operation: HTTP {error.code}') from None

region = os.environ.get('NEON_EU_REGION', 'aws-eu-central-1')
if region not in ('aws-eu-central-1', 'aws-eu-west-1', 'aws-eu-west-3'):
    raise SystemExit('An approved EU region is required')
# Free plan supports six hours; never silently buy a larger retention window.
retention = int(os.environ.get('NEON_HISTORY_RETENTION_SECONDS', '21600'))
if not 21600 <= retention <= 2592000:
    raise SystemExit('Select a supported nonzero recovery history window')
projects=[]
cursor=None
while True:
    data=api('/projects?limit=100' + ('&cursor='+cursor if cursor else ''))
    projects.extend(data['projects'])
    cursor=data.get('pagination',{}).get('cursor')
    if not cursor: break
for name, branch in [('corridra-prod', 'production'), ('corridra-nonprod', 'synthetic')]:
    existing=[p for p in projects if p['name']==name]
    if len(existing)>1: raise SystemExit('Ambiguous project names; review project IDs')
    if existing:
        project=api('/projects/'+existing[0]['id'])['project']
    else:
        project=api('/projects', {'project': {'name':name, 'region_id':region, 'pg_version':17,
            'history_retention_seconds':retention, 'branch':{'name':branch,'database_name':'corridra','role_name':'corridra_migrator'}}})['project']
    if project['region_id']!=region or project.get('history_retention_seconds',0)<retention:
        raise SystemExit('Existing project region/recovery window does not meet the selected policy')
    print(json.dumps({k:project[k] for k in ['id','name','region_id','history_retention_seconds']}))
