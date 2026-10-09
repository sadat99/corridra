import 'server-only';
import { Pool, assertRestrictedPool } from '@corridra/db';
import { createIdentity } from '@corridra/auth';
import { AccessService } from '@corridra/auth/access';
import { EvidenceService, type MalwareScanner } from '@corridra/evidence';
import { ClamAvScanner } from '@corridra/evidence/adapters';
import { createEvidenceStorage } from '@corridra/evidence/storage';
import { readFoundationConfig } from '@corridra/config';
import { CounterpartyService } from '@corridra/counterparties';
import { MissionService } from '@corridra/missions';
import { OpportunityService } from '@corridra/opportunities';
import { MeetingService } from '@corridra/missions/meetings';
import { CommunicationService } from '@corridra/communications';
import { SyntheticChannel } from '@corridra/communications/adapters';
import { OutboxDispatcher } from '@corridra/workflows';
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
    basePath: '/api/operator-auth',
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
    counterparties: new CounterpartyService(runtimePool),
    missions: new MissionService(runtimePool, config.AUTH_SECRET),
    meetings: new MeetingService(runtimePool),
    opportunities: new OpportunityService(runtimePool),
    communications: new CommunicationService(runtimePool, config.AUTH_SECRET),
    dispatcher: new OutboxDispatcher(runtimePool, new SyntheticChannel(runtimePool)),
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
