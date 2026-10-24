import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { founderActivation } from '../../packages/auth/src/founder-activation';
import { ownerGaps, gapSignal } from '../../apps/web/lib/owner-gaps';
import {
  chooseOwnerTenant,
  ownerCapable,
  ownerPageAccess,
  ownerPageEnabled,
} from '../../apps/web/lib/owner-access';
import {
  describeSwitches,
  isSecretName,
  switchGroups,
  switchRegistry,
} from '../../apps/web/lib/owner-switches';
import { waitingOnTeam } from '../../apps/web/lib/owner-waiting';

const root = join(__dirname, '..', '..');

function sourceFiles(directory: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(directory)) {
    if (['node_modules', '.next', 'dist', 'work'].includes(entry)) continue;
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) files.push(...sourceFiles(path));
    else if (/\.(ts|tsx|mjs)$/.test(entry)) files.push(path);
  }
  return files;
}

/** Every CORRIDRA_* name the application reads from the environment, or lists as a flag. */
function settingsReadBySource() {
  const names = new Map<string, string>();
  const read =
    /(?:\benv|process\.env)\s*(?:\.\s*|\[\s*['"`])(CORRIDRA_[A-Z0-9_]+)|\bflag:\s*['"`](CORRIDRA_[A-Z0-9_]+)['"`]/g;
  for (const base of ['apps', 'packages']) {
    for (const file of sourceFiles(join(root, base))) {
      for (const match of readFileSync(file, 'utf8').matchAll(read)) {
        const name = match[1] ?? match[2];
        if (!names.has(name)) names.set(name, relative(root, file));
      }
    }
  }
  return names;
}

describe('the switch registry covers the code', () => {
  it('describes every CORRIDRA_ setting the application reads, except secrets', () => {
    const described = new Set(switchRegistry.map((entry) => entry.name));
    const missing = [...settingsReadBySource()]
      .filter(([name]) => !isSecretName(name) && !described.has(name))
      .map(([name, file]) => `${name} (read in ${file})`);
    expect(
      missing,
      'Add a plain label and one line for each new switch in apps/web/lib/owner-switches.ts',
    ).toEqual([]);
  });
  it('finds the settings it is meant to find', () => {
    const found = settingsReadBySource();
    for (const name of [
      'CORRIDRA_NETWORK_ENABLED',
      'CORRIDRA_CUSTOMER_PROGRAMMES_ENABLED',
      'CORRIDRA_REAL_USE_ENABLED',
      'CORRIDRA_OWNER_PAGE_ENABLED',
    ])
      expect(found.has(name), name).toBe(true);
  });
  it('has unique names in known groups, none of them secrets', () => {
    const names = switchRegistry.map((entry) => entry.name);
    expect(new Set(names).size).toBe(names.length);
    for (const entry of switchRegistry) {
      expect(isSecretName(entry.name), entry.name).toBe(false);
      expect(switchGroups).toContain(entry.group);
      expect(entry.label.length).toBeGreaterThan(0);
      expect(entry.line.length).toBeGreaterThan(0);
      expect(`${entry.label} ${entry.line}`, entry.name).not.toMatch(/[–—]/);
    }
  });
  it('lists exactly the customer modules that the activation view knows', () => {
    const modules = switchRegistry.filter((entry) => entry.kind === 'module').map((e) => e.name);
    const known = founderActivation({}).modules.map((m) => m.flag);
    expect([...modules].sort()).toEqual([...known].sort());
  });
});

describe('switch states', () => {
  const states = (env: NodeJS.ProcessEnv) =>
    new Map(describeSwitches(env).flatMap((g) => g.rows.map((r) => [r.name, r.state.text])));

  it('shows nothing as on when no setting is present', () => {
    const view = states({});
    // A switch that is on by default (it keeps behaviour that existed before the switch) is the only exception.
    const onByDefault = new Set(
      switchRegistry.filter((entry) => entry.kind === 'flagDefaultOn').map((entry) => entry.name),
    );
    expect([...view].filter(([name, text]) => text === 'On' && !onByDefault.has(name))).toEqual([]);
    expect(view.get('CORRIDRA_NETWORK_ENABLED')).toBe('Off');
    expect(view.get('CORRIDRA_CUSTOMER_CODE_SIGNIN')).toBe('Off');
    expect(view.get('CORRIDRA_CUSTOMER_AUTH_MAIL_ENABLED')).toBe('Off');
    expect(view.get('CORRIDRA_MISSION_EMAIL_ENABLED')).toBe('Off');
  });
  it('shows a default-on switch as on unless it is exactly false', () => {
    const name = 'CORRIDRA_REAL_REPORT_SIGNED_IN_ENABLED';
    expect(states({}).get(name)).toBe('On');
    expect(states({ [name]: 'true' }).get(name)).toBe('On');
    expect(states({ [name]: 'FALSE' }).get(name)).toBe('On');
    expect(states({ [name]: 'false' }).get(name)).toBe('Off');
    expect(states({}).get('CORRIDRA_REAL_REPORT_PUBLIC_LINK_ENABLED')).toBe('Off');
    expect(
      states({ CORRIDRA_REAL_REPORT_PUBLIC_LINK_ENABLED: 'true' }).get(
        'CORRIDRA_REAL_REPORT_PUBLIC_LINK_ENABLED',
      ),
    ).toBe('On');
  });
  it('reads a plain switch only when it is exactly true', () => {
    expect(states({ CORRIDRA_NETWORK_ENABLED: 'true' }).get('CORRIDRA_NETWORK_ENABLED')).toBe('On');
    for (const value of ['1', 'TRUE', 'yes', ' true', 'false', ''])
      expect(states({ CORRIDRA_NETWORK_ENABLED: value }).get('CORRIDRA_NETWORK_ENABLED')).toBe(
        'Off',
      );
  });
  it('uses the shared helpers for modes and customer modules', () => {
    const production = { VERCEL_ENV: 'production', DATA_ENVIRONMENT: 'synthetic' };
    expect(
      states({ ...production, CORRIDRA_CUSTOMER_WORKSPACES_ENABLED: 'true' }).get(
        'CORRIDRA_CUSTOMER_WORKSPACES_ENABLED',
      ),
    ).toBe('Locked until the live site is unlocked');
    const unlocked = {
      ...production,
      CORRIDRA_CUSTOMER_PRODUCTION_UNLOCK: 'synthetic-only',
      CORRIDRA_CUSTOMER_WORKSPACES_ENABLED: 'true',
    };
    expect(states(unlocked).get('CORRIDRA_CUSTOMER_WORKSPACES_ENABLED')).toBe('On');
    expect(states(unlocked).get('CORRIDRA_CUSTOMER_PRODUCTION_UNLOCK')).toBe('On');
    expect(
      states({ ...unlocked, CORRIDRA_CUSTOMER_PROGRAMMES_ENABLED: 'true' }).get(
        'CORRIDRA_CUSTOMER_PROGRAMMES_ENABLED',
      ),
    ).toBe('On');
    // A real-use switch without the data mode and approval value is not real use.
    expect(states({ CORRIDRA_REAL_USE_ENABLED: 'true' }).get('CORRIDRA_REAL_USE_ENABLED')).toBe(
      'Off',
    );
  });
  it('shows only whether a setting is set, never its value', () => {
    const secretValue = 'https://ep-private.neonauth.example/private/auth';
    const view = describeSwitches({ CORRIDRA_CUSTOMER_ISSUER: secretValue });
    const row = view.flatMap((g) => g.rows).find((r) => r.name === 'CORRIDRA_CUSTOMER_ISSUER')!;
    expect(row.state.text).toBe('Set');
    expect(JSON.stringify(view)).not.toContain(secretValue);
  });
  it('never lists or reads secret names, whatever the environment holds', () => {
    const env = {
      CORRIDRA_OPENAI_API_KEY: 'sk-private-value-1',
      CORRIDRA_ANTHROPIC_API_KEY: 'sk-private-value-2',
      CORRIDRA_GOOGLE_API_KEY: 'sk-private-value-3',
      CORRIDRA_SOMETHING_SECRET: 'private-value-4',
      CORRIDRA_SOMETHING_TOKEN: 'private-value-5',
      CORRIDRA_SOMETHING_PASSWORD: 'private-value-6',
      CORRIDRA_NEW_UNDESCRIBED_FLAG: 'true',
    };
    const text = JSON.stringify(describeSwitches(env));
    for (const leaked of [
      'private-value',
      'API_KEY',
      'SOMETHING_SECRET',
      'SOMETHING_TOKEN',
      'SOMETHING_PASSWORD',
    ])
      expect(text, leaked).not.toContain(leaked);
    const extra = describeSwitches(env).find((g) => g.group === 'Not described yet')!;
    expect(extra.rows.map((r) => [r.name, r.state.text])).toEqual([
      ['CORRIDRA_NEW_UNDESCRIBED_FLAG', 'On'],
    ]);
  });
  it('shows no undescribed group when nothing is undescribed', () => {
    expect(describeSwitches({}).some((g) => g.group === 'Not described yet')).toBe(false);
  });
});

describe('open gaps', () => {
  const register = readFileSync(join(root, 'docs/implementation/deferred-controls.md'), 'utf8');
  const rows = new Map(
    register
      .split('\n')
      .filter((line) => /^\| D\d\d /.test(line))
      .map((line) => {
        const cells = line.split('|').map((cell) => cell.trim());
        return [cells[1], { work: cells[2], requiredBefore: cells[4], status: cells[6] }] as const;
      }),
  );
  it('copies work, required-before and status exactly from the register', () => {
    for (const gap of ownerGaps)
      expect(
        { work: gap.work, requiredBefore: gap.requiredBefore, status: gap.status },
        gap.id,
      ).toEqual(rows.get(gap.id));
  });
  it('lists exactly the open gaps and none that the register marks closed', () => {
    expect(ownerGaps.map((g) => g.id)).toEqual(['D01', 'D02', 'D03', 'D04', 'D05', 'D06', 'D08']);
    for (const gap of ownerGaps) expect(gap.status, gap.id).not.toMatch(/^Closed/);
  });
  it('gives a live signal only for the scanner and never prints a value', () => {
    expect(gapSignal('D01', { EVIDENCE_SCAN_MODE: 'bypass' })).toContain('bypass');
    expect(gapSignal('D01', { CLAMAV_HOST: 'scanner.private.example' })).not.toContain('private');
    expect(gapSignal('D01', {})).toContain('No scanner');
    for (const id of ['D02', 'D03', 'D04', 'D05', 'D06', 'D08'] as const)
      expect(gapSignal(id, { CLAMAV_HOST: 'x' })).toBeNull();
  });
});

describe('who may open the page', () => {
  const tenant = (role: string, id = '11111111-1111-4111-8111-111111111111') => ({
    id,
    name: role + ' workspace',
    role,
  });
  const input = (over: Partial<Parameters<typeof ownerPageAccess>[0]> = {}) => ({
    enabled: true,
    configured: true,
    signedIn: true,
    tenants: [tenant('owner')],
    ...over,
  });
  it('does not exist unless the switch is exactly true', () => {
    expect(ownerPageEnabled({})).toBe(false);
    expect(ownerPageEnabled({ CORRIDRA_OWNER_PAGE_ENABLED: '1' })).toBe(false);
    expect(ownerPageEnabled({ CORRIDRA_OWNER_PAGE_ENABLED: 'true' })).toBe(true);
    expect(ownerPageAccess(input({ enabled: false }))).toBe('hidden');
    expect(ownerPageAccess(input({ enabled: false, signedIn: false, configured: false }))).toBe(
      'hidden',
    );
  });
  it('asks a signed-out visitor to sign in', () => {
    expect(ownerPageAccess(input({ signedIn: false, tenants: [] }))).toBe('sign-in');
  });
  it('allows owners and admins only', () => {
    expect(ownerPageAccess(input({ tenants: [tenant('owner')] }))).toBe('allowed');
    expect(ownerPageAccess(input({ tenants: [tenant('admin')] }))).toBe('allowed');
    for (const role of ['operator', 'reviewer', 'viewer', 'customer', ''])
      expect(ownerPageAccess(input({ tenants: [tenant(role)] })), role).toBe('denied');
  });
  it('denies a signed-in person with no staff membership, such as a customer', () => {
    expect(ownerPageAccess(input({ tenants: [] }))).toBe('denied');
  });
  it('is unavailable when the workspace is not configured', () => {
    expect(ownerPageAccess(input({ configured: false }))).toBe('unavailable');
  });
  it('picks only a workspace where the person is owner or admin', () => {
    const owner = tenant('owner', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
    const operator = tenant('operator', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
    const admin = tenant('admin', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc');
    const all = [operator, owner, admin];
    expect(ownerCapable(all)).toEqual([owner, admin]);
    expect(chooseOwnerTenant(all)).toEqual(owner);
    expect(chooseOwnerTenant(all, admin.id)).toEqual(admin);
    expect(chooseOwnerTenant(all, operator.id)).toEqual(owner);
  });
});

describe('waiting on the team', () => {
  const ctx = { token: 't', tenantId: 'x', purpose: 'synthetic_validation' };
  it('returns the counts the service reports', async () => {
    const totals: Record<string, number> = { 'open:DRAFT': 3, 'overdue:': 1, 'open:': 7 };
    const items = await waitingOnTeam(
      {
        async queue(_ctx, filter, _offset, filters) {
          return { total: totals[`${filter}:${filters.stage ?? ''}`] };
        },
      },
      ctx,
    );
    expect(items.map((i) => [i.key, i.count])).toEqual([
      ['fresh', 3],
      ['overdue', 1],
      ['open', 7],
    ]);
  });
  it('reports a count it cannot read as unknown, never as zero', async () => {
    const items = await waitingOnTeam(
      {
        async queue(_ctx, filter) {
          if (filter === 'overdue') throw new Error('Role cannot read missions');
          return { total: 2 };
        },
      },
      ctx,
    );
    expect(items.find((i) => i.key === 'overdue')!.count).toBeNull();
    expect(items.find((i) => i.key === 'open')!.count).toBe(2);
  });
});
