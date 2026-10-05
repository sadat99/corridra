import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { createEvidenceStorage, copyEvidenceToS3 } from '../packages/evidence/src/storage';
import { S3Client, S3EvidenceStorage } from '../packages/evidence/src/adapters';

// Separate, explicitly invoked synthetic migration. Never an app/build hook.
const env = z
  .object({
    DATA_ENVIRONMENT: z.literal('synthetic'),
    EVIDENCE_STORAGE_PROVIDER: z.literal('s3'),
    BLOB_STORE_ID: z.string().regex(/^store_[a-zA-Z0-9]+$/),
    BLOB_READ_WRITE_TOKEN: z.string().min(1),
    EVIDENCE_BLOB_REGION: z.string().min(1),
    EVIDENCE_BUCKET: z.string().min(1),
    EVIDENCE_REGION: z.string().min(1),
  })
  .parse(process.env);
if (process.env.EVIDENCE_MIGRATED_BLOB_STORE_ID)
  throw new Error('Copy and reconcile before enabling migrated Blob reads');
const [manifestPath] = process.argv.slice(2);
if (!manifestPath || !/^\.cache\/[a-zA-Z0-9_-]+\.json$/.test(manifestPath))
  throw new Error('Supply a reviewed migration manifest in ignored .cache');
const content = await readFile(manifestPath, 'utf8');
const manifest = z
  .object({
    sourceStoreId: z.literal(env.BLOB_STORE_ID),
    dataEnvironment: z.literal('synthetic'),
    targetBucket: z.literal(env.EVIDENCE_BUCKET),
    records: z
      .array(
        z.object({
          objectKey: z.string().startsWith(`vercel-blob:${env.BLOB_STORE_ID}:quarantine/`),
          mime: z.enum(['application/pdf', 'image/png', 'image/jpeg']),
          sha256: z.string().regex(/^[a-f0-9]{64}$/),
          size: z.number().int().min(1).max(4194304),
        }),
      )
      .min(1),
  })
  .parse(JSON.parse(content));
if (new Set(manifest.records.map((r) => r.objectKey)).size !== manifest.records.length)
  throw new Error('The manifest contains duplicate evidence references');
const source = createEvidenceStorage({ ...process.env, EVIDENCE_STORAGE_PROVIDER: 'vercel-blob' });
if (!source) throw new Error('Source Blob storage is unavailable');
const client = new S3Client({ region: env.EVIDENCE_REGION });
const target = new S3EvidenceStorage(client, env.EVIDENCE_BUCKET, env.EVIDENCE_REGION);
try {
  for (const record of manifest.records) await copyEvidenceToS3(source, target, record);
  await mkdir('.cache', { recursive: true });
  const evidence = {
    checkedAt: new Date().toISOString(),
    sourceStoreId: env.BLOB_STORE_ID,
    targetBucket: env.EVIDENCE_BUCKET,
    targetRegion: env.EVIDENCE_REGION,
    manifestSha256: createHash('sha256').update(content).digest('hex'),
    copiedAndVerified: manifest.records.length,
    databaseRecordsChanged: 0,
    sourceObjectsDeleted: 0,
  };
  await writeFile(
    '.cache/evidence-s3-migration-result.json',
    JSON.stringify(evidence, null, 2) + '\n',
  );
  console.log(JSON.stringify(evidence));
} finally {
  client.destroy();
}
