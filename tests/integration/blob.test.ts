import { afterEach, test, expect, vi } from 'vitest';
import { Agent, Dispatcher, getGlobalDispatcher, setGlobalDispatcher, Headers } from 'undici';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { BlobEvidenceStorage, type BlobClient } from '../../packages/evidence/src/blob';
import {
  EvidenceStorageRouter,
  createEvidenceStorage,
  copyEvidenceToS3,
} from '../../packages/evidence/src/storage';
import { EvidenceService, type ObjectStorage } from '../../packages/evidence/src/index';
import { ClamAvScanner } from '../../packages/evidence/src/adapters';
import { fixture } from './support';

const token = 'vercel_blob_rw_synthetic_TEST_CREDENTIAL_ONLY';
const storeId = 'store_synthetic';
const path = 'quarantine/tenant/object';
const bytes = Buffer.from('%PDF-1.7\nSynthetic adapter document');
const privateURL = (key: string) => `https://synthetic.private.blob.vercel-storage.com/${key}`;
afterEach(() => vi.restoreAllMocks());

async function blobContract() {
  const objects = new Map<string, Buffer>();
  const requests: { method: string; headers: Record<string, unknown>; cache?: string | null }[] =
    [];
  const server = createServer(async (req, res) => {
    const url = new URL(req.url!, 'http://localhost');
    const key = url.searchParams.get('pathname') ?? url.pathname.slice('/download/'.length);
    requests.push({
      method: req.method!,
      headers: req.headers,
      cache: url.searchParams.get('cache'),
    });
    if (req.headers.authorization !== `Bearer ${token}`) {
      res.writeHead(403);
      res.end();
      return;
    }
    if (req.method === 'PUT') {
      if (objects.has(key)) {
        res.writeHead(409, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { code: 'blob_already_exists' } }));
        return;
      }
      const chunks = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk));
      objects.set(key, Buffer.concat(chunks));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          url: privateURL(key),
          downloadUrl: privateURL(key),
          pathname: key,
          contentType: 'application/pdf',
          contentDisposition: 'attachment',
          size: objects.get(key)!.length,
        }),
      );
    } else if (!objects.has(key)) {
      res.writeHead(404);
      res.end();
    } else {
      const body = objects.get(key)!;
      res.writeHead(200, { 'Content-Type': 'application/pdf', 'Content-Length': body.length });
      res.end(body);
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Test server unavailable');
  const port = address.port;
  const original = getGlobalDispatcher();
  const transport = new Agent();
  class ContractDispatcher extends Dispatcher {
    dispatch(options: Dispatcher.DispatchOptions, handler: Parameters<Dispatcher['dispatch']>[1]) {
      const origin = String(options.origin);
      let routed: string;
      if (origin === 'https://vercel.com' && options.path.startsWith('/api/blob'))
        routed = `/api${new URL(options.path, origin).search}`;
      else if (origin === 'https://synthetic.private.blob.vercel-storage.com')
        routed = `/download${options.path}`;
      else throw new Error('Unexpected SDK destination');
      return transport.dispatch(
        { ...options, origin: `http://127.0.0.1:${port}`, path: routed },
        handler,
      );
    }
  }
  setGlobalDispatcher(new ContractDispatcher());
  return {
    objects,
    requests,
    storage: new BlobEvidenceStorage(token, 'fra1', storeId),
    async close() {
      setGlobalDispatcher(original);
      await transport.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

test('real Blob SDK uses private authenticated create-only writes and uncached binary reads', async () => {
  const c = await blobContract();
  try {
    await c.storage.put(path, bytes, 'application/pdf');
    expect(await c.storage.get(path)).toEqual(bytes);
    const write = c.requests.find((r) => r.method === 'PUT')!;
    expect(write.headers['x-vercel-blob-access']).toBe('private');
    expect(write.headers['x-allow-overwrite']).toBe('0');
    expect(write.headers['x-add-random-suffix']).toBe('0');
    expect(write.headers['x-content-type']).toBe('application/pdf');
    expect(write.headers['x-cache-control-max-age']).toBe('60');
    expect(c.requests.find((r) => r.method === 'GET')!.cache).toBe('0');
    await expect(c.storage.put(path, bytes, 'application/pdf')).rejects.toThrow();
    expect(c.objects.get(path)).toEqual(bytes);
    await expect(c.storage.get('quarantine/tenant/missing')).rejects.toThrow('unavailable');
  } finally {
    await c.close();
  }
});

test('Blob rejects non-EU configuration, missing credentials, URL paths and oversized writes', async () => {
  expect(() => new BlobEvidenceStorage(token, 'iad1', storeId)).toThrow('EU');
  expect(() => new BlobEvidenceStorage('', 'fra1', storeId)).toThrow('credentials');
  expect(() => new BlobEvidenceStorage(token, 'fra1', 'bad-store')).toThrow('store ID');
  const storage = new BlobEvidenceStorage(token, 'fra1', storeId);
  await expect(storage.get('https://untrusted.invalid/secret')).rejects.toThrow('path');
  await expect(storage.get('quarantine/../secret')).rejects.toThrow('path');
  await expect(storage.put(path, Buffer.alloc(4194305), 'application/pdf')).rejects.toThrow('size');
});

function clientWithRead(stream: ReadableStream<Uint8Array>, size: number): BlobClient {
  return {
    async put() {
      throw new Error('Unexpected write');
    },
    async get() {
      return {
        statusCode: 200,
        stream,
        headers: new Headers(),
        blob: {
          url: privateURL(path),
          downloadUrl: privateURL(path),
          pathname: path,
          contentType: 'application/pdf',
          contentDisposition: 'attachment',
          cacheControl: '',
          uploadedAt: new Date(),
          etag: '',
          size,
        },
      };
    },
  };
}
test.each([0, 4194305, NaN])('Blob cancels reads with invalid declared size %s', async (size) => {
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({
    cancel() {
      cancelled = true;
    },
  });
  await expect(
    new BlobEvidenceStorage(token, 'fra1', storeId, clientWithRead(stream, size)).get(path),
  ).rejects.toThrow('size');
  expect(cancelled).toBe(true);
});
test('Blob rejects truncated and oversized streams instead of trusting declared length', async () => {
  const short = new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(bytes);
      c.close();
    },
  });
  await expect(
    new BlobEvidenceStorage(token, 'fra1', storeId, clientWithRead(short, bytes.length + 1)).get(
      path,
    ),
  ).rejects.toThrow('length');
  let cancelled = false;
  const large = new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(Buffer.alloc(4194305));
    },
    cancel() {
      cancelled = true;
    },
  });
  await expect(
    new BlobEvidenceStorage(token, 'fra1', storeId, clientWithRead(large, 4194304)).get(path),
  ).rejects.toThrow('size');
  expect(cancelled).toBe(true);
});
test.each([
  'https://synthetic.public.blob.vercel-storage.com',
  'https://other.private.blob.vercel-storage.com',
])('Blob rejects a write confirmed by the wrong store or access mode: %s', async (host) => {
  const client: BlobClient = {
    async put() {
      return {
        url: `${host}/${path}`,
        etag: 'synthetic',
        downloadUrl: `${host}/${path}`,
        pathname: path,
        contentType: 'application/pdf',
        contentDisposition: 'attachment',
      };
    },
    async get() {
      return null;
    },
  };
  await expect(
    new BlobEvidenceStorage(token, 'fra1', storeId, client).put(path, bytes, 'application/pdf'),
  ).rejects.toThrow('Private');
});

function memoryStorage() {
  const map = new Map<string, Uint8Array>();
  const storage: ObjectStorage = {
    async put(key, body) {
      if (map.has(key)) throw new Error('Already exists');
      map.set(key, body.slice());
    },
    async get(key) {
      const value = map.get(key);
      if (!value) throw new Error('Missing');
      return value;
    },
  };
  return { storage, map };
}
test('switching new writes to S3 preserves existing Blob and legacy S3 references', async () => {
  const blob = { id: storeId, ...memoryStorage() },
    s3 = { id: 'eu-bucket', ...memoryStorage() };
  const first = new EvidenceStorageRouter('vercel-blob', blob, s3);
  const key = first.objectKey(path);
  await first.put(key, bytes, 'application/pdf');
  const switched = new EvidenceStorageRouter('s3', blob, s3);
  expect(await switched.get(key)).toEqual(bytes);
  expect(switched.objectKey(path)).toBe(`s3:eu-bucket:${path}`);
  await switched.put(switched.objectKey(path), bytes, 'application/pdf');
  expect(await switched.get(path)).toEqual(bytes);
  await expect(switched.put(key, bytes, 'application/pdf')).rejects.toThrow('selected');
  await expect(switched.get(`vercel-blob:store_other:${path}`)).rejects.toThrow('unavailable');
  await expect(switched.get('quarantine/tenant/../../secret')).rejects.toThrow('reference');
});
test('migration verifies copied bytes, resumes safely and retains immutable Blob references without its token', async () => {
  const blob = { id: storeId, ...memoryStorage() },
    s3 = { id: 'eu-bucket', ...memoryStorage() };
  const source = new EvidenceStorageRouter('vercel-blob', blob);
  const objectKey = source.objectKey(path);
  await source.put(objectKey, bytes, 'application/pdf');
  const record = {
    objectKey,
    mime: 'application/pdf',
    size: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  };
  await copyEvidenceToS3(source, s3.storage, record);
  await copyEvidenceToS3(source, s3.storage, record);
  const migrated = new EvidenceStorageRouter('s3', undefined, s3, storeId);
  expect(await migrated.get(objectKey)).toEqual(bytes);
  expect(blob.map.get(path)).toEqual(bytes);
  await expect(
    copyEvidenceToS3(source, s3.storage, { ...record, sha256: '0'.repeat(64) }),
  ).rejects.toThrow('Source');
  s3.map.set(path, Buffer.from('Changed'));
  await expect(copyEvidenceToS3(source, s3.storage, record)).rejects.toThrow();
  expect(s3.map.get(path)).toEqual(Buffer.from('Changed'));
});
test('storage selection fails closed on incomplete or non-EU settings and leaves unconfigured storage unavailable', () => {
  expect(createEvidenceStorage({})).toBeNull();
  expect(() => createEvidenceStorage({ EVIDENCE_STORAGE_PROVIDER: 'public-blob' })).toThrow(
    'Unknown',
  );
  expect(() => createEvidenceStorage({ EVIDENCE_STORAGE_PROVIDER: 'vercel-blob' })).toThrow(
    'incomplete',
  );
  const env = {
    EVIDENCE_STORAGE_PROVIDER: 'vercel-blob',
    EVIDENCE_BLOB_REGION: 'fra1',
    BLOB_STORE_ID: storeId,
    BLOB_READ_WRITE_TOKEN: token,
  };
  expect(createEvidenceStorage(env)).toBeInstanceOf(EvidenceStorageRouter);
  expect(() => createEvidenceStorage({ ...env, EVIDENCE_BLOB_REGION: 'iad1' })).toThrow('EU');
  expect(() => createEvidenceStorage({ EVIDENCE_BUCKET: 'eu-bucket' })).toThrow('incomplete');
});
test('Blob-backed evidence is quarantined, cannot cross tenants and advances only after a real clean scan', async () => {
  const c = await blobContract(),
    f = await fixture();
  try {
    const storage = new EvidenceStorageRouter('vercel-blob', { id: storeId, storage: c.storage });
    const service = new EvidenceService(f.runtime, storage, new ClamAvScanner('127.0.0.1', 33129));
    const ctx = f.users.operator.ctx;
    const source = await service.createSource(ctx, {
      kind: 'observation',
      locator: 'Synthetic Blob acceptance',
      observedAt: new Date().toISOString(),
      classification: 'INTERNAL',
      purpose: ctx.purpose,
      retentionUntil: new Date(Date.now() + 86400000).toISOString(),
      aiPolicy: 'DENY',
    });
    const claim = await service.createClaim(ctx, {
      sourceId: source.id,
      statement: 'Synthetic Blob claim',
    });
    const e = await service.upload(ctx, claim.id, bytes, 'application/pdf');
    expect(e.scanStatus).toBe('PENDING');
    const record = (
      await f.owner.query('SELECT object_key FROM app.evidence_object WHERE id=$1', [e.id])
    ).rows[0];
    expect(record.object_key).toMatch(/^vercel-blob:store_synthetic:quarantine\//);
    await expect(service.download(ctx, e.id)).rejects.toThrow('unavailable');
    await expect(service.scan(f.users.other.ctx, e.id)).rejects.toThrow('unavailable');
    expect((await service.scan(ctx, e.id)).status).toBe('UNDER_REVIEW');
    expect((await service.download(ctx, e.id)).body).toEqual(bytes);
    await expect(service.download(f.users.other.ctx, e.id)).rejects.toThrow('unavailable');
    const logicalPath = record.object_key.split(':')[2];
    c.objects.set(logicalPath, Buffer.from('%PDF-1.7\nChanged evidence bytes'));
    await expect(service.download(ctx, e.id)).rejects.toThrow('integrity');
  } finally {
    await f.close();
    await c.close();
  }
});
