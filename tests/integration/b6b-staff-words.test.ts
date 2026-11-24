import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { formatDate, formatDateTime, setViewerTimeZone } from '../../apps/web/lib/ux/format';

// Unit B6b (commercial-ready run, 23 Nov 2026): staff dates in the one product format, audit lines named by
// what happened, glossary words on staff screens (routes, price requests, what you can see) and helper words on
// the helper branch of the shared setup and recovery pages. Ids, routes, payloads and checks are unchanged.
const read = (path: string) => readFileSync(resolve(path), 'utf8');
const load = async (path: string) => await import(/* @vite-ignore */ `../../apps/web/${path}`);
const operator = (file: string) => read(`apps/web/app/operator/${file}`);

describe('D-030 staff dates use the one product format', () => {
  it('shows an audit time as day, month name, year, 24-hour time and the zone', async () => {
    const { auditTime } = await load('app/operator/workspace-audit.tsx');
    setViewerTimeZone('Asia/Dhaka');
    try {
      expect(auditTime('2026-10-24T00:08:00Z')).toBe('24 Oct 2026, 06:08 (Dhaka, UTC+6)');
      expect(auditTime('2026-11-23T11:39:00Z')).toBe(formatDateTime('2026-11-23T11:39:00Z'));
      expect(auditTime('2026-11-23T11:39:00Z')).not.toMatch(/AM|PM|Nov 23/);
      expect(auditTime(undefined)).toBe('Time unavailable');
      expect(auditTime('not a date')).toBe('Time unavailable');
    } finally {
      setViewerTimeZone(undefined);
    }
  });
  it('routes the four staff files through format.ts and leaves no other date output', () => {
    for (const [file, helper] of [
      ['workspace-audit.tsx', 'formatDateTime'],
      ['mission-moves.tsx', 'formatDate'],
      ['customer-billing.tsx', 'formatDateTime'],
      ['commercial-mission.tsx', 'formatDateTime'],
    ] as const) {
      const source = operator(file);
      expect(source, file).toMatch(
        new RegExp(`import \\{[^}]*\\b${helper}\\b[^}]*\\} from '\\.\\./\\.\\./lib/ux/format'`),
      );
      expect(source, file).not.toMatch(/toLocale(?:Date|Time)?String\(|Intl\.DateTimeFormat/);
      expect(source, file).not.toMatch(/displayDate\(/);
      expect(source, file).not.toMatch(/\.slice\(0, 16\)\.replace\('T', ' '\)/);
    }
    expect(operator('mission-moves.tsx')).toContain('{formatDate(row.closed!.at)}');
    expect(operator('customer-billing.tsx')).toContain(
      '<time dateTime={ev.at}>{formatDateTime(ev.at)}</time>',
    );
    expect(operator('commercial-mission.tsx')).toContain('{formatDateTime(bound.observedAt)}.');
    expect(formatDate('2026-11-23T05:21:00Z', { timeZone: 'UTC' })).toBe('23 Nov 2026');
  });
});

describe('D-031 audit lines say what happened', () => {
  it('names each known event kind and keeps the fallback only for unknown kinds', async () => {
    const { eventLabel } = await load('app/operator/workspace-audit.tsx');
    const fallback = 'Workspace change recorded';
    for (const [type, label] of [
      ['view_as.open', 'Preview opened'],
      ['config_version.insert', 'Workspace setting added'],
      ['membership.update', 'Membership updated'],
      ['mission.insert', 'Mission added'],
      ['mission.update', 'Mission updated'],
      ['source_record.insert', 'Source added'],
      ['claim.insert', 'Claim added'],
      ['evidence_object.insert', 'Evidence added'],
      ['evidence_state.insert', 'Evidence status added'],
      ['scan_report.insert', 'File scan report added'],
      ['canonical_fact.update', 'Fact updated'],
      ['verification.insert', 'Verification added'],
      ['relationship.insert', 'Company relationship added'],
      ['opportunity.update', 'Opportunity updated'],
      ['intake_destination.insert', 'Request destination added'],
      ['organisation.insert', 'Company added'],
      ['organisation_source.insert', 'Company source added'],
      ['organisation_attribute.insert', 'Company detail added'],
      ['private_contact_data.insert', 'Private contact added'],
      ['private_note.insert', 'Private note added'],
      ['private_contact_change.insert', 'Private contact change added'],
      ['private_note_change.insert', 'Private note change added'],
      ['private_record_redaction.insert', 'Private record removal added'],
      ['entity_candidate.insert', 'Possible duplicate added'],
      ['entity_resolution.insert', 'Duplicate decision added'],
      ['target_account.insert', 'Target company added'],
      ['target_contact.insert', 'Target contact added'],
      ['match_assessment.insert', 'Review for fit added'],
      ['assessment_claim.insert', 'Review for fit claim added'],
      ['research_command.insert', 'Research action added'],
      ['communication_policy.insert', 'Message policy added'],
      ['communication_template.insert', 'Message template added'],
      ['communication.insert', 'Message added'],
      ['communication_command.insert', 'Message action added'],
      ['communication_dispatch.insert', 'Message send added'],
      ['communication_receipt.insert', 'Message receipt added'],
      ['communication_attempt.insert', 'Message attempt added'],
      ['communication_optout.insert', 'Message opt-out added'],
      ['buyer_link.insert', 'Buyer link added'],
      ['buyer_link_revocation.insert', 'Buyer link withdrawal added'],
      ['buyer_response.insert', 'Buyer reply added'],
      ['meeting.insert', 'Meeting added'],
      ['meeting_participant.insert', 'Meeting participant added'],
      ['meeting_brief.insert', 'Meeting brief added'],
      ['meeting_outcome.insert', 'Meeting outcome added'],
      ['meeting_command.insert', 'Meeting action added'],
      ['follow_up.update', 'Follow-up updated'],
      ['mission.delete', 'Mission removed'],
    ] as const)
      expect(eventLabel(type), type).toBe(label);
    for (const unknown of [undefined, '', 'mission', 'mission.archive', 'unknown_table.insert'])
      expect(eventLabel(unknown), String(unknown)).toBe(fallback);
    // An inherited object key is not an event kind.
    expect(eventLabel('constructor.insert')).toBe(fallback);
    expect(eventLabel('toString')).toBe(fallback);
  });
});

describe('D-033 staff words follow the glossary', () => {
  it('says Routes and settings for the settings section and keeps its id and address', async () => {
    const { workspaceSections } = await load('lib/workspace-navigation.ts');
    const item = (workspaceSections as readonly { id: string; label: string }[]).find(
      (entry) => entry.id === 'workspace-settings',
    );
    expect(item?.label).toBe('Routes and settings');
    const map = read('apps/web/lib/ux/team-map.ts');
    expect(map).toContain("{ id: 'workspace-settings', label: 'Routes and settings' }");
    const page = operator('[section]/[missionId]/mission-page.tsx');
    expect(page).toContain('An owner adds one under Routes and settings, then it shows');
    for (const source of [read('apps/web/lib/workspace-navigation.ts'), map, page])
      expect(source).not.toMatch(/Corridors and policies|Routes and policies/);
  });
  it('writes RFQ out and says what you can see on the opportunities summary', () => {
    const source = operator('opportunities.tsx');
    expect(source).toContain('{data.activity.rfqs} price requests (RFQs) · ');
    expect(source).not.toMatch(/\{data\.activity\.rfqs\} RFQs/);
    expect(source).toContain("? 'What you can see: the selected mission.'");
    expect(source).toContain(": 'What you can see: all missions you can open.'}");
    expect(source).not.toContain('Scope: {mission');
  });
});

describe('helper words on the shared setup and recovery pages', () => {
  it('uses the helper eyebrow in sentence case on the recovery page', () => {
    const page = operator('forgot-password/page.tsx');
    expect(page).toContain("eyebrow={helper ? 'Assigned work' : 'OPERATOR ACCESS'}");
    expect(page).not.toContain('ASSIGNED EXECUTION WORK');
  });
  it('says helper and work password on the helper branch of the setup form', () => {
    const form = operator('setup/setup-form.tsx');
    expect(form).not.toMatch(/contributor password|Contributor Password|\{kind\} password/);
    expect(form).not.toMatch(/\$\{kind\} (?:passwords|invitation)|\{kind\} account/);
    expect(form).toContain("const who = contributor ? 'helper' : 'operator';");
    expect(form).toContain("const secret = contributor ? 'work' : 'operator';");
    expect(form).toContain('Your work password is ready.');
    expect(form).toContain('New {secret} password');
    expect(form).toContain('Confirm {secret} password');
    expect(form).toContain("`Set ${contributor ? 'Work' : 'Operator'} Password`");
    // The request the page sends is unchanged.
    expect(form.match(/'\?kind=contributor'/g)).toHaveLength(2);
    expect(form).toContain("body: JSON.stringify({ password: data.get('password') })");
  });
  it('sends a helper to the helper sign-in door with the same return address', () => {
    const form = operator('setup/setup-form.tsx');
    expect(form).toContain(
      "? '/contributor/signin' +\n                (invite?.workspaceId\n                  ? '?next=' + encodeURIComponent('/contributor?workspace=' + invite.workspaceId)\n                  : '')\n              : '/operator/signin'",
    );
    expect(form).not.toContain("'/operator/signin?next='");
  });
  it('names helper setup in the access links', async () => {
    const { accessHelp } = await load('lib/access-doors.ts');
    expect(accessHelp.operatorSignIn('/contributor').links[0]).toEqual({
      href: '/contributor/setup',
      text: 'Set up invited helper access',
    });
    expect(accessHelp.operatorSignIn('/operator').links[0]).toEqual({
      href: '/operator/setup',
      text: 'Set up invited operator access',
    });
    expect(accessHelp.contributorSetup.label).toBe('Helper setup help');
    expect(read('apps/web/lib/access-doors.ts')).not.toMatch(
      /invited contributor access|Contributor setup help/,
    );
  });
});

describe('D-032 and the front door lines (added by the Guardian, 23 Nov 2026)', () => {
  it('calls the unsent request "your request" in English and keeps the key', async () => {
    const { translate } = await load('lib/i18n/messages.ts');
    expect(translate('en', 'move.card.draft.object')).toBe('your request');
    // Since unit L0 each language keeps its words in its own file: English once here, each of the six once there.
    const source = [
      'apps/web/lib/i18n/messages.ts',
      ...['bn', 'zh', 'es', 'ar', 'fr', 'de'].map((code) => `apps/web/lib/i18n/lang/${code}.ts`),
    ]
      .map((path) => {
        const text = read(path);
        expect(text.match(/'move\.card\.draft\.object':/g), path).toHaveLength(1);
        return text;
      })
      .join('\n');
    expect(source.match(/'move\.card\.draft\.object':/g)).toHaveLength(7);
    expect(source).not.toContain("'your draft request'");
  });
  it('says routes and helper on the front door lines', async () => {
    const { founderDoor, helperDoor } = await load('lib/front-doors.ts');
    const line = (items: readonly { id: string; line: string }[], id: string) =>
      items.find((item) => item.id === id)?.line;
    expect(line(founderDoor, 'routes')).toBe('Routes and settings.');
    expect(line(helperDoor, 'accept')).toBe(
      'Set up your separate helper access from the invitation the Corridra team sent.',
    );
    expect(read('apps/web/lib/front-doors.ts')).not.toMatch(
      /Corridors and policies|Routes and policies|contributor access/,
    );
  });
});

describe('review of 7088945: billing period dates and one name for the settings section', () => {
  it('shows a billing period date as the calendar date it is, in any viewer zone', async () => {
    const { billingPeriodDate } = await load('app/operator/customer-billing.tsx');
    for (const zone of ['America/New_York', 'Asia/Dhaka', 'Pacific/Kiritimati', 'UTC']) {
      setViewerTimeZone(zone);
      try {
        // A period start or end is a SQL date ("YYYY-MM-DD"): no time and no zone shift.
        expect(billingPeriodDate('2026-11-01'), zone).toBe('1 Nov 2026');
        expect(billingPeriodDate('2026-12-31'), zone).toBe('31 Dec 2026');
      } finally {
        setViewerTimeZone(undefined);
      }
    }
    const source = operator('customer-billing.tsx');
    expect(source).not.toMatch(
      /formatDateTime\((?:detail\.subscription|ev)\.period(?:Start|End)\)/,
    );
    expect(source.match(/ billingPeriodDate\(/g)).toHaveLength(4);
    expect(source).toContain('<time dateTime={ev.at}>{formatDateTime(ev.at)}</time>');
  });
  it('says Routes and settings everywhere staff read the settings section name', () => {
    const workspace = operator('workspace.tsx');
    const operations = operator('operations.tsx');
    expect(workspace).toContain('<span>Routes and settings</span>');
    expect(workspace).toContain("label: 'Routes and settings',");
    expect(operations).toContain('Routes and settings before readiness review.');
    expect(operations).toContain('<a href="#workspace-settings">Routes and settings</a>');
    for (const source of [workspace, operations])
      expect(source).not.toMatch(/Corridors and policies|Routes and policies/);
  });
});
