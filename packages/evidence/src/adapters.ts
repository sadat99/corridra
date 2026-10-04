import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { createConnection } from 'node:net';
import type { ObjectStorage, MalwareScanner } from './index';
export class S3EvidenceStorage implements ObjectStorage {
  constructor(
    private client: S3Client,
    private bucket: string,
    private region: string,
  ) {
    if (
      ![
        'eu-central-1',
        'eu-west-1',
        'eu-west-3',
        'eu-north-1',
        'eu-south-1',
        'eu-south-2',
      ].includes(region)
    )
      throw new Error('An approved EU storage region is required');
  }
  async put(key: string, body: Uint8Array, mime: string) {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: mime,
        ContentLength: body.length,
        ServerSideEncryption: 'AES256',
        IfNoneMatch: '*',
        Metadata: { region: this.region },
      }),
    );
  }
  async get(key: string) {
    const r = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    if (!r.Body || !r.ContentLength || r.ContentLength > 4194304)
      throw new Error('Evidence object unavailable');
    const reader = r.Body.transformToWebStream().getReader();
    const chunks: Uint8Array[] = [];
    let length = 0;
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > 4194304) {
        await reader.cancel();
        throw new Error('Evidence object exceeds the size limit');
      }
      chunks.push(value);
    }
    if (length !== r.ContentLength) throw new Error('Evidence object length mismatch');
    return Buffer.concat(chunks);
  }
}
export class ClamAvScanner implements MalwareScanner {
  constructor(
    private host: string,
    private port = 3310,
    private timeoutMs = 15000,
  ) {}
  async scan(
    body: Uint8Array,
  ): Promise<{ verdict: 'CLEAN' | 'INFECTED' | 'ERROR'; engine: string }> {
    if (body.length > 4194304) return { verdict: 'ERROR', engine: 'clamav' };
    return new Promise((resolve) => {
      let answer = '';
      let done = false;
      const finish = (verdict: 'CLEAN' | 'INFECTED' | 'ERROR') => {
        if (done) return;
        done = true;
        socket.destroy();
        resolve({ verdict, engine: 'clamav' });
      };
      const socket = createConnection({ host: this.host, port: this.port });
      socket.setTimeout(this.timeoutMs, () => finish('ERROR'));
      socket.on('error', () => finish('ERROR'));
      socket.on('connect', () => {
        socket.write('zINSTREAM\0');
        for (let at = 0; at < body.length; at += 65536) {
          const chunk = body.subarray(at, at + 65536);
          const size = Buffer.alloc(4);
          size.writeUInt32BE(chunk.length);
          socket.write(size);
          socket.write(chunk);
        }
        socket.write(Buffer.alloc(4));
      });
      socket.on('data', (chunk) => {
        answer += chunk.toString('utf8');
        if (answer.length > 2048) {
          finish('ERROR');
          return;
        }
        if (answer.includes('\0'))
          finish(
            /^stream: OK\0$/.test(answer)
              ? 'CLEAN'
              : / FOUND\0$/.test(answer)
                ? 'INFECTED'
                : 'ERROR',
          );
      });
      socket.on('end', () => finish('ERROR'));
      socket.on('close', () => finish('ERROR'));
    });
  }
}
export { S3Client };
