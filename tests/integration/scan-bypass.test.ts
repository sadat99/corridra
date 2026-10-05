import { test, expect } from 'vitest';
import { fixture } from './support';
import { EvidenceService, type ObjectStorage } from '../../packages/evidence/src/index';
import { AccessService } from '../../packages/auth/src/access';
import { ClamAvScanner } from '../../packages/evidence/src/adapters';
const bytes = Buffer.from('%PDF-1.7\nSynthetic unscanned evidence');
async function setup() {
  const f = await fixture();
  const objects = new Map<string, Uint8Array>();
  const storage: ObjectStorage = {
    async put(k, b) {
      objects.set(k, b.slice());
    },
    async get(k) {
      const b = objects.get(k);
      if (!b) throw new Error('Missing');
      return b;
    },
  };
  const unavailable = {
    async scan() {
      return { verdict: 'ERROR' as const, engine: 'unconfigured' };
    },
  };
  const strict = new EvidenceService(f.runtime, storage, unavailable),
    bypass = new EvidenceService(f.runtime, storage, unavailable, true),
    access = new AccessService(f.runtime);
  const source = await bypass.createSource(f.users.operator.ctx, {
    kind: 'observation',
    locator: 'Synthetic bypass contract',
    observedAt: new Date().toISOString(),
    classification: 'INTERNAL',
    purpose: 'synthetic_validation',
    retentionUntil: new Date(Date.now() + 86400000).toISOString(),
    aiPolicy: 'DENY',
  });
  const claim = await bypass.createClaim(f.users.operator.ctx, {
    sourceId: source.id,
    statement: 'Independent content review',
  });
  const e = await bypass.upload(f.users.owner.ctx, claim.id, bytes, 'application/pdf');
  return { f, storage, objects, strict, bypass, access, e };
}
test('explicit bypass needs tenant-owner authorization, records unscanned bytes and preserves independent review', async () => {
  const { f, storage, strict, bypass, access, e } = await setup();
  try {
    expect((await bypass.scan(f.users.operator.ctx, e.id)).scanStatus).toBe('ERROR');
    await expect(
      access.appendConfig(f.users.operator.ctx, { key: 'evidence.scan_bypass', enabled: true }),
    ).rejects.toThrow();
    await access.appendConfig(f.users.owner.ctx, { key: 'evidence.scan_bypass', enabled: true });
    expect((await bypass.scan(f.users.operator.ctx, e.id)).scanStatus).toBe('BYPASSED');
    expect(
      (
        await f.owner.query(
          "SELECT count(*)::int AS n FROM app.scan_report WHERE evidence_id=$1 AND verdict='CLEAN'",
          [e.id],
        )
      ).rows[0].n,
    ).toBe(0);
    expect((await bypass.download(f.users.operator.ctx, e.id)).body).toEqual(bytes);
    await expect(strict.download(f.users.operator.ctx, e.id)).rejects.toThrow('unavailable');
    await expect(bypass.download(f.users.other.ctx, e.id)).rejects.toThrow('unavailable');
    const input = {
      decision: 'VERIFIED' as const,
      method: 'Independent inspection',
      scope: 'Content only; malware scanning bypassed',
      validUntil: new Date(Date.now() + 86400000).toISOString(),
    };
    await expect(bypass.verify(f.users.owner.ctx, e.id, input)).rejects.toThrow('different');
    await expect(strict.verify(f.users.reviewer.ctx, e.id, input)).rejects.toThrow('quarantined');
    expect((await bypass.verify(f.users.reviewer.ctx, e.id, input)).decision).toBe('VERIFIED');
    expect((await bypass.workspace(f.users.owner.ctx)).facts).toHaveLength(1);
    await access.appendConfig(f.users.owner.ctx, { key: 'evidence.scan_bypass', enabled: false });
    await expect(bypass.download(f.users.operator.ctx, e.id)).rejects.toThrow('unavailable');
    expect((await strict.scan(f.users.operator.ctx, e.id)).attemptedScan).toBe('ERROR');
    const restored = new EvidenceService(f.runtime, storage, new ClamAvScanner('127.0.0.1', 33129));
    expect((await restored.scan(f.users.operator.ctx, e.id)).scanStatus).toBe('CLEAN');
    expect((await restored.download(f.users.operator.ctx, e.id)).body).toEqual(bytes);
  } finally {
    await f.close();
  }
});
test('bypass cannot advance altered bytes or evidence in a non-synthetic tenant', async () => {
  const { f, bypass, objects, access, e } = await setup();
  try {
    await access.appendConfig(f.users.owner.ctx, { key: 'evidence.scan_bypass', enabled: true });
    const key = (
      await f.owner.query('SELECT object_key FROM app.evidence_object WHERE id=$1', [e.id])
    ).rows[0].object_key;
    objects.set(key, Buffer.from('%PDF-1.7 Changed'));
    expect((await bypass.scan(f.users.operator.ctx, e.id)).scanStatus).toBe('INFECTED');
    await expect(bypass.download(f.users.operator.ctx, e.id)).rejects.toThrow('unavailable');
    await f.owner.query('UPDATE app.tenant SET synthetic=false WHERE id=$1', [f.tenantA]);
    expect(
      (await f.owner.query('SELECT app.scan_bypass_allowed($1) AS allowed', [f.tenantA])).rows[0]
        .allowed,
    ).toBe(false);
    const claimId = (
      await f.owner.query('SELECT claim_id FROM app.evidence_object WHERE id=$1', [e.id])
    ).rows[0].claim_id;
    const second = await bypass.upload(f.users.owner.ctx, claimId, bytes, 'application/pdf');
    expect((await bypass.scan(f.users.operator.ctx, second.id)).scanStatus).toBe('ERROR');
  } finally {
    await f.close();
  }
});
