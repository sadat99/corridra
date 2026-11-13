import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { randomUUID } from 'node:crypto';
import { candidateWorld, goodFields, iso, refused, type CandidateWorld } from './supply-support';
import { configureSupplySources } from '../../packages/auth/src/supply-source-configuration';
import { profileWords } from '../../packages/domain/src/counterparty-profiles';
import { uxSwitchNames, uxSwitchOn } from '../../apps/web/lib/ux-switches';
import { switchRegistry } from '../../apps/web/lib/owner-switches';

// ADR-082 R5 (slice S2): with the module control paused every supply command refuses and every staff read still answers;
// the other six controls stay closed whatever the installer does; the app switch is off unless exactly "true".
const paused = 'Supply sources are paused. Records stay readable.';
let w: CandidateWorld;
beforeAll(async () => {
  w = await candidateWorld({ open: false });
});
afterAll(async () => {
  await w?.close();
});
const controls = async () =>
  (
    await w.owner.query(
      'SELECT control,version,enabled,reason FROM app.supply_source_control ORDER BY control,version',
    )
  ).rows;

describe('closed, open and paused', () => {
  test('installed and closed: a command refuses with the paused words, a read answers null, and nothing is written', async () => {
    expect(await refused(w.save('operator', w.missionId))).toBe(paused);
    expect(paused).toBe(profileWords.paused);
    expect(
      await w.service.latest(w.users.viewer.ctx, { missionId: w.missionId, role: 'BUYER' }),
    ).toBeNull();
    expect(
      (await w.owner.query('SELECT count(*)::int n FROM app.counterparty_profile_version')).rows[0]
        .n,
    ).toBe(0);
    expect((await w.owner.query('SELECT count(*)::int n FROM app.supply_command')).rows[0].n).toBe(
      0,
    );
  });

  test('open: saves work; paused again: every command refuses (a retry too) and every staff read still answers', async () => {
    expect(
      await configureSupplySources(w.owner, { enabled: true, reason: 'Open for the control test' }),
    ).toEqual({ enabled: true, changed: true });
    const commandId = randomUUID();
    const first = await w.save('operator', w.missionId, { commandId });
    expect(first.version).toBe(1);
    expect(
      await configureSupplySources(w.owner, {
        enabled: false,
        reason: 'Pause for the control test',
      }),
    ).toEqual({ enabled: false, changed: true });
    expect(await refused(w.save('operator', w.missionId, { expectedVersion: 1 }))).toBe(paused);
    expect(await refused(w.save('owner', w.missionId, { commandId, expectedVersion: 0 }))).toBe(
      paused,
    );
    for (const who of ['owner', 'operator', 'reviewer', 'viewer'] as const) {
      const latest = await w.service.latest(w.users[who].ctx, {
        missionId: w.missionId,
        role: 'BUYER',
      });
      expect(latest, who).toMatchObject({ version: 1, id: first.profileVersionId });
      expect(
        await w.service.history(w.users[who].ctx, { missionId: w.missionId, role: 'BUYER' }),
      ).toHaveLength(1);
    }
    expect(
      (await w.owner.query('SELECT count(*)::int n FROM app.counterparty_profile_version')).rows[0]
        .n,
    ).toBe(1);
  });

  test('opening again resumes: the earlier version is kept and the next save is version 2', async () => {
    await configureSupplySources(w.owner, { enabled: true, reason: 'Reopen for the control test' });
    expect(
      (
        await w.save(
          'operator',
          w.missionId,
          { expectedVersion: 1 },
          goodFields({ candidatesWanted: 40 }),
        )
      ).version,
    ).toBe(2);
    const rows = (
      await w.owner.query(
        'SELECT version,fields FROM app.counterparty_profile_version ORDER BY version',
      )
    ).rows;
    expect(rows.map((r) => r.fields.candidatesWanted)).toEqual([20, 40]);
  });

  test('configure is a no-op when nothing changes, and every change is a new row with its reason', async () => {
    expect(
      await configureSupplySources(w.owner, { enabled: true, reason: 'Open again, same state' }),
    ).toEqual({ enabled: true, changed: false });
    const rows = await controls();
    expect(rows.map((r) => [r.control, r.version, r.enabled])).toEqual([
      ['module', 1, true],
      ['module', 2, false],
      ['module', 3, true],
    ]);
    expect(rows.every((r) => r.reason.length >= 10)).toBe(true);
  });

  test('the control rows are append only', async () => {
    expect(
      await refused(w.owner.query('UPDATE app.supply_source_control SET enabled=false')),
    ).toBeTruthy();
    expect(await refused(w.owner.query('DELETE FROM app.supply_source_control'))).toBeTruthy();
  });
});

describe('the other six controls', () => {
  test('the configure step takes no control name and no extra field, so nothing but the module can be opened', async () => {
    for (const control of [
      'partner_kinds',
      'platform_kind',
      'connectors',
      'mode_b_release',
      'personal_data',
      'staff_file_import',
    ])
      await expect(
        configureSupplySources(w.owner, {
          enabled: true,
          reason: 'Try to open another control',
          control,
        }),
      ).rejects.toThrow();
    await expect(configureSupplySources(w.owner, { enabled: true })).rejects.toThrow();
    await expect(
      configureSupplySources(w.owner, { enabled: true, reason: 'short' }),
    ).rejects.toThrow();
    expect((await controls()).every((r) => r.control === 'module')).toBe(true);
  });

  test('only the schema owner can use the configure step', async () => {
    for (const pool of [w.runtime, w.auth])
      expect(
        await refused(
          configureSupplySources(pool, { enabled: false, reason: 'Pause without authority' }),
        ),
      ).toBeTruthy();
    expect((await controls()).filter((r) => r.control === 'module')).toHaveLength(3);
  });

  test('a control row for another control does not open or close the module, and each control is read on its own', async () => {
    await w.owner.query(
      "INSERT INTO app.supply_source_control(control,version,enabled,reason) VALUES('connectors',1,true,'Opened by the table owner in the test')",
    );
    expect(
      (
        await w.owner.query(
          "SELECT app.supply_control_open('connectors') AS a, app.supply_control_open('module') AS b, app.supply_control_open('personal_data') AS c",
        )
      ).rows[0],
    ).toEqual({ a: true, b: true, c: false });
    await configureSupplySources(w.owner, { enabled: false, reason: 'Pause the module only' });
    expect(
      (
        await w.owner.query(
          "SELECT app.supply_control_open('connectors') AS a, app.supply_control_open('module') AS b",
        )
      ).rows[0],
    ).toEqual({ a: true, b: false });
    expect(await refused(w.save('operator', w.missionId, { expectedVersion: 2 }))).toBe(paused);
    expect(
      await refused(
        w.owner.query(
          "INSERT INTO app.supply_source_control(control,version,enabled,reason) VALUES('invented',1,true,'Not one of the seven')",
        ),
      ),
    ).toBeTruthy();
    await configureSupplySources(w.owner, {
      enabled: true,
      reason: 'Reopen the module after the test',
    });
  });
});

describe('the app switch', () => {
  test('is registered, described for the owner and off unless exactly "true"', () => {
    expect(uxSwitchNames).toContain('CORRIDRA_SUPPLY_SOURCES');
    expect(uxSwitchOn('CORRIDRA_SUPPLY_SOURCES', {})).toBe(false);
    for (const value of ['', 'TRUE', '1', 'yes', 'on', 'false', ' true'])
      expect(uxSwitchOn('CORRIDRA_SUPPLY_SOURCES', { CORRIDRA_SUPPLY_SOURCES: value }), value).toBe(
        false,
      );
    expect(uxSwitchOn('CORRIDRA_SUPPLY_SOURCES', { CORRIDRA_SUPPLY_SOURCES: 'true' })).toBe(true);
    const entry = switchRegistry.find((s) => s.name === 'CORRIDRA_SUPPLY_SOURCES');
    expect(entry).toMatchObject({ kind: 'flag' });
    expect(entry!.line).not.toMatch(/—|–/);
    expect(process.env.CORRIDRA_SUPPLY_SOURCES).toBeUndefined();
  });
});

// Slice S3: the candidate commands obey the same pause. Block and lift are the two safety commands that work while paused.
describe('the S3 commands while the module is paused', () => {
  test('every command refuses with the paused words, block and lift still work, and every read still answers', async () => {
    await configureSupplySources(w.owner, {
      enabled: true,
      reason: 'Open before the paused matrix',
    });
    await w.openControl('staff_file_import');
    const source = await w.staffSource();
    const missionId = await w.mission(w.tenantA, w.users.operator.id);
    const profileVersionId = await w.profile(missionId);
    const ids = {
      missionId,
      profileVersionId,
      sourceVersionId: source.sourceVersionId,
    };
    const made = await w.addCandidate('operator', ids);
    const org = await w.organisation('Paused Matrix Ltd');
    const orgTwo = await w.organisation('Paused Matrix Two Ltd');
    await w.candidates.blockCompany(w.users.operator.ctx, {
      commandId: randomUUID(),
      organisationId: orgTwo,
      reason: 'Blocked before the pause',
      reference: 'ticket 61',
    });
    const before = {
      candidates: (await w.owner.query('SELECT count(*)::int n FROM app.supply_candidate')).rows[0]
        .n,
      sources: (await w.owner.query('SELECT count(*)::int n FROM app.supply_source_version'))
        .rows[0].n,
      reviews: (await w.owner.query('SELECT count(*)::int n FROM app.supply_candidate_review'))
        .rows[0].n,
      matches: (await w.owner.query('SELECT count(*)::int n FROM app.supply_candidate_match'))
        .rows[0].n,
      batches: (await w.owner.query('SELECT count(*)::int n FROM app.supply_import_batch')).rows[0]
        .n,
    };
    await configureSupplySources(w.owner, {
      enabled: false,
      reason: 'Pause for the paused matrix',
    });
    const commandId = () => randomUUID();
    const attempts: [string, () => Promise<unknown>][] = [
      [
        'create_source',
        () =>
          w.candidates.createSource(w.users.operator.ctx, {
            commandId: commandId(),
            kind: 'staff_research',
            status: 'active',
            label: 'Paused source',
            defaultRetentionMonths: 6,
            reason: 'Refused while paused',
          }),
      ],
      [
        'add_source_version',
        () =>
          w.candidates.addSourceVersion(w.users.operator.ctx, {
            commandId: commandId(),
            sourceId: source.sourceId,
            expectedVersion: 1,
            status: 'paused',
            label: 'Paused source',
            defaultRetentionMonths: 6,
            reason: 'Refused while paused',
          }),
      ],
      ['add_candidate', () => w.addCandidate('operator', ids)],
      [
        'import_file',
        () =>
          w.candidates.importFile(w.users.operator.ctx, {
            commandId: commandId(),
            ...ids,
            digest: 'e'.repeat(64),
            rows: [
              {
                row: 2,
                cells: {
                  company_name: 'Paused File Ltd',
                  country: 'DE',
                  observed_at: iso(-1000),
                  source_locator: 'https://registry.example/p',
                },
              },
            ],
          }),
      ],
      [
        'review_candidate',
        () =>
          w.candidates.review(w.users.operator.ctx, {
            commandId: commandId(),
            candidateId: made.candidateId,
            decision: 'WRONG_FIT',
            reasonCode: 'not_a_buyer',
            reason: 'Refused while paused',
          }),
      ],
      [
        'match_candidate',
        () =>
          w.candidates.match(w.users.operator.ctx, {
            commandId: commandId(),
            candidateId: made.candidateId,
            decision: 'MATCH',
            organisationId: org,
            reason: 'Refused while paused',
          }),
      ],
    ];
    for (const [name, attempt] of attempts) expect(await refused(attempt()), name).toBe(paused);
    expect({
      candidates: (await w.owner.query('SELECT count(*)::int n FROM app.supply_candidate')).rows[0]
        .n,
      sources: (await w.owner.query('SELECT count(*)::int n FROM app.supply_source_version'))
        .rows[0].n,
      reviews: (await w.owner.query('SELECT count(*)::int n FROM app.supply_candidate_review'))
        .rows[0].n,
      matches: (await w.owner.query('SELECT count(*)::int n FROM app.supply_candidate_match'))
        .rows[0].n,
      batches: (await w.owner.query('SELECT count(*)::int n FROM app.supply_import_batch')).rows[0]
        .n,
    }).toEqual(before);
    // The safety commands work: block by an operator, lift by an owner with fresh MFA.
    const blocked = await w.candidates.blockCompany(w.users.operator.ctx, {
      commandId: commandId(),
      organisationId: org,
      reason: 'Asked to be left alone',
      reference: 'ticket 62',
    });
    expect(blocked.blockId).toBeTruthy();
    expect(
      (
        await w.candidates.liftCompany(w.users.owner.ctx, {
          commandId: commandId(),
          organisationId: org,
          reason: 'Agreed to be listed',
          reference: 'ticket 63',
        })
      ).blockId,
    ).toBeTruthy();
    expect(
      await refused(
        w.candidates.liftCompany(w.users.operator.ctx, {
          commandId: commandId(),
          organisationId: orgTwo,
          reason: 'Operators cannot lift',
          reference: 'ticket 64',
        }),
      ),
    ).toBe('Access denied');
    // Every staff read answers.
    for (const who of ['owner', 'operator', 'reviewer', 'viewer'] as const) {
      const ctx = w.users[who].ctx;
      expect(
        (await w.candidates.listCandidates(ctx, { missionId: missionId })).map((c) => c.id),
        who,
      ).toEqual([made.candidateId]);
      expect((await w.candidates.candidate(ctx, made.candidateId))?.id, who).toBe(made.candidateId);
      expect(await w.candidates.listSources(ctx), who).toHaveLength(1);
      expect((await w.candidates.listBlocks(ctx)).length, who).toBe(3);
      expect(await w.candidates.kindsOnRoute(ctx, missionId), who).toEqual(['staff_research']);
      expect(
        (await w.candidates.listMissions(ctx)).find((m) => m.id === missionId)?.candidates,
        who,
      ).toBe(1);
    }
    await configureSupplySources(w.owner, {
      enabled: true,
      reason: 'Reopen after the paused matrix',
    });
    expect((await w.addCandidate('operator', ids)).candidateId).toBeTruthy();
  });

  test('a name block is lifted and blocked again by its row id while the module is paused', async () => {
    await configureSupplySources(w.owner, {
      enabled: false,
      reason: 'Pause for the block by id test',
    });
    const put = await w.candidates.blockCompany(w.users.operator.ctx, {
      commandId: randomUUID(),
      companyName: 'A&B Ltd',
      country: 'DE',
      reason: 'The company asked to be left alone',
      reference: 'ticket 71',
    });
    const lifted = await w.candidates.liftCompany(w.users.owner.ctx, {
      commandId: randomUUID(),
      blockId: put.blockId,
      reason: 'The company agreed to be listed',
      reference: 'ticket 72',
    });
    expect(lifted.blockId).toBeTruthy();
    const again = await w.candidates.blockCompany(w.users.operator.ctx, {
      commandId: randomUUID(),
      blockId: put.blockId,
      reason: 'The company asked again',
      reference: 'ticket 73',
    });
    const rows = (
      await w.owner.query(
        'SELECT state,name_key,country FROM app.supply_do_not_contact WHERE id=ANY($1) ORDER BY seq',
        [[put.blockId, lifted.blockId, again.blockId]],
      )
    ).rows;
    expect(rows).toEqual([
      { state: 'BLOCKED', name_key: 'ab', country: 'DE' },
      { state: 'LIFTED', name_key: 'ab', country: 'DE' },
      { state: 'BLOCKED', name_key: 'ab', country: 'DE' },
    ]);
    await configureSupplySources(w.owner, {
      enabled: true,
      reason: 'Reopen after the block by id test',
    });
  });
});
