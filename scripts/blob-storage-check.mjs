import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { list, del } from '@vercel/blob';
import { BlobEvidenceStorage } from '../packages/evidence/src/blob.ts';
// Explicit offline synthetic probe only. It never logs the token or touches existing objects.
const token = process.env.BLOB_READ_WRITE_TOKEN;
const storeId = process.env.BLOB_STORE_ID;
assert.equal(process.env.EVIDENCE_BLOB_REGION, 'fra1');
const storage = new BlobEvidenceStorage(token, 'fra1', storeId);
const before = await list({ token, limit: 1, abortSignal: AbortSignal.timeout(15000) });
assert.equal(
  before.blobs.length === 0 && !before.hasMore,
  true,
  'Live acceptance requires an empty dedicated synthetic store',
);
const path = `quarantine/${randomUUID()}/${randomUUID()}`;
const bytes = Buffer.from('%PDF-1.7\nSynthetic Corridra Blob storage acceptance');
const url = `https://${storeId.slice(6).toLowerCase()}.private.blob.vercel-storage.com/${path}`;
let created = false;
try {
  await storage.put(path, bytes, 'application/pdf');
  created = true;
  assert.deepEqual(await storage.get(path), bytes);
  await assert.rejects(storage.put(path, bytes, 'application/pdf'));
  const anonymous = await fetch(url, { signal: AbortSignal.timeout(15000) });
  assert(
    [401, 403, 404].includes(anonymous.status),
    'Private evidence must reject anonymous access',
  );
  await anonymous.body?.cancel();
  const result = {
    checkedAt: new Date().toISOString(),
    storeId,
    region: 'fra1',
    regionEvidence:
      'Owner confirmed the store dashboard setting; administration API remains unavailable',
    privateReadWrite: true,
    anonymousStatus: anonymous.status,
    createOnly: true,
    hashAndLengthRoundTrip: true,
  };
  await del(path, { token, abortSignal: AbortSignal.timeout(15000) });
  created = false;
  const after = await list({ token, limit: 1, abortSignal: AbortSignal.timeout(15000) });
  assert.equal(after.blobs.length === 0 && !after.hasMore, true);
  result.probeObjectDeleted = true;
  await writeFile('.cache/part03-blob-validation.json', JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result));
} finally {
  if (created) await del(path, { token, abortSignal: AbortSignal.timeout(15000) });
}
