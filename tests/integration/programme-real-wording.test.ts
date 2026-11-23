import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { programmePagesWords } from '../../apps/web/lib/i18n/programme-pages-words';
import { isTitleCase } from '../../apps/web/lib/ux/title-case';

// D-047: a real workspace is never told to write the word Synthetic and is never handed sample words to send as its
// own. A sample workspace still is, because the database refuses sample text without that first word (the checks in
// packages/db/customer-real-use-migrations/0003_real_customer_modules.sql). Both panels draw their forms only after a
// read from the server, so the rules are pure functions tested here and their use is read from the source; the panels
// are not rendered.
const load = async (path: string) => await import(/* @vite-ignore */ `../../apps/web/${path}`);
const read = (path: string) => readFileSync(resolve(path), 'utf8');
const { termsVersionNote } = (await load('app/account/delegations/terms-client.ts')) as {
  termsVersionNote: () => string;
};
const { correctionReasonStart } = (await load(
  'app/account/delegations/programme-economics.tsx',
)) as { correctionReasonStart: () => string };

const realWorkspace = () => {
  vi.stubEnv('DATA_ENVIRONMENT', 'real');
  vi.stubEnv('CORRIDRA_REAL_USE_ENABLED', 'true');
};
const sampleWorkspace = () => {
  vi.stubEnv('DATA_ENVIRONMENT', 'synthetic');
  vi.stubEnv('CORRIDRA_REAL_USE_ENABLED', '');
};
afterEach(() => vi.unstubAllEnvs());

describe('the terms form in a real workspace', () => {
  const terms = read('apps/web/app/account/delegations/programme-terms.tsx');

  it('says each version is kept and does not ask for the word Synthetic', () => {
    realWorkspace();
    expect(termsVersionNote()).toBe(
      'Each version is kept. A new version asks participants to accept it again.',
    );
    expect(termsVersionNote()).not.toMatch(/synthetic/i);
  });

  it('still tells a sample workspace the first word its texts need', () => {
    sampleWorkspace();
    expect(termsVersionNote()).toBe(
      'Each version is kept. A new version asks participants to accept it again. Start each text with the word Synthetic.',
    );
  });

  it('draws that line and no other instruction above the form', () => {
    expect(terms).toContain('<p>{termsVersionNote()}</p>');
    // The sentence that asked every workspace for the word is no longer written into the form itself.
    expect(terms.replace(/\s+/g, ' ')).not.toContain('accept it again. Start each text');
  });
});

describe('correcting a finance entry in a real workspace', () => {
  const economics = read('apps/web/app/account/delegations/programme-economics.tsx');

  it('starts with an empty reason, so the organiser writes their own', () => {
    realWorkspace();
    expect(correctionReasonStart()).toBe('');
  });

  it('keeps the sample reason a sample workspace can send', () => {
    sampleWorkspace();
    expect(correctionReasonStart()).toBe('Synthetic correction of an entry');
  });

  it('fills the reason box from that rule, at first and again after a correction is saved', () => {
    expect(economics).toContain('const [fixText, setFixText] = useState(correctionReasonStart);');
    expect(economics).not.toContain("useState('Synthetic correction of an entry')");
    const saved = economics.slice(economics.indexOf('void post({ reverseOf: id'));
    expect(saved.slice(0, saved.indexOf('});')).replace(/\s+/g, ' ')).toContain(
      'setCorrecting(null); setFixText(correctionReasonStart()); setFixConfirm(false);',
    );
  });

  it('refuses an empty reason in plain words that do not mention Synthetic', () => {
    const refusal = economics.slice(economics.indexOf('function correct(id: string)'));
    expect(refusal.slice(0, refusal.indexOf('if (!fixConfirm)')).replace(/\s+/g, ' ')).toContain(
      "realCustomerInput() ? 'Enter a clear description with at least two characters.' : 'Start the reason with the word Synthetic and add a few words.'",
    );
  });
});

describe('the words a real workspace reads never call unsent work a draft', () => {
  it('names the editor action and the two waiting lines without that word', () => {
    expect(programmePagesWords['pp.edit.close']).toBe('Close and Finish Later');
    expect(isTitleCase(programmePagesWords['pp.edit.close'])).toBe(true);
    expect(programmePagesWords['pp.first.restoring']).toBe(
      'Checking for words you typed earlier in this browser…',
    );
    expect(read('apps/web/app/account/delegations/programme-pricing.tsx')).toContain(
      '<p role="status">Restoring what you typed for this fee schedule…</p>',
    );
    for (const key of ['pp.edit.close', 'pp.first.restoring'] as const)
      expect(programmePagesWords[key]).not.toMatch(/draft|[—–]/i);
  });

  it('says unsaved text in the objective tools and request on the delegate path', () => {
    const editor = read('apps/web/app/account/delegations/programme-objective-editor.tsx');
    for (const line of [
      "'Private details and unsaved text were cleared. Reload to check current access.'",
      "'Your objective is unsaved. Save it or clear the text before closing these tools.'",
      "'Access changed. Private details and unsaved text were cleared.'",
    ])
      expect(editor).toContain(line);
    expect(editor).not.toMatch(/'[^'\n]*\bdrafts?\b[^'\n]*'/);
    expect(programmePagesWords['pp.path.step.request.prefill']).toBe(
      'The organisers shared the destination and dates: {market}, {start} to {end} ({zone}). They are added to your request. You can change them before it is sent.',
    );
  });
});

describe('a participant without a place yet', () => {
  it('is told to confirm their place, the name of the button that does it', () => {
    const projections = read('apps/web/app/account/delegations/programme-projections.tsx').replace(
      /\s+/g,
      ' ',
    );
    expect(projections).toContain(
      'Confirm your place using your company profile in Your place first.',
    );
    expect(projections).not.toContain('Apply for a place using your company profile');
  });
});
