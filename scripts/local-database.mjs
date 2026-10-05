import { randomBytes } from 'node:crypto';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
const name = 'corridra-part03-postgres';
const image = 'postgres@sha256:639ab7ceb90e13123085b741fb31ef493fba25463002f6da665352e7b534b652';
const env = { ...process.env };
for (const k of [
  'DOCKER_HOST',
  'DOCKER_CONTEXT',
  'DOCKER_TLS',
  'DOCKER_TLS_VERIFY',
  'DOCKER_CERT_PATH',
])
  delete env[k];
const docker = (args, extra = {}) =>
  spawnSync('docker', ['--host=unix:///var/run/docker.sock', ...args], {
    env: { ...env, ...extra },
    encoding: 'utf8',
  });
await mkdir('.cache', { recursive: true });
let config;
try {
  config = JSON.parse(await readFile('.cache/part03-local.json', 'utf8'));
} catch {
  config = {
    ownerPassword: randomBytes(32).toString('hex'),
    runtimePassword: randomBytes(32).toString('hex'),
    authPassword: randomBytes(32).toString('hex'),
    authSecret: randomBytes(48).toString('hex'),
  };
}
const inspect = docker(['inspect', '--format', '{{.State.Running}}', name]);
if (inspect.status !== 0) {
  const r = docker(
    [
      'run',
      '-d',
      '--name',
      name,
      '-p',
      '127.0.0.1:54329:5432',
      '-e',
      'POSTGRES_PASSWORD',
      '-e',
      'POSTGRES_DB=corridra_test',
      image,
    ],
    { POSTGRES_PASSWORD: config.ownerPassword },
  );
  if (r.status !== 0) throw new Error('PostgreSQL container could not start');
} else if (inspect.stdout.trim() !== 'true') {
  if (docker(['start', name]).status !== 0)
    throw new Error('PostgreSQL container could not restart');
}
await writeFile('.cache/part03-local.json', JSON.stringify(config), { mode: 0o600 });
console.log(
  'Local PostgreSQL container started on port 54329. Credentials saved only in ignored .cache.',
);
let ready = false;
for (let attempt = 0; attempt < 60; attempt++) {
  if (docker(['exec', name, 'pg_isready', '-U', 'postgres']).status === 0) {
    ready = true;
    break;
  }
  await new Promise((resolve) => setTimeout(resolve, 500));
}
if (!ready) throw new Error('Local PostgreSQL readiness timed out');
