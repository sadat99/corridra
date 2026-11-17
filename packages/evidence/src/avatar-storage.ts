import { put, get, del } from '@vercel/blob';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { assertPrivateBlobConfiguration, privateBlobHost } from './blob';
import { approvedS3Regions } from './adapters';

// ADR-088. Private object storage for profile pictures, on the same reviewed stores as evidence (the private EU Blob store
// or the EU S3 bucket, configured by the same settings) but under its own path, `avatar/<object id>/<size>`, with delete.
// The evidence router and its quarantine paths are not touched. Nothing here ever returns a provider URL: callers get bytes.
// Each stored file is a re-encoded square WebP of at most 1 MiB.
export const avatarSizes = ['large', 'small'] as const;
export type AvatarSize = (typeof avatarSizes)[number];
export const avatarMaximumBytes = 1048576;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const storageRefPattern = /^(vercel-blob|s3):([a-zA-Z0-9._-]{1,200})$/;

export function avatarPath(objectId: string, size: AvatarSize) {
  if (!uuid.test(objectId) || !avatarSizes.includes(size))
    throw new Error('Invalid picture object path');
  return `avatar/${objectId}/${size}`;
}

export interface AvatarBackend {
  put(path: string, body: Uint8Array): Promise<void>;
  get(path: string): Promise<Uint8Array>;
  delete(path: string): Promise<void>;
}

async function readAll(stream: ReadableStream<Uint8Array>, expected: number) {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > avatarMaximumBytes || length > expected) {
        await reader.cancel();
        throw new Error('Picture size is invalid');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  if (length !== expected) throw new Error('Picture length mismatch');
  return Buffer.concat(chunks);
}

export type AvatarBlobClient = Pick<typeof import('@vercel/blob'), 'put' | 'get' | 'del'>;
export class BlobAvatarBackend implements AvatarBackend {
  constructor(
    private token: string,
    region: string,
    private storeId: string,
    private client: AvatarBlobClient = { put, get, del },
  ) {
    assertPrivateBlobConfiguration(token, region, storeId);
  }
  private confirm(url: string) {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' && parsed.hostname === privateBlobHost(this.storeId);
  }
  async put(path: string, body: Uint8Array) {
    if (!body.length || body.length > avatarMaximumBytes)
      throw new Error('Picture size is invalid');
    const result = await this.client.put(path, Buffer.from(body), {
      token: this.token,
      access: 'private',
      contentType: 'image/webp',
      addRandomSuffix: false,
      allowOverwrite: false,
      cacheControlMaxAge: 60,
      maximumSizeInBytes: avatarMaximumBytes,
      abortSignal: AbortSignal.timeout(15000),
    });
    if (result.pathname !== path || !this.confirm(result.url))
      throw new Error('Private picture storage did not confirm the expected object');
  }
  async get(path: string) {
    const result = await this.client.get(path, {
      token: this.token,
      access: 'private',
      useCache: false,
      abortSignal: AbortSignal.timeout(15000),
    });
    if (!result || result.statusCode !== 200) throw new Error('Picture unavailable');
    const expected = result.blob.size;
    if (
      result.blob.pathname !== path ||
      !this.confirm(result.blob.url) ||
      !Number.isSafeInteger(expected) ||
      expected < 1 ||
      expected > avatarMaximumBytes
    ) {
      await result.stream.cancel();
      throw new Error('Picture storage identity mismatch');
    }
    return readAll(result.stream, expected);
  }
  async delete(path: string) {
    // Deleting a path that is already gone succeeds.
    await this.client.del(path, { token: this.token, abortSignal: AbortSignal.timeout(15000) });
  }
}

export class S3AvatarBackend implements AvatarBackend {
  constructor(
    private client: Pick<S3Client, 'send'>,
    private bucket: string,
    region: string,
  ) {
    if (!approvedS3Regions.includes(region))
      throw new Error('An approved EU storage region is required');
  }
  async put(path: string, body: Uint8Array) {
    if (!body.length || body.length > avatarMaximumBytes)
      throw new Error('Picture size is invalid');
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: path,
        Body: body,
        ContentType: 'image/webp',
        ContentLength: body.length,
        ServerSideEncryption: 'AES256',
        IfNoneMatch: '*',
      }),
    );
  }
  async get(path: string) {
    const r = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: path }));
    if (!r.Body || !r.ContentLength || r.ContentLength > avatarMaximumBytes)
      throw new Error('Picture unavailable');
    return readAll(r.Body.transformToWebStream() as ReadableStream<Uint8Array>, r.ContentLength);
  }
  async delete(path: string) {
    // S3 answers success for a key that is already gone.
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: path }));
  }
}

// Routes each call to the backend named by the stored reference (`vercel-blob:<store id>` or `s3:<bucket>`). Writes go to
// the selected provider only; reads and deletes reach any configured backend, so a provider switch never strands a file.
export class AvatarStorage {
  private backends = new Map<string, AvatarBackend>();
  constructor(
    private writeRef: string,
    backends: Record<string, AvatarBackend>,
  ) {
    for (const [ref, backend] of Object.entries(backends)) {
      if (!storageRefPattern.test(ref)) throw new Error('Invalid storage identifier');
      this.backends.set(ref, backend);
    }
    if (!this.backends.has(writeRef))
      throw new Error('The selected picture storage is not configured');
  }
  get storageRef() {
    return this.writeRef;
  }
  private backend(ref: string) {
    const backend = storageRefPattern.test(ref) ? this.backends.get(ref) : undefined;
    if (!backend) throw new Error('Picture storage reference is unavailable');
    return backend;
  }
  async put(ref: string, objectId: string, size: AvatarSize, body: Uint8Array) {
    if (ref !== this.writeRef) throw new Error('Picture writes use the selected provider');
    await this.backend(ref).put(avatarPath(objectId, size), body);
  }
  async get(ref: string, objectId: string, size: AvatarSize) {
    return this.backend(ref).get(avatarPath(objectId, size));
  }
  // Deletes both files of one object. Both are attempted; the first failure is raised after.
  async delete(ref: string, objectId: string) {
    const backend = this.backend(ref);
    const results = await Promise.allSettled(
      avatarSizes.map((size) => backend.delete(avatarPath(objectId, size))),
    );
    const failed = results.find((r) => r.status === 'rejected');
    if (failed) throw (failed as PromiseRejectedResult).reason;
  }
}

// The same settings as evidence storage (createEvidenceStorage): EVIDENCE_STORAGE_PROVIDER picks where new files go, the
// private EU Blob store (BLOB_READ_WRITE_TOKEN, BLOB_STORE_ID, EVIDENCE_BLOB_REGION) or the EU S3 bucket (EVIDENCE_BUCKET,
// EVIDENCE_REGION). No new setting. Without a configured store this answers null and the picture controls stay unavailable.
export function createAvatarStorage(env: NodeJS.ProcessEnv = process.env) {
  const provider = env.EVIDENCE_STORAGE_PROVIDER ?? 's3';
  if (provider !== 's3' && provider !== 'vercel-blob')
    throw new Error('Unknown evidence storage provider');
  const backends: Record<string, AvatarBackend> = {};
  let blobRef: string | undefined, s3Ref: string | undefined;
  if (env.BLOB_READ_WRITE_TOKEN && env.BLOB_STORE_ID && env.EVIDENCE_BLOB_REGION) {
    blobRef = `vercel-blob:${env.BLOB_STORE_ID}`;
    backends[blobRef] = new BlobAvatarBackend(
      env.BLOB_READ_WRITE_TOKEN,
      env.EVIDENCE_BLOB_REGION,
      env.BLOB_STORE_ID,
    );
  }
  if (env.EVIDENCE_BUCKET && env.EVIDENCE_REGION) {
    s3Ref = `s3:${env.EVIDENCE_BUCKET}`;
    backends[s3Ref] = new S3AvatarBackend(
      new S3Client({ region: env.EVIDENCE_REGION }),
      env.EVIDENCE_BUCKET,
      env.EVIDENCE_REGION,
    );
  }
  const writeRef = provider === 'vercel-blob' ? blobRef : s3Ref;
  if (!writeRef) return null;
  return new AvatarStorage(writeRef, backends);
}
