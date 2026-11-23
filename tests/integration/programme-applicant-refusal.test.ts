import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { localeCodes } from '../../apps/web/lib/i18n/locales';
import { translate } from '../../apps/web/lib/i18n/messages';

// D-045: "already registered" is refused in two places. The organiser reads it about an applicant they tried to invite;
// the applicant reads it about themselves when they apply or join. Each reads their own words. The request helper is
// called here with the server's answer stubbed; that the applicant's screen passes its own words is read from the
// source, because the screen is not rendered.
const load = async (path: string) => await import(/* @vite-ignore */ `../../apps/web/${path}`);
const read = (path: string) => readFileSync(resolve(path), 'utf8');
type Outcome = { ok: boolean; message?: string; denied?: boolean };
const { pageRequest, refusalWords, applicantRefusalWords } = (await load(
  'app/account/delegations/programme-page-client.ts',
)) as {
  pageRequest: (
    identity: { subject: string; issuer: string },
    payload: Record<string, unknown>,
    refusals?: Record<string, string>,
  ) => Promise<Outcome>;
  refusalWords: Record<string, string>;
  applicantRefusalWords: Record<string, string>;
};
const identity = { subject: 'person', issuer: 'https://issuer.example' };
const refuse = (code: string) =>
  vi.stubGlobal('fetch', async () => Response.json({ code }, { status: 409 }));
afterEach(() => vi.unstubAllGlobals());

describe('the already registered refusal', () => {
  it('tells the organiser about the applicant they tried to invite', async () => {
    refuse('PROGRAMME_ALREADY_REGISTERED');
    expect(await pageRequest(identity, { kind: 'application', action: 'decide' })).toEqual({
      ok: false,
      denied: false,
      message: 'This person is already registered in this programme.',
    });
  });

  it('tells the applicant about themselves', async () => {
    refuse('PROGRAMME_ALREADY_REGISTERED');
    expect(
      await pageRequest(identity, { kind: 'application', action: 'apply' }, applicantRefusalWords),
    ).toEqual({
      ok: false,
      denied: false,
      message: 'You are already registered in this programme.',
    });
  });

  it('changes no other refusal the applicant reads', async () => {
    const changed = Object.keys(refusalWords).filter(
      (code) => applicantRefusalWords[code] !== refusalWords[code],
    );
    expect(changed).toEqual(['PROGRAMME_ALREADY_REGISTERED']);
    expect(Object.keys(applicantRefusalWords).sort()).toEqual(Object.keys(refusalWords).sort());
    refuse('PROGRAMME_APPLICATIONS_CLOSED');
    const closed = await pageRequest(identity, { action: 'apply' }, applicantRefusalWords);
    expect(closed.message).toBe(refusalWords.PROGRAMME_APPLICATIONS_CLOSED);
  });

  it('is sent with the applicant’s words only from the applicant’s screen', () => {
    const own = read('apps/web/app/account/delegations/programme-applications.tsx');
    expect(own.match(/await pageRequest\(/g)).toHaveLength(2);
    expect(own.match(/\n\s+applicantRefusalWords,\n\s+\);/g)).toHaveLength(2);
    for (const organiser of ['programme-page.tsx', 'programme-people-board.tsx', 'first-run.tsx'])
      expect(read(`apps/web/app/account/delegations/${organiser}`)).not.toContain(
        'applicantRefusalWords',
      );
  });

  it('has its English words in every language until a reviewed translation replaces them', () => {
    for (const locale of localeCodes)
      expect(translate(locale, 'pp.refusal.applicant.PROGRAMME_ALREADY_REGISTERED'), locale).toBe(
        'You are already registered in this programme.',
      );
  });
});
