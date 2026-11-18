import { spawn, type ChildProcess } from 'node:child_process';

// A production server on its own port, started from the existing build with customer sign-in configured and the three
// customer switches on. The shared UX test server has no sign-in, so the screens that show only with it (the customer
// door's two doors and the real sign-in form) are measured here. The Neon address is a made-up one that nothing calls:
// the specs answer the browser's account requests themselves.
export function configuredServer(port: number) {
  const base = `http://127.0.0.1:${port}`;
  let server: ChildProcess | undefined;
  return {
    base,
    async start() {
      server = spawn('pnpm', ['--filter', '@corridra/web', 'start', '--port', String(port)], {
        env: {
          ...process.env,
          CORRIDRA_NEON_AUTH_ENABLED: 'true',
          NEON_AUTH_BASE_URL: 'https://ep-test.neonauth.eu-central-1.aws.neon.tech/neondb/auth',
          NEON_AUTH_COOKIE_SECRET: '0123456789abcdef0123456789abcdef0123',
          APP_ORIGIN: base,
          DATA_ENVIRONMENT: 'synthetic',
          CORRIDRA_CUSTOMER_WORKSPACES_ENABLED: 'true',
          CORRIDRA_CUSTOMER_PROGRAMMES_ENABLED: 'true',
          CORRIDRA_CUSTOMER_PARTICIPANTS_ENABLED: 'true',
        },
        stdio: 'ignore',
        detached: true,
      });
      for (let i = 0; i < 60; i++) {
        try {
          if ((await fetch(`${base}/access/customer`)).ok) return;
        } catch {
          // not up yet
        }
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
      throw new Error('the configured server did not start');
    },
    stop() {
      // The server is a child of pnpm: stop the whole group so no server is left on the port.
      if (server?.pid) process.kill(-server.pid, 'SIGTERM');
    },
  };
}
