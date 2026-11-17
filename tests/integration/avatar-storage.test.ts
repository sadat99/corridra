import { describe, expect, test } from 'vitest';
import { randomUUID } from 'node:crypto';
import {
  AvatarStorage,
  BlobAvatarBackend,
  S3AvatarBackend,
  avatarPath,
  createAvatarStorage,
  type AvatarBackend,
  type AvatarBlobClient,
} from '../../packages/evidence/src/avatar-storage';

// ADR-088. Private picture storage: own avatar/<id>/<size> paths on the reviewed stores, private writes that never
// overwrite, reads checked against the store identity, and delete of both files of an object.
const token = 'vercel_blob_rw_synthetic_TEST_CREDENTIAL_ONLY';
const storeId = 'store_synthetic';
const host = 'https://synthetic.private.blob.vercel-storage.com/';

function fakeBlob() {
  const files = new Map<string, Buffer>();
  const calls: { op: string; path: string; options: Record<string, unknown> }[] = [];
  const client = {
    async put(path: string, body: Buffer, options: Record<string, unknown>) {
      calls.push({ op: 'put', path, options });
      if (files.has(path)) throw new Error('exists');
      files.set(path, body);
      return { pathname: path, url: host + path };
    },
    async get(path: string, options: Record<string, unknown>) {
      calls.push({ op: 'get', path, options });
      const body = files.get(path);
      if (!body) return null;
      return {
        statusCode: 200,
        blob: { pathname: path, url: host + path, size: body.length },
        stream: new ReadableStream({
          start(c) {
            c.enqueue(new Uint8Array(body));
            c.close();
          },
        }),
      };
    },
    async del(path: string, options: Record<string, unknown>) {
      calls.push({ op: 'del', path, options });
      files.delete(path);
    },
  } as unknown as AvatarBlobClient;
  return { files, calls, client };
}

describe('paths', () => {
  test('only an object uuid and a known size make a path', () => {
    const id = randomUUID();
    expect(avatarPath(id, 'large')).toBe(`avatar/${id}/large`);
    expect(() => avatarPath('../quarantine/x', 'large')).toThrow();
    expect(() => avatarPath(id, 'original' as 'large')).toThrow();
  });
});

describe('the Blob backend', () => {
  test('writes privately without overwrite, reads back, deletes both sizes', async () => {
    const { files, calls, client } = fakeBlob();
    const storage = new AvatarStorage(`vercel-blob:${storeId}`, {
      [`vercel-blob:${storeId}`]: new BlobAvatarBackend(token, 'fra1', storeId, client),
    });
    const id = randomUUID();
    await storage.put(storage.storageRef, id, 'large', Buffer.from('L'));
    await storage.put(storage.storageRef, id, 'small', Buffer.from('S'));
    const put = calls.find((c) => c.op === 'put')!;
    expect(put.options).toMatchObject({
      access: 'private',
      allowOverwrite: false,
      addRandomSuffix: false,
      contentType: 'image/webp',
    });
    await expect(storage.put(storage.storageRef, id, 'large', Buffer.from('X'))).rejects.toThrow();
    expect(Buffer.from(await storage.get(storage.storageRef, id, 'small')).toString()).toBe('S');
    await storage.delete(storage.storageRef, id);
    expect([...files.keys()]).toEqual([]);
    expect(
      calls
        .filter((c) => c.op === 'del')
        .map((c) => c.path)
        .sort(),
    ).toEqual([`avatar/${id}/large`, `avatar/${id}/small`].sort());
  });
  test('refuses a store outside the approved regions or a mismatched token', () => {
    expect(() => new BlobAvatarBackend(token, 'iad1', storeId)).toThrow();
    expect(() => new BlobAvatarBackend('vercel_blob_rw_other_X', 'fra1', storeId)).toThrow();
  });
  test('refuses a read whose answer names another store', async () => {
    const client = {
      ...fakeBlob().client,
      async get(path: string) {
        return {
          statusCode: 200,
          blob: {
            pathname: path,
            url: 'https://other.private.blob.vercel-storage.com/' + path,
            size: 1,
          },
          stream: new ReadableStream({ start: (c) => (c.enqueue(new Uint8Array([1])), c.close()) }),
        };
      },
    } as unknown as AvatarBlobClient;
    const backend = new BlobAvatarBackend(token, 'fra1', storeId, client);
    await expect(backend.get(`avatar/${randomUUID()}/large`)).rejects.toThrow('identity');
  });
});

describe('the S3 backend', () => {
  test('puts with no overwrite and encryption, deletes by key', async () => {
    const sent: { name: string; input: Record<string, unknown> }[] = [];
    const backend = new S3AvatarBackend(
      {
        send: async (command: {
          constructor: { name: string };
          input: Record<string, unknown>;
        }) => {
          sent.push({ name: command.constructor.name, input: command.input });
          return {};
        },
      } as never,
      'synthetic-bucket',
      'eu-central-1',
    );
    await backend.put('avatar/x/large', Buffer.from('L'));
    await backend.delete('avatar/x/large');
    expect(sent[0]).toMatchObject({
      name: 'PutObjectCommand',
      input: { IfNoneMatch: '*', ServerSideEncryption: 'AES256', ContentType: 'image/webp' },
    });
    expect(sent[1]).toMatchObject({
      name: 'DeleteObjectCommand',
      input: { Key: 'avatar/x/large' },
    });
    expect(
      () => new S3AvatarBackend({ send: async () => ({}) } as never, 'b', 'us-east-1'),
    ).toThrow();
  });
});

describe('routing and configuration', () => {
  test('writes go only to the selected store; an unknown reference is refused', async () => {
    const backend: AvatarBackend = {
      put: async () => {},
      get: async () => new Uint8Array(),
      delete: async () => {},
    };
    const storage = new AvatarStorage('s3:bucket-a', {
      's3:bucket-a': backend,
      'vercel-blob:store_x': backend,
    });
    await expect(
      storage.put('vercel-blob:store_x', randomUUID(), 'large', Buffer.from('x')),
    ).rejects.toThrow();
    await expect(storage.get('s3:bucket-b', randomUUID(), 'large')).rejects.toThrow();
    await expect(storage.delete('s3:bucket-a', randomUUID())).resolves.toBeUndefined();
  });
  test('a delete tries both files and reports the failure', async () => {
    const tried: string[] = [];
    const backend: AvatarBackend = {
      put: async () => {},
      get: async () => new Uint8Array(),
      delete: async (path) => {
        tried.push(path);
        if (path.endsWith('large')) throw new Error('down');
      },
    };
    const storage = new AvatarStorage('s3:b', { 's3:b': backend });
    await expect(storage.delete('s3:b', randomUUID())).rejects.toThrow('down');
    expect(tried).toHaveLength(2);
  });
  test('uses the evidence settings and answers null without a store', () => {
    expect(createAvatarStorage({})).toBeNull();
    const s3 = createAvatarStorage({
      EVIDENCE_BUCKET: 'synthetic-bucket',
      EVIDENCE_REGION: 'eu-central-1',
    });
    expect(s3?.storageRef).toBe('s3:synthetic-bucket');
    const blob = createAvatarStorage({
      EVIDENCE_STORAGE_PROVIDER: 'vercel-blob',
      BLOB_READ_WRITE_TOKEN: token,
      BLOB_STORE_ID: storeId,
      EVIDENCE_BLOB_REGION: 'fra1',
    });
    expect(blob?.storageRef).toBe(`vercel-blob:${storeId}`);
    expect(createAvatarStorage({ EVIDENCE_STORAGE_PROVIDER: 'vercel-blob' })).toBeNull();
  });
});
