import { randomUUID } from 'node:crypto';
import { beforeAll, afterAll, test, expect } from 'vitest';
import { commercialFixture } from './commercial-fixture';
import { rawContext } from './support';
import { AccessService } from '../../packages/auth/src/access';
import { CorridorService, initialRouteConfiguration } from '../../packages/missions/src/corridors';
import { initialRoutes } from '../../packages/domain/src/corridors';
import { NetworkService } from '../../packages/network/src/index';
import { IntelligenceService } from '../../packages/intelligence/src/service';
import { CommercialMissionService } from '../../packages/missions/src/commercial';
import { missionCatalogue, machineryFields } from '../../packages/domain/src/commercial-missions';
import { command as commercialCommand } from './access-fixture';
import { taskIds } from '../../packages/intelligence/src/registry';
let f: Awaited<ReturnType<typeof commercialFixture>>,
  routes: CorridorService,
  network: NetworkService,
  ai: IntelligenceService;
let calls = 0;
const reason = 'Synthetic revised Part 4 validation';
const later = (days: number) => new Date(Date.now() + days * 86400000).toISOString();
beforeAll(async () => {
  f = await commercialFixture();
  routes = new CorridorService(f.runtime);
  network = new NetworkService(f.runtime, true);
  ai = new IntelligenceService(f.runtime, true, {
    async generate(r) {
      calls++;
      const p = JSON.parse(r.prompt);
      const s = p.untrustedSources[0];
      return {
        output: {
          authority: 'UNVERIFIED_DRAFT',
          facts: [s],
          unknowns: ['Synthetic draft; acceptance unknown'],
          data: { proposedIntent: 'Review a synthetic machine', fields: [] },
        },
        inputTokens: 100,
        outputTokens: 100,
      };
    },
  });
  await routes.installTemplates(f.users.owner.ctx);
  const access = new AccessService(f.runtime);
  await access.appendConfig(f.users.owner.ctx, { key: 'network.enabled', enabled: true });
  await access.appendConfig(f.users.owner.ctx, { key: 'ai.enabled', enabled: true });
});
afterAll(async () => {
  await f?.close();
});
async function setup(
  origin = 'BD',
  destination = 'CN',
  type = 'machinery_procurement',
  aiPolicyId: string | null = null,
) {
  const t = await f.target(destination);
  const routeId = randomUUID(),
    packId = randomUUID(),
    assignmentId = randomUUID();
  const existing = (
    await f.owner.query(
      'SELECT id FROM app.corridor_route WHERE tenant_id=$1 AND origin_market=$2 AND destination_market=$3',
      [f.tenantA, origin, destination],
    )
  ).rows[0];
  if (!existing)
    await routes.createRoute(f.users.owner.ctx, { id: routeId, origin, destination, reason });
  const actualRoute = existing?.id ?? routeId;
  const v =
    (
      await f.owner.query(
        'SELECT coalesce(max(version),0)::int n FROM app.corridor_pack_version WHERE tenant_id=$1 AND route_id=$2',
        [f.tenantA, actualRoute],
      )
    ).rows[0].n + 1;
  const definitions = await routes.catalogue(f.users.owner.ctx);
  await routes.appendPack(f.users.owner.ctx, {
    id: packId,
    routeId: actualRoute,
    version: v,
    status: 'TESTING',
    effectiveFrom: new Date().toISOString(),
    configuration: {
      ...initialRouteConfiguration(initialRoutes[2]),
      missionTypes: [type],
      requirements: [definitions.requirements.find((r) => r.schema.typeKey === type)!.id],
      assessments: [definitions.assessments.find((r) => r.schema.typeKey === type)!.id],
      requiredCapabilities: ['supplier_research'],
      aiPolicyRef: aiPolicyId,
    },
    reason,
  });
  const catalogue = await routes.catalogue(f.users.owner.ctx);
  await routes.assign(f.users.owner.ctx, {
    id: assignmentId,
    missionId: t.missionId,
    packId,
    missionTypeId: catalogue.types.find((x) => x.key === type)!.id,
    version: 1,
    reason,
  });
  return { t, routeId: actualRoute, packId, assignmentId };
}
async function profile(markets = ['CN'], workCountries = ['BD']) {
  const source = await f.evidence.createSource(f.ctx, {
    kind: 'observation',
    locator: 'Synthetic reviewed invitation and eligibility, no real legal approval',
    observedAt: new Date().toISOString(),
    classification: 'INTERNAL',
    purpose: 'synthetic_validation',
    retentionUntil: later(20),
    aiPolicy: 'DENY',
  });
  const id = randomUUID();
  const last = (
    await f.owner.query(
      'SELECT coalesce(max(version),0)::int n FROM app.network_profile WHERE tenant_id=$1 AND principal_id=$2',
      [f.tenantA, f.users.outsider.id],
    )
  ).rows[0].n;
  const input = {
    id,
    principalId: f.users.outsider.id,
    version: last + 1,
    alias: 'Synthetic invited specialist',
    categories: ['technical_adviser'],
    capabilities: ['supplier_research'],
    markets,
    languages: ['en'],
    sectors: ['machinery'],
    workCountries,
    available: true,
    status: 'ACTIVE',
    eligibilitySourceId: source.id,
    expiresAt: later(10),
    reason,
  };
  await network.profile(f.users.owner.ctx, input);
  return input;
}
async function task(
  j: Awaited<ReturnType<typeof setup>>,
  market = 'CN',
  workCountry = 'BD',
  rewardRuleId: string | null = null,
) {
  const id = randomUUID();
  await network.task(f.ctx, {
    id,
    missionId: j.t.missionId,
    routeAssignmentId: j.assignmentId,
    kind: 'supplier_research',
    market,
    workCountry,
    location: 'Declared remote support location',
    language: 'en',
    sector: 'machinery',
    capabilities: ['supplier_research'],
    instructions: 'Inspect the disclosed synthetic machine capacity statement only.',
    deadline: later(2),
    expiresAt: later(3),
    evidenceRequired: 'A scoped source-reported capacity statement',
    effort: 'Expected two hours; no guaranteed earnings',
    dataHandling: 'Use only disclosed synthetic task data; no contact sharing',
    cancellationTerms: 'Owner may cancel open work with a reason',
    disputeTerms: 'Submit a task dispute for independent reviewer decision',
    reviewerId: f.users.reviewer.id,
    rewardRuleId,
    reason,
  });
  return id;
}
const event = (
  taskId: string,
  version: number,
  action: string,
  details: unknown = { kind: 'decision' },
) => ({ commandId: randomUUID(), taskId, version, action, details, reason });
test('combined China machine journey: human AI review, restricted non-member work, review, existing contribution and ledger once', async () => {
  const source = (
    await f.evidence.createSource(f.ctx, {
      kind: 'public_record',
      locator: 'Synthetic public capacity fixture',
      observedAt: new Date().toISOString(),
      classification: 'PUBLIC',
      purpose: 'synthetic_validation',
      retentionUntil: later(10),
      aiPolicy: 'REVIEW_REQUIRED',
    })
  ).id;
  const claim = (
    await f.evidence.createClaim(f.ctx, {
      sourceId: source,
      statement: 'Synthetic machine capacity is 100 units per hour.',
    })
  ).id;
  await rawContext(
    f.runtime,
    f.users.owner.ctx,
    `INSERT INTO app.data_rights_policy(id,tenant_id,source_id,version,licence,permitted_reuse,data_role,data_purpose,data_classification,jurisdictions,subject_locations,processing_locations,retention_until,ai_permission,transfer_status,transfer_mechanism,effective_from,reason,created_by) VALUES($1,$2,$3,1,'Synthetic test-only licence',ARRAY['AI_REVIEW'],'CONTROLLER','synthetic_validation','PUBLIC',ARRAY['DE'],ARRAY[]::text[],ARRAY['DE'],$4,'REVIEW_REQUIRED','APPROVED','Synthetic test review',now(),$5,$6)`,
    [randomUUID(), f.tenantA, source, later(9), reason, f.users.owner.id],
  );
  const policyId = randomUUID();
  await ai.configure(f.users.owner.ctx, {
    policy: {
      id: policyId,
      version: 1,
      adapter: 'openai',
      model: 'synthetic-golden-v1',
      secretRef: 'CORRIDRA_OPENAI_API_KEY',
      approved: true,
      evaluationStatus: 'SYNTHETIC_ONLY',
      evaluationSourceId: source,
      processingLocations: ['DE'],
      tasks: [...taskIds],
      inputRateMinorPerMillion: '100',
      outputRateMinorPerMillion: '200',
      maxCostMinor: '100',
      currency: 'USD',
      effectiveUntil: later(5),
    },
    key: 'synthetic-golden',
    termsSourceId: source,
    dailyBudgetMinor: '1000',
    effectiveFrom: new Date().toISOString(),
    reason,
  });
  const j = await setup('BD', 'CN', 'machinery_procurement', policyId);
  const command = {
    commandId: randomUUID(),
    missionId: j.t.missionId,
    policyId,
    input: { task: 'commercial_intent', schemaVersion: 1, claimIds: [claim] },
  };
  await expect(ai.run(f.users.other.ctx, command)).rejects.toThrow();
  await expect(ai.run(f.users.viewer.ctx, command)).rejects.toThrow();
  expect(calls).toBe(0);
  const result = await ai.run(f.ctx, command);
  expect('output' in result && result.output).toBeTruthy();
  expect(calls).toBe(1);
  await ai.run(f.ctx, command);
  expect(calls).toBe(1);
  const draft = (await ai.workspace(f.ctx)).drafts.find((x) => x.run_id === command.commandId)!;
  await ai.review(f.users.reviewer.ctx, {
    commandId: randomUUID(),
    resultId: draft.result_id,
    decision: 'ACCEPT',
    reason,
  });
  const commercial = new CommercialMissionService(f.runtime),
    definitions = await routes.catalogue(f.users.owner.ctx);
  const humanSource = (
    await f.evidence.createSource(f.ctx, {
      kind: 'self_declaration',
      locator: `Human reviewed draft ${draft.result_id}; original source ${source}; original claim ${claim}`,
      observedAt: new Date().toISOString(),
      classification: 'INTERNAL',
      purpose: 'synthetic_validation',
      retentionUntil: later(3),
      aiPolicy: 'DENY',
    })
  ).id;
  const humanClaim = (
    await f.evidence.createClaim(f.ctx, {
      sourceId: humanSource,
      statement:
        'Human declared requirement: source-reported capacity 100 units per hour; independent acceptance unknown.',
    })
  ).id;
  const requirement = await commercial.command(
    f.ctx,
    commercialCommand('requirements', {
      missionId: j.t.missionId,
      sourceId: humanSource,
      claimId: humanClaim,
      assignmentId: j.assignmentId,
      definitionId: definitions.requirements.find(
        (r) => r.schema.typeKey === 'machinery_procurement',
      )!.id,
      version: 1,
      schemaVersion: 1,
      declaration: 'Human reviewed original synthetic request; AI acceptance executes no command',
      fields: {
        objective: 'Assess synthetic machine suppliers',
        role: 'IMPORTER',
        product: 'Synthetic production machine',
        machinery: {
          capacity: '100 units per hour',
          acceptance: 'Acceptance evidence remains unknown',
        },
      },
      reason,
    }),
  );
  const p = await profile();
  const ruleId = randomUUID();
  await rawContext(
    f.runtime,
    f.users.owner.ctx,
    "INSERT INTO app.reward_rule_version(id,tenant_id,key,version,amount_minor,currency,effective_from,effective_until,reason,created_by) VALUES($1,$2,$3,1,1000,'CNY',now()-interval '1 day',now()+interval '10 days',$4,$5)",
    [ruleId, f.tenantA, 'network-synthetic', reason, f.users.owner.id],
  );
  const id = await task(j, 'CN', 'BD', ruleId);
  await network.event(
    f.users.owner.ctx,
    event(id, 0, 'ASSIGN', {
      kind: 'assignment',
      profileId: p.id,
      relationshipDisclosure:
        'Synthetic invited engineer; no undisclosed counterparty relationship',
    }),
  );
  const board = await network.mine(f.users.outsider.ctx);
  expect(board[0].reward.amountMinor).toBe('1000');
  expect(board[0].reward.paymentGuaranteed).toBe(false);
  expect(JSON.stringify(board)).not.toContain('brief');
  expect(
    (await rawContext(f.runtime, f.users.outsider.ctx, 'SELECT * FROM app.mission')).rowCount,
  ).toBe(0);
  expect(
    (await rawContext(f.runtime, f.users.outsider.ctx, 'SELECT * FROM app.network_task')).rowCount,
  ).toBe(0);
  expect(await network.mine(f.users.other.ctx)).toEqual([]);
  const accept = event(id, 1, 'ACCEPT');
  await network.event(f.users.outsider.ctx, accept);
  expect((await network.event(f.users.outsider.ctx, accept)).duplicate).toBe(true);
  await expect(network.event(f.users.outsider.ctx, event(id, 1, 'ACCEPT'))).rejects.toThrow();
  await network.event(
    f.users.outsider.ctx,
    event(id, 2, 'SUBMIT', {
      kind: 'submission',
      body: 'Original synthetic declaration: capacity is source-reported, not verified.',
    }),
  );
  await expect(network.event(f.users.outsider.ctx, event(id, 3, 'COMPLETE'))).rejects.toThrow();
  const review = await network.reviewSubmission(f.users.reviewer.ctx, {
    commandId: randomUUID(),
    taskId: id,
    version: 3,
    evidenceQuality: 3,
    timeliness: 4,
    rationale: 'Original declaration preserved; no independent verification',
    reason,
  });
  expect(review.verification).toBe('UNVERIFIED_DECLARATION');
  await network.event(f.users.reviewer.ctx, event(id, 4, 'COMPLETE'));
  const assessment = await commercial.command(
    f.ctx,
    commercialCommand('assessment', {
      missionId: j.t.missionId,
      sourceId: review.sourceId,
      claimId: review.claimId,
      requirementId: requirement.id,
      definitionId: definitions.assessments.find(
        (r) => r.schema.typeKey === 'machinery_procurement',
      )!.id,
      targetId: j.t.targetId,
      version: 1,
      method: 'Independent human review of source-reported work',
      observedAt: new Date().toISOString(),
      results: [
        ...missionCatalogue.find((t) => t.key === 'machinery_procurement')!.criteria,
        'evidence_completeness',
      ].map((criterion) => ({
        criterion,
        result: 'UNKNOWN',
        requirement: 'Declared machine capacity and suitability',
        basis: 'Contributor declaration is recorded; independent proof is absent',
      })),
      technicalResults: machineryFields.map((field) => ({
        field,
        result: 'UNKNOWN',
        basis: 'No independent technical evidence is supplied',
      })),
      unknowns: 'Technical acceptance unknown',
      gaps: 'Independent engineering evidence absent',
      rationale: 'Source-reported work supports further review only',
      reason,
    }),
  );
  await commercial.command(
    f.ctx,
    commercialCommand('decision', {
      missionId: j.t.missionId,
      sourceId: review.sourceId,
      claimId: review.claimId,
      requirementId: requirement.id,
      targetId: j.t.targetId,
      assessmentId: assessment.id,
      decision: 'NEED_INFORMATION',
      rationale: 'Human qualification command retains the evidence gap',
      nextAction: 'Request independent engineering evidence',
      ownerId: f.users.operator.id,
      dueAt: later(1),
      reason,
    }),
  );
  const contribution = await network.assess(f.ctx, { taskId: id, reason });
  expect(await network.assess(f.ctx, { taskId: id, reason })).toEqual(contribution);
  await expect(
    network.reward(f.ctx, {
      commandId: randomUUID(),
      contributionId: contribution.id,
      sourceId: review.sourceId,
      reason,
    }),
  ).rejects.toThrow();
  const reward = await network.reward(f.users.owner.ctx, {
    commandId: randomUUID(),
    contributionId: contribution.id,
    sourceId: review.sourceId,
    reason,
  });
  expect(
    (
      await network.reward(f.users.owner.ctx, {
        commandId: randomUUID(),
        contributionId: contribution.id,
        sourceId: review.sourceId,
        reason,
      })
    ).duplicate,
  ).toBe(true);
  expect((await network.mine(f.users.outsider.ctx))[0].obligations).toHaveLength(1);
  await network.event(f.users.outsider.ctx, event(id, 5, 'DISPUTE'));
  await expect(network.assess(f.ctx, { taskId: id, reason })).rejects.toThrow();
  await network.reverse(f.users.owner.ctx, {
    commandId: randomUUID(),
    ledgerId: reward.id,
    sourceId: review.sourceId,
    reason: 'Synthetic compensating reversal while dispute is unresolved',
  });
  const obligations = (await network.mine(f.users.outsider.ctx))[0].obligations;
  expect(obligations).toHaveLength(2);
  expect(
    obligations
      .map((x: { amountMinor: string }) => BigInt(x.amountMinor))
      .reduce((a: bigint, b: bigint) => a + b, 0n),
  ).toBe(0n);
});
test('Spain and arbitrary Japan Kenya tasks use the same capability engine, suspension immediately removes access', async () => {
  for (const [origin, dest, type] of [
    ['ES', 'BD', 'buyers'],
    ['JP', 'KE', 'buyers'],
  ]) {
    const j = await setup(origin, dest, type);
    const p = await profile([dest], ['BD']);
    const id = await task(j, dest);
    await network.event(
      f.users.owner.ctx,
      event(id, 0, 'ASSIGN', {
        kind: 'assignment',
        profileId: p.id,
        relationshipDisclosure: 'Synthetic institutional referral, disclosed relationship',
      }),
    );
    await network.event(f.users.outsider.ctx, event(id, 1, 'ACCEPT'));
    await network.profile(f.users.owner.ctx, {
      ...p,
      id: randomUUID(),
      version: p.version + 1,
      status: 'SUSPENDED',
      reason: 'Synthetic suspension after assignment',
    });
    expect(await network.mine(f.users.outsider.ctx)).toEqual([]);
    await expect(
      network.event(
        f.users.outsider.ctx,
        event(id, 2, 'SUBMIT', { kind: 'submission', body: 'Rejected after suspension' }),
      ),
    ).rejects.toThrow();
  }
});
test('independent disabled flags and SQL reject malformed profiles, forged actors and inaccessible policy references', async () => {
  await expect(new NetworkService(f.runtime, false).mine(f.users.outsider.ctx)).rejects.toThrow(
    'disabled',
  );
  await expect(new IntelligenceService(f.runtime, false).run(f.ctx, {})).rejects.toThrow(
    'disabled',
  );
  await expect(
    rawContext(
      f.runtime,
      f.ctx,
      "INSERT INTO app.network_profile(id,tenant_id,principal_id,version,configuration,eligibility_source_id,expires_at,created_by,reason) VALUES($1,$2,$3,99,'{}',$4,now()+interval '1 day',$5,$6)",
      [randomUUID(), f.tenantA, f.users.outsider.id, randomUUID(), f.users.owner.id, reason],
    ),
  ).rejects.toThrow();
  const j = await setup('BD', 'CN');
  await expect(
    ai.run(f.ctx, {
      commandId: randomUUID(),
      missionId: j.t.missionId,
      policyId: randomUUID(),
      input: { task: 'commercial_intent', schemaVersion: 1, claimIds: [randomUUID()] },
    }),
  ).rejects.toThrow();
});

test('reviewed invitation creates a synthetic MFA identity without granting any tenant role', async () => {
  const { provisionSyntheticContributor } = await import('../../packages/auth/src/bootstrap');
  const password = 'synthetic-only-invitation-secret-password';
  await expect(
    provisionSyntheticContributor(f.owner, f.ctx, {
      email: 'denied@example.invalid',
      name: 'Synthetic denied',
      password,
      operatingCountry: 'BD',
    }),
  ).rejects.toThrow('authority');
  const identity = await provisionSyntheticContributor(f.owner, f.users.owner.ctx, {
    email: 'network-invited@example.invalid',
    name: 'Synthetic invited engineer',
    password,
    operatingCountry: 'BD',
  });
  expect(identity.tenantMembershipGranted).toBe(false);
  expect(identity.requiresAuthenticator).toBe(true);
  expect(
    (await f.owner.query('SELECT * FROM app.membership WHERE user_id=$1', [identity.principalId]))
      .rowCount,
  ).toBe(0);
  expect(
    (
      await f.owner.query('SELECT operating_country FROM identity.principal WHERE id=$1', [
        identity.principalId,
      ])
    ).rows[0].operating_country,
  ).toBe('BD');
});
test('SQL tenant isolation, immutable records, revoked MFA and removed policy deny before inference', async () => {
  const old = (await ai.workspace(f.ctx)).drafts.find((d) => d.status === 'SUCCEEDED')!;
  const callsBefore = calls;
  await expect(ai.sources(f.users.other.ctx, old.run_id)).rejects.toThrow();
  await expect(ai.sources(f.ctx, old.run_id)).rejects.toThrow(); // A newer route pack removed the old AI grant.
  expect(calls).toBe(callsBefore);
  for (const table of [
    'ai_model_policy',
    'ai_run',
    'ai_attempt',
    'ai_result',
    'ai_review',
    'network_profile',
    'network_task',
    'network_event',
  ]) {
    expect(
      (await rawContext(f.runtime, f.users.other.ctx, `SELECT * FROM app.${table}`)).rowCount,
    ).toBe(0);
    expect(
      (await rawContext(f.runtime, f.users.outsider.ctx, `SELECT * FROM app.${table}`)).rowCount,
    ).toBe(0);
    await expect(
      rawContext(f.runtime, f.users.owner.ctx, `DELETE FROM app.${table}`),
    ).rejects.toMatchObject({ code: '42501' });
  }
  const p = await profile(['CN'], ['BD']);
  await f.owner.query(
    "UPDATE identity.assurance SET verified_at=now()-interval '6 minutes' WHERE session_id=$1",
    [f.users.owner.sessionId],
  );
  await expect(
    network.profile(f.users.owner.ctx, { ...p, id: randomUUID(), version: p.version + 1, reason }),
  ).rejects.toThrow();
  await f.owner.query('UPDATE identity.assurance SET verified_at=now()');
});
