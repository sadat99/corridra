import { createHash } from 'node:crypto';
import { BlobEvidenceStorage } from './blob';
import { S3Client, S3EvidenceStorage } from './adapters';
import type { ObjectStorage } from './index';

type Backend = { id: string; storage: ObjectStorage };
export type StorageProvider = 'vercel-blob' | 's3';
export class EvidenceStorageRouter implements ObjectStorage {
  constructor(
    private primary: StorageProvider,
    private blob?: Backend,
    private s3?: Backend,
    private migratedBlobStoreId?: string,
  ) {
    if (!(primary === 'vercel-blob' ? blob : s3))
      throw new Error('The selected evidence storage is not configured');
    if (migratedBlobStoreId && (primary !== 's3' || !s3))
      throw new Error('Migrated Blob reads require S3');
    for (const backend of [blob, s3])
      if (backend && !/^[a-zA-Z0-9._-]+$/.test(backend.id))
        throw new Error('Invalid storage identifier');
  }
  objectKey(path: string) {
    if (!/^quarantine\/[a-zA-Z0-9-]+\/[a-zA-Z0-9-]+$/.test(path))
      throw new Error('Invalid evidence object path');
    const backend = this.primary === 'vercel-blob' ? this.blob! : this.s3!;
    return `${this.primary}:${backend.id}:${path}`;
  }
  private route(key: string, write: boolean) {
    // Existing unqualified keys remain S3 objects in the configured legacy bucket.
    if (/^quarantine\/[a-zA-Z0-9-]+\/[a-zA-Z0-9-]+$/.test(key) && this.s3 && !write)
      return { storage: this.s3.storage, path: key };
    const match =
      /^(vercel-blob|s3):([a-zA-Z0-9._-]+):(quarantine\/[a-zA-Z0-9-]+\/[a-zA-Z0-9-]+)$/.exec(key);
    if (!match) throw new Error('Invalid evidence storage reference');
    const [, provider, id, path] = match;
    if (write && provider !== this.primary)
      throw new Error('Storage writes use the selected provider');
    if (!write && provider === 'vercel-blob' && id === this.migratedBlobStoreId && this.s3)
      return { storage: this.s3.storage, path };
    const backend = provider === 'vercel-blob' ? this.blob : this.s3;
    if (!backend || id !== backend.id) throw new Error('Evidence storage reference is unavailable');
    return { storage: backend.storage, path };
  }
  async put(key: string, body: Uint8Array, mime: string) {
    const target = this.route(key, true);
    await target.storage.put(target.path, body, mime);
  }
  async get(key: string) {
    const target = this.route(key, false);
    return target.storage.get(target.path);
  }
}

export function createEvidenceStorage(env: NodeJS.ProcessEnv = process.env) {
  const provider = env.EVIDENCE_STORAGE_PROVIDER ?? 's3';
  if (provider !== 's3' && provider !== 'vercel-blob')
    throw new Error('Unknown evidence storage provider');
  let blob: Backend | undefined, s3: Backend | undefined;
  if (provider === 'vercel-blob' || env.EVIDENCE_BLOB_READS_ENABLED === 'true') {
    if (!env.BLOB_READ_WRITE_TOKEN || !env.BLOB_STORE_ID || !env.EVIDENCE_BLOB_REGION)
      throw new Error('Private EU Blob configuration is incomplete');
    blob = {
      id: env.BLOB_STORE_ID,
      storage: new BlobEvidenceStorage(
        env.BLOB_READ_WRITE_TOKEN,
        env.EVIDENCE_BLOB_REGION,
        env.BLOB_STORE_ID,
      ),
    };
  }
  if (env.EVIDENCE_BUCKET || env.EVIDENCE_REGION) {
    if (!env.EVIDENCE_BUCKET || !env.EVIDENCE_REGION)
      throw new Error('S3 configuration is incomplete');
    s3 = {
      id: env.EVIDENCE_BUCKET,
      storage: new S3EvidenceStorage(
        new S3Client({ region: env.EVIDENCE_REGION }),
        env.EVIDENCE_BUCKET,
        env.EVIDENCE_REGION,
      ),
    };
  }
  if (provider === 's3' && !s3 && !env.EVIDENCE_MIGRATED_BLOB_STORE_ID) return null;
  return new EvidenceStorageRouter(provider, blob, s3, env.EVIDENCE_MIGRATED_BLOB_STORE_ID);
}

// Offline migration primitive. Immutable database references and original bytes stay unchanged.
export async function copyEvidenceToS3(
  source: ObjectStorage,
  target: ObjectStorage,
  record: { objectKey: string; mime: string; sha256: string; size: number },
) {
  const match = /^vercel-blob:[a-zA-Z0-9._-]+:(quarantine\/[a-zA-Z0-9-]+\/[a-zA-Z0-9-]+)$/.exec(
    record.objectKey,
  );
  if (
    !match ||
    !/^[a-f0-9]{64}$/.test(record.sha256) ||
    !Number.isSafeInteger(record.size) ||
    record.size < 1 ||
    record.size > 4194304
  )
    throw new Error('Invalid migration manifest');
  const valid = (body: Uint8Array) =>
    body.length === record.size &&
    createHash('sha256').update(body).digest('hex') === record.sha256;
  const body = await source.get(record.objectKey);
  if (!valid(body)) throw new Error('Source evidence integrity check failed');
  const path = match[1];
  try {
    await target.put(path, body, record.mime);
  } catch (error) {
    // A resumed migration may find an already-copied immutable object. Never overwrite it.
    if (!valid(await target.get(path))) throw error;
  }
  if (!valid(await target.get(path))) throw new Error('Copied evidence integrity check failed');
}
