import 'server-only';
import { recoverableResource } from './recoverable-resource';
import { localFixtureAdapter } from '@corridra/intelligence/local-fixture';
import { IntelligenceService } from '@corridra/intelligence/service';
import { NetworkService } from '@corridra/network';
import { Pool, assertRestrictedPool } from '@corridra/db';
import { createIdentity } from '@corridra/auth';
import { operatorRecoveryMailer } from '@corridra/auth/recovery-mail';
import { OperatorSetup } from '@corridra/auth/operator-setup';
import { AccessService } from '@corridra/auth/access';
import { EvidenceService, type MalwareScanner } from '@corridra/evidence';
import { ClamAvScanner } from '@corridra/evidence/adapters';
import { createEvidenceStorage } from '@corridra/evidence/storage';
import { readFoundationConfig } from '@corridra/config';
import { CounterpartyService } from '@corridra/counterparties';
import { MissionService } from '@corridra/missions';
import { DeliveryService } from '@corridra/delivery';
import { DeliveryExperienceService } from '@corridra/delivery/experience';
import { OpportunityService } from '@corridra/opportunities';
import { MeetingService } from '@corridra/missions/meetings';
import { CommercialMissionService } from '@corridra/missions/commercial';
import { CorridorService } from '@corridra/missions/corridors';
import { OperationsService } from '@corridra/missions/operations';
import { CommunicationService } from '@corridra/communications';
import { SyntheticChannel } from '@corridra/communications/adapters';
import { OutboxDispatcher } from '@corridra/workflows';
function createServices() {
  const config = readFoundationConfig();
  if (!config) return null;
  const runtimePool = new Pool({
    connectionString: config.RUNTIME_DATABASE_URL,
    max: 5,
    connectionTimeoutMillis: 15000,
  });
  const authPool = new Pool({
    connectionString: config.AUTH_DATABASE_URL,
    max: 3,
    connectionTimeoutMillis: 15000,
  });
  const identity = createIdentity({
    pool: authPool,
    secret: config.AUTH_SECRET,
    baseURL: config.APP_ORIGIN,
    basePath: '/api/operator-auth',
    sendPasswordRecovery: operatorRecoveryMailer(),
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
  let inferenceAdapter;
  let aiEnabled = process.env.CORRIDRA_AI_ENABLED === 'true';
  try {
    inferenceAdapter = localFixtureAdapter(
      config.DATABASE_REGION,
      process.env.VERCEL_ENV,
      process.env.CORRIDRA_AI_FIXTURE_URL,
    );
  } catch {
    aiEnabled = false;
  }
  const ready = Promise.all([
    assertRestrictedPool(runtimePool),
    assertRestrictedPool(authPool, 'corridra_auth'),
  ]);
  void ready.catch(() => {
    void Promise.allSettled([runtimePool.end(), authPool.end()]);
  });
  return {
    config,
    ...identity,
    operatorSetup: new OperatorSetup(authPool),
    access: new AccessService(runtimePool, authPool),
    intelligence: new IntelligenceService(runtimePool, aiEnabled, inferenceAdapter),
    network: new NetworkService(runtimePool, process.env.CORRIDRA_NETWORK_ENABLED === 'true'),
    counterparties: new CounterpartyService(runtimePool),
    missions: new MissionService(runtimePool, config.AUTH_SECRET),
    delivery: new DeliveryService(
      runtimePool,
      new MissionService(runtimePool, config.AUTH_SECRET),
      config.AUTH_SECRET,
    ),
    deliveryExperience: new DeliveryExperienceService(runtimePool),
    meetings: new MeetingService(runtimePool),
    commercialMissions: new CommercialMissionService(runtimePool),
    corridors: new CorridorService(runtimePool),
    operations: new OperationsService(runtimePool),
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
export const foundations = recoverableResource(createServices);
