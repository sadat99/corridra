import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  memberNoticeHref,
  memberNoticeInboxTitle,
  memberNoticeList,
  memberNoticeText,
  memberNoticeWords,
} from '../../apps/web/lib/member-notice-words';
import { formatDateTime, setViewerTimeZone } from '../../apps/web/lib/ux/format';
import { uxSwitchNames, uxSwitchOn } from '../../apps/web/lib/ux-switches';

// ADR-087 U4, the member notice on /account (saved reports and decision cards) and in the inbox. The words are decision 4b
// exactly; [date and time] is the workspace's opens_at in the viewer's time zone, named. The banner shows what the server
// returns and filters nothing by time, so it stays after switch-on until the member dismisses it (the server side of that,
// per member, is proven on a database in adr087-member-notice.test.ts). Fails on main: none of these files exist there.
const web = createRequire(resolve('apps/web/package.json'));
const createElement = web('react').createElement as (type: unknown, props?: unknown) => unknown;
const renderToStaticMarkup = web('react-dom/server').renderToStaticMarkup as (
  element: unknown,
) => string;
const DECISION_4B =
  'Owners and admins of this workspace can read the reports you save and the decision cards you make here, and download the Trip Book and Supplier Book of your saved reports. This includes items you saved before today. They cannot remove or withdraw them. If there is anything you do not want them to see, you can remove it before [date and time].';
const W = '0b9a6d3e-1c2f-4a5b-8c7d-9e0f1a2b3c4d';
const W2 = '1c0b7e4f-2d3a-4b6c-9d8e-0f1a2b3c4d5e';
const notice = (opensAt: string, workspaceId = W, workspaceName = 'Sample Exports') => ({
  workspaceId,
  workspaceName,
  deliveredAt: new Date(Date.parse(opensAt) - 86400000).toISOString(),
  opensAt,
});
const render = async (props: Record<string, unknown>) => {
  const { MemberNoticeView } = await import(
    /* @vite-ignore */ '../../apps/web/app/account/saved-missions'
  );
  return renderToStaticMarkup(createElement(MemberNoticeView, props));
};
afterAll(() => setViewerTimeZone(undefined));

describe('the words', () => {
  it('are decision 4b verbatim, as written in the ADR', () => {
    expect(memberNoticeWords).toBe(DECISION_4B);
    expect(readFileSync(resolve('docs/adr/0087-share-read-access.md'), 'utf8')).toContain(
      `Plain words: "${DECISION_4B}"`,
    );
  });
  it('fill [date and time] with opens_at in the viewer time zone, naming the zone', () => {
    setViewerTimeZone('Asia/Dhaka');
    const text = memberNoticeText('2026-11-20T06:30:00.000Z');
    expect(text).toBe(
      DECISION_4B.replace('[date and time]', formatDateTime('2026-11-20T06:30:00.000Z')),
    );
    expect(text).not.toContain('[date and time]');
    expect(text).toContain('12:30');
    expect(text).toMatch(/\((GMT\+6|Asia\/Dhaka|BST|Dhaka)[^)]*\)\.$/);
    expect(() => memberNoticeText('not a time')).toThrow('Member notice time is invalid');
  });
});

describe('the banner', () => {
  it('renders the 4b words with the time and a Dismiss action', async () => {
    setViewerTimeZone('UTC');
    const html = await render({ notices: [notice('2026-11-20T06:30:00.000Z')] });
    expect(html).toContain(memberNoticeInboxTitle);
    expect(html).toContain(memberNoticeText('2026-11-20T06:30:00.000Z'));
    expect(html).toContain('06:30');
    expect(html).toContain('>Dismiss</button>');
    // One workspace: its name is not repeated above the words.
    expect(html).not.toContain('Sample Exports');
  });
  it('stays after switch-on: a time in the past still renders', async () => {
    const past = new Date(Date.now() - 3 * 86400000).toISOString();
    const html = await render({ notices: [notice(past)] });
    expect(html).toContain(memberNoticeInboxTitle);
    expect(html).toContain('>Dismiss</button>');
  });
  it('names each workspace when there are several, and shows a failed dismissal as an alert', async () => {
    const html = await render({
      notices: [
        notice('2026-11-20T06:30:00.000Z'),
        notice('2026-11-21T06:30:00.000Z', W2, 'Second Workspace'),
      ],
      failed: true,
      busy: W2,
    });
    expect(html).toContain('Sample Exports');
    expect(html).toContain('Second Workspace');
    expect(html.match(/>Dismiss<\/button>/g)).toHaveLength(2);
    expect(html).toContain('role="alert"');
    expect(html).toContain('aria-busy="true"');
  });
  it('renders nothing with no notice, which is what the server answers with the switch off or the module missing', async () => {
    expect(await render({ notices: [] })).toBe('');
    expect(memberNoticeList(null)).toEqual([]);
    expect(
      memberNoticeList({
        notices: [{ workspaceId: 'x', workspaceName: 'n', deliveredAt: 'a', opensAt: 'b' }],
      }),
    ).toEqual([]);
    expect(memberNoticeList({ notices: [notice('2026-11-20T06:30:00.000Z')] })).toHaveLength(1);
  });
  it('is mounted on the saved reports list and the decision card panel', () => {
    const saved = readFileSync(resolve('apps/web/app/account/saved-missions.tsx'), 'utf8');
    expect(saved).toContain('<MemberNotices subject={subject} issuer={issuer} />');
    const card = readFileSync(
      resolve('apps/web/app/account/missions/decision-card-panel.tsx'),
      'utf8',
    );
    expect(card).toContain('<MemberNotices subject={subject} issuer={issuer} />');
  });
});

describe('the switch, the route and the inbox', () => {
  it('CORRIDRA_MEMBER_NOTICE is its own switch, off unless exactly true', () => {
    expect(uxSwitchNames).toContain('CORRIDRA_MEMBER_NOTICE');
    expect(uxSwitchOn('CORRIDRA_MEMBER_NOTICE', {})).toBe(false);
    expect(uxSwitchOn('CORRIDRA_MEMBER_NOTICE', { CORRIDRA_MEMBER_NOTICE: '1' })).toBe(false);
    expect(uxSwitchOn('CORRIDRA_MEMBER_NOTICE', { CORRIDRA_MEMBER_NOTICE: 'true' })).toBe(true);
  });
  it('the route answers not found with the switch off, checks origin and JSON on dismiss, and takes only a workspace id', () => {
    const route = readFileSync(resolve('apps/web/app/api/customer-member-notice/route.ts'), 'utf8');
    expect(route).toContain("if (!memberNoticeOn()) throw new DomainError('Not found', 404);");
    expect(route).toContain("request.headers.get('origin') !== s.config.APP_ORIGIN");
    expect(route).toContain("startsWith('application/json')");
    expect(route).toContain('z.object({ workspaceId: z.uuid() }).strict()');
  });
  it('the inbox shows the notice with a short title and leads to the saved reports', () => {
    const inbox = readFileSync(resolve('apps/web/components/ux/notification-inbox.tsx'), 'utf8');
    expect(inbox).toContain('MEMBER_NOTICE: memberNoticeInboxTitle');
    expect(inbox).toContain(
      'const typeHref: Record<string, string> = { MEMBER_NOTICE: memberNoticeHref };',
    );
    expect(
      inbox.split('safeInternalPath(item.payload.href ?? typeHref[item.type])').length - 1,
    ).toBe(2);
    expect(memberNoticeHref).toBe('/account?view=results&tab=saved');
  });
  it('email: nothing calls the notification sender for this type; delivery writes inbox rows in the database only', () => {
    const notify = readFileSync(resolve('apps/web/lib/ux/notify-mail.ts'), 'utf8');
    expect(notify).not.toContain('MEMBER_NOTICE');
    const sql = readFileSync(
      resolve('packages/db/member-notice-migrations/0001_member_notice.sql'),
      'utf8',
    );
    expect(sql).not.toMatch(/outbox|mail/i);
  });
});
