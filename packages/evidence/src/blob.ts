import { put, get } from '@vercel/blob';
import type { ObjectStorage } from './index';

export type BlobClient = Pick<typeof import('@vercel/blob'), 'put' | 'get'>;
const maximumBytes = 4194304;
export class BlobEvidenceStorage implements ObjectStorage {
  constructor(
    private token: string,
    private region: string,
    private storeId: string,
    private client: BlobClient = { put, get },
  ) {
    // The SDK cannot attest region. Configuration must match the reviewed store settings.
    if (!['fra1', 'cdg1', 'dub1', 'arn1', 'mad1'].includes(region))
      throw new Error('An approved EU Blob region is required');
    if (!token) throw new Error('Private Blob credentials are required');
    if (!/^store_[a-zA-Z0-9]+$/.test(storeId))
      throw new Error('An explicit Blob store ID is required');
    // Match the pinned SDK's read-write token store selector before any network write.
    if (
      !token.startsWith('vercel_blob_rw_') ||
      token.split('_')[3]?.toLowerCase() !== storeId.slice(6).toLowerCase()
    )
      throw new Error('Blob credentials do not match the selected store');
  }
  private path(key: string) {
    // SDK reads accept URLs too. Only internal paths may reach it from this adapter.
    if (!/^quarantine\/[a-zA-Z0-9-]+\/[a-zA-Z0-9-]+$/.test(key))
      throw new Error('Invalid evidence object path');
    return key;
  }
  async put(key: string, body: Uint8Array, mime: string) {
    if (!body.length || body.length > maximumBytes) throw new Error('Evidence size is invalid');
    const path = this.path(key);
    const result = await this.client.put(path, Buffer.from(body), {
      token: this.token,
      access: 'private',
      contentType: mime,
      addRandomSuffix: false,
      allowOverwrite: false,
      cacheControlMaxAge: 60,
      maximumSizeInBytes: maximumBytes,
      abortSignal: AbortSignal.timeout(15000),
    });
    if (
      result.pathname !== path ||
      new URL(result.url).protocol !== 'https:' ||
      new URL(result.url).hostname !==
        `${this.storeId.slice(6).toLowerCase()}.private.blob.vercel-storage.com`
    )
      throw new Error('Private evidence storage did not confirm the expected object');
  }
  async get(key: string) {
    const result = await this.client.get(this.path(key), {
      token: this.token,
      access: 'private',
      useCache: false,
      abortSignal: AbortSignal.timeout(15000),
    });
    if (!result || result.statusCode !== 200) throw new Error('Evidence object unavailable');
    if (
      result.blob.pathname !== key ||
      new URL(result.blob.url).protocol !== 'https:' ||
      new URL(result.blob.url).hostname !==
        `${this.storeId.slice(6).toLowerCase()}.private.blob.vercel-storage.com`
    ) {
      await result.stream.cancel();
      throw new Error('Evidence storage identity mismatch');
    }
    const expected = result.blob.size;
    if (!Number.isSafeInteger(expected) || expected < 1 || expected > maximumBytes) {
      await result.stream.cancel();
      throw new Error('Evidence size is invalid');
    }
    const reader = result.stream.getReader();
    const chunks: Uint8Array[] = [];
    let length = 0;
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        length += value.length;
        if (length > maximumBytes || length > expected) {
          await reader.cancel();
          throw new Error('Evidence size is invalid');
        }
        chunks.push(value);
      }
      if (length !== expected) throw new Error('Evidence length mismatch');
      return Buffer.concat(chunks);
    } finally {
      reader.releaseLock();
    }
  }
}
