import 'server-only';
import { Pool, assertRestrictedPool } from '@corridra/db';
import { createIdentity } from '@corridra/auth';
import { AccessService } from '@corridra/auth/access';
import { EvidenceService, type MalwareScanner } from '@corridra/evidence';
import { ClamAvScanner } from '@corridra/evidence/adapters';
import { createEvidenceStorage } from '@corridra/evidence/storage';
import { readFoundationConfig } from '@corridra/config';
let singleton: ReturnType<typeof createServices> | undefined;
function createServices() {
  const config = readFoundationConfig();
  if (!config) return null;
  const runtimePool = new Pool({
    connectionString: config.RUNTIME_DATABASE_URL,
    max: 5,
    connectionTimeoutMillis: 5000,
  });
  const authPool = new Pool({
    connectionString: config.AUTH_DATABASE_URL,
    max: 3,
    connectionTimeoutMillis: 5000,
  });
  const identity = createIdentity({
    pool: authPool,
    secret: config.AUTH_SECRET,
    baseURL: config.APP_ORIGIN,
  });
  const configuredStorage = createEvidenceStorage();
  const storage = configuredStorage ?? {
    async put() {
      throw new Error('Evidence storage is not configured');
    },
    async get() {
      throw new Error('Evidence storage is not configured');
    },
  };
  let scanner: MalwareScanner = {
    async scan() {
      return { verdict: 'ERROR', engine: 'unconfigured' };
    },
  };
  if (process.env.CLAMAV_HOST)
    scanner = new ClamAvScanner(process.env.CLAMAV_HOST, Number(process.env.CLAMAV_PORT ?? 3310));
  const ready = Promise.all([
    assertRestrictedPool(runtimePool),
    assertRestrictedPool(authPool, 'corridra_auth'),
  ]);
  return {
    config,
    ...identity,
    access: new AccessService(runtimePool),
    evidence: new EvidenceService(
      runtimePool,
      storage,
      scanner,
      config.EVIDENCE_SCAN_MODE === 'bypass',
    ),
    ready,
    scanMode: config.EVIDENCE_SCAN_MODE,
    uploadsConfigured:
      !!configuredStorage && (config.EVIDENCE_SCAN_MODE === 'bypass' || !!process.env.CLAMAV_HOST),
  };
}
export function foundations() {
  if (singleton === undefined) singleton = createServices();
  return singleton;
}
