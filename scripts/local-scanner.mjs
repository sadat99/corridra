import { spawnSync } from 'node:child_process';
import { createConnection } from 'node:net';
const env = { ...process.env };
for (const key of [
  'DOCKER_HOST',
  'DOCKER_CONTEXT',
  'DOCKER_TLS',
  'DOCKER_TLS_VERIFY',
  'DOCKER_CERT_PATH',
])
  delete env[key];
const docker = (args) =>
  spawnSync('docker', ['--host=unix:///var/run/docker.sock', ...args], { env, encoding: 'utf8' });
const name = 'corridra-part03-clamav';
const state = docker(['inspect', '--format', '{{.State.Running}}', name]);
if (state.status !== 0) {
  const r = docker([
    'run',
    '-d',
    '--name',
    name,
    '-p',
    '127.0.0.1:33129:3310',
    '-e',
    'CLAMAV_NO_FRESHCLAMD=true',
    'clamav/clamav@sha256:ebec5bc138401b36ae987caa1a3fa3c3b2a21ed3d51f0bfa5852825e663e67b0',
  ]);
  if (r.status !== 0) throw new Error('Local scanner could not start');
} else if (state.stdout.trim() !== 'true' && docker(['start', name]).status !== 0)
  throw new Error('Local scanner could not restart');
async function ping() {
  return new Promise((resolve) => {
    const socket = createConnection({ host: '127.0.0.1', port: 33129 });
    socket.setTimeout(1000);
    const finish = (value) => {
      socket.destroy();
      resolve(value);
    };
    socket.on('connect', () => socket.write('zPING\0'));
    socket.on('data', (data) => finish(data.toString().startsWith('PONG')));
    socket.on('error', () => finish(false));
    socket.on('timeout', () => finish(false));
  });
}
let ready = false;
for (let attempt = 0; attempt < 60; attempt++) {
  if (await ping()) {
    ready = true;
    break;
  }
  await new Promise((resolve) => setTimeout(resolve, 500));
}
if (!ready)
  throw new Error('Scanner readiness timed out; retry once the image has loaded its signatures');
console.log('Local ClamAV is ready. Bundled signatures are for repeatable synthetic tests only.');
