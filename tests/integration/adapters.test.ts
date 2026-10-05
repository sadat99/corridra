import { test, expect } from 'vitest';
import { ClamAvScanner, S3EvidenceStorage, S3Client } from '../../packages/evidence/src/adapters';
import { readFoundationConfig } from '../../packages/config/src/index';
test('actual ClamAV accepts harmless bytes and quarantines the EICAR test signature', async () => {
  const scanner = new ClamAvScanner('127.0.0.1', 33129);
  expect((await scanner.scan(Buffer.from('%PDF-1.7\nSynthetic harmless document'))).verdict).toBe(
    'CLEAN',
  );
  const signature = Buffer.from(
    'WDVPIVAlQEFQWzRcUFpYNTQoUF4pN0NDKTd9JEVJQ0FSLVNUQU5EQVJELUFOVElWSVJVUy1URVNULUZJTEUhJEgrSCo=',
    'base64',
  );
  expect((await scanner.scan(signature)).verdict).toBe('INFECTED');
  expect((await new ClamAvScanner('127.0.0.1', 33128, 100).scan(signature)).verdict).toBe('ERROR');
});
test('production activation, shared roles and non-EU data fail configuration validation', () => {
  const env = {
    CORRIDRA_FOUNDATIONS_ENABLED: 'true',
    APP_ORIGIN: 'https://preview.example.invalid',
    AUTH_SECRET: 'x'.repeat(48),
    DATA_ENVIRONMENT: 'synthetic',
    DATABASE_REGION: 'aws-eu-central-1',
    RUNTIME_DATABASE_URL:
      'postgresql://runtime:synthetic@ep-example.eu-central-1.aws.neon.tech/corridra?sslmode=verify-full',
    AUTH_DATABASE_URL:
      'postgresql://auth:synthetic@ep-example.eu-central-1.aws.neon.tech/corridra?sslmode=verify-full',
  };
  expect(readFoundationConfig(env)).not.toBeNull();
  expect(() => readFoundationConfig({ ...env, VERCEL_ENV: 'production' })).toThrow('production');
  expect(
    readFoundationConfig({
      ...env,
      VERCEL_ENV: 'production',
      CORRIDRA_LIVE_ROLLOUT_ENABLED: 'true',
      EVIDENCE_SCAN_MODE: 'bypass',
    })?.EVIDENCE_SCAN_MODE,
  ).toBe('bypass');
  expect(() => readFoundationConfig({ ...env, EVIDENCE_SCAN_MODE: 'clean' })).toThrow();
  expect(() =>
    readFoundationConfig({
      ...env,
      VERCEL_ENV: 'production',
      CORRIDRA_LIVE_ROLLOUT_ENABLED: 'true',
      DATA_ENVIRONMENT: 'production',
    }),
  ).toThrow();
  expect(() =>
    readFoundationConfig({ ...env, AUTH_DATABASE_URL: env.RUNTIME_DATABASE_URL }),
  ).toThrow('separate');
  expect(() =>
    readFoundationConfig({
      ...env,
      RUNTIME_DATABASE_URL: env.RUNTIME_DATABASE_URL.replace('eu-central-1', 'us-east-1'),
    }),
  ).toThrow();
  expect(() =>
    readFoundationConfig({
      ...env,
      RUNTIME_DATABASE_URL: env.RUNTIME_DATABASE_URL.replace('verify-full', 'require'),
    }),
  ).toThrow('TLS');
  expect(() =>
    readFoundationConfig({
      ...env,
      AUTH_DATABASE_URL: env.AUTH_DATABASE_URL.replace('/corridra?', '/other?'),
    }),
  ).toThrow('same');
  expect(
    () => new S3EvidenceStorage(new S3Client({ region: 'us-east-1' }), 'synthetic', 'us-east-1'),
  ).toThrow('EU');
  expect(readFoundationConfig({})).toBeNull();
});

test('S3 adapter sends encrypted create-only uploads and bounded binary downloads through the SDK', async () => {
  const { createServer } = await import('node:http');
  let stored: Buffer | undefined;
  let encrypted = false,
    conditional = false;
  const server = createServer(async (req, res) => {
    if (req.method === 'PUT') {
      encrypted = req.headers['x-amz-server-side-encryption'] === 'AES256';
      conditional = req.headers['if-none-match'] === '*';
      if (stored) {
        res.writeHead(412);
        res.end('<Error><Code>PreconditionFailed</Code></Error>');
        return;
      }
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk));
      stored = Buffer.concat(chunks);
      res.writeHead(200, { ETag: '"synthetic"' });
      res.end();
    } else {
      res.writeHead(200, { 'Content-Type': 'application/pdf', 'Content-Length': stored!.length });
      res.end(stored);
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Test server address unavailable');
  const client = new S3Client({
    region: 'eu-central-1',
    endpoint: `http://127.0.0.1:${address.port}`,
    forcePathStyle: true,
    credentials: { accessKeyId: 'synthetic', secretAccessKey: 'synthetic' },
    requestChecksumCalculation: 'WHEN_REQUIRED',
    maxAttempts: 1,
  });
  try {
    const storage = new S3EvidenceStorage(client, 'synthetic', 'eu-central-1');
    const bytes = Buffer.from('%PDF-1.7\nSynthetic');
    await storage.put('quarantine/test', bytes, 'application/pdf');
    expect(encrypted && conditional).toBe(true);
    expect(Buffer.from(await storage.get('quarantine/test'))).toEqual(bytes);
    await expect(storage.put('quarantine/test', bytes, 'application/pdf')).rejects.toThrow();
  } finally {
    client.destroy();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('a scanner connection closed during startup fails closed without leaving readiness pending', async () => {
  const { createServer } = await import('node:net');
  const server = createServer((socket) => socket.destroy());
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Test server address unavailable');
  try {
    expect(
      (
        await new ClamAvScanner('127.0.0.1', address.port, 1000).scan(
          Buffer.from('Synthetic readiness probe'),
        )
      ).verdict,
    ).toBe('ERROR');
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
