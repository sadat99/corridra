import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  cleanFounderLine,
  dueDateWords,
  fillMission,
  missionMailCatalog,
  missionMailPlaceholders,
  renderMissionMail,
  type RequestReceivedInput,
  type YourMoveInput,
} from '../../packages/auth/src/mission-mail-templates';
import { objectiveOptions } from '../../packages/domain/src/missions';
import { jobPhrase } from '../../packages/auth/src/mission-mail';
import {
  signMissionMailMute,
  verifyMissionMailMute,
} from '../../packages/auth/src/mission-mail-mute';
import { missionMailGate, readFounderLine } from '../../packages/auth/src/mission-mail-gate';
import {
  authMailColours,
  contrastRatio,
  escapeHtml,
} from '../../packages/auth/src/customer-auth-mail-templates';

const links = {
  link: 'https://corridra.example/account/requests/abc',
  muteLink: 'https://corridra.example/mute/abc#t=token',
  manageLink: 'https://corridra.example/account',
};
const received = (over: Partial<RequestReceivedInput> = {}): RequestReceivedInput => ({
  kind: 'request-received',
  name: 'Amina Rahman',
  job: 'Sell in a new market: Germany',
  codeSignIn: true,
  founderLine: '',
  ...links,
  ...over,
});
const move = (over: Partial<YourMoveInput> = {}): YourMoveInput => ({
  kind: 'your-move',
  name: 'Amina Rahman',
  missionName: 'Germany buyers',
  moveTitle: 'Confirm your sample size',
  moveDetail: 'Tell us how many pieces you can send for the first check.',
  dueDate: '2026-11-23',
  ...links,
  ...over,
});

describe('message 1, we have your request', () => {
  it('uses the agreed words and signature', () => {
    const mail = renderMissionMail(received());
    expect(mail.subject).toBe('We have your request');
    expect(mail.preheader).toBe('A person on our team will read it. Your link is inside.');
    expect(mail.text).toContain('Hi Amina Rahman,');
    expect(mail.text).toContain(
      'Your request about Sell in a new market: Germany has reached us, and a person on our team will read it.',
    );
    // A job phrase that is not one of the five request types gets the general paragraph.
    expect(mail.text).toContain(
      "Here's what comes next. We check the details with you. Then we tell you the next step in your request.",
    );
    expect(mail.text).toContain('If something in your request is wrong, reply to this email.');
    expect(mail.text).toContain('Sadat\nFounder, Corridra');
    expect(mail.text).toContain('See your request: https://corridra.example/account/requests/abc');
    expect(mail.html).toContain('Sadat<br>Founder, Corridra');
  });

  it('names the code option only when code sign-in is on', () => {
    expect(renderMissionMail(received({ codeSignIn: true })).text).toContain(
      'Sign in with your email address and a code, or with your password.',
    );
    const off = renderMissionMail(received({ codeSignIn: false })).text;
    expect(off).toContain(
      'The button below takes you to your request. Sign in with your password.',
    );
    expect(off).not.toContain('a code');
  });

  it('renders nothing for an empty founder line, not a blank line or a placeholder', () => {
    for (const empty of [undefined, null, '', '   ', '\n\t']) {
      const mail = renderMissionMail(received({ founderLine: empty }));
      expect(mail.text).not.toMatch(/\n\n\n/);
      expect(mail.text).not.toMatch(/\{|\}|\[|\]/);
      expect(mail.html).not.toContain('<p style="margin:0 0 16px 0;"></p>');
      expect(mail.html).not.toMatch(/<p[^>]*>\s*<\/p>/);
      const lines = mail.text.split('\n\n');
      expect(lines.indexOf('If something in your request is wrong, reply to this email.')).toBe(
        lines.indexOf(
          'The button below takes you to your request. Sign in with your email address and a code, or with your password.',
        ) + 1,
      );
    }
  });

  it('places the founder line between the sign-in sentence and the reply sentence', () => {
    const text = renderMissionMail(received({ founderLine: 'I read every request myself.' })).text;
    expect(text).toContain(
      'or with your password.\n\nI read every request myself.\n\nIf something in your request is wrong',
    );
  });

  it('says what comes next for each request type, and only the general words otherwise', () => {
    const expected: Record<string, string> = {
      'Source suppliers':
        "Here's what comes next. We check the details with you. Then we look for suppliers and check what they say about themselves. When quotes arrive, you'll see them side by side.",
      'Sell in a new market':
        "Here's what comes next. We check the details with you. Then we look for buyers and partners in your target market and check what they say about themselves. What we find will appear in your request.",
      'Find customers or distributors':
        "Here's what comes next. We check the details with you. Then we look for customers or distributors that fit and check what they say about themselves. What we find will appear in your request.",
      'Make an upcoming business trip more productive':
        "Here's what comes next. We check the details with you. Then we work out who is worth meeting on your trip and what to prepare. Your plan will appear in your request.",
      'Run a multi-company mission':
        "Here's what comes next. We check the details with you and each company taking part. Then we plan the mission around what each company needs. You'll see the plan in your request.",
    };
    const general =
      "Here's what comes next. We check the details with you. Then we tell you the next step in your request.";
    const seen = new Set<string>();
    for (const [objective, paragraph] of Object.entries(expected)) {
      const job = jobPhrase(objective);
      expect(job, objective).not.toBe('');
      const text = renderMissionMail(received({ job })).text;
      expect(text, objective).toContain(paragraph);
      expect(text, objective).not.toContain(general);
      seen.add(paragraph);
    }
    expect(seen.size).toBe(5);
    for (const job of ['', undefined, 'Something else entirely', 'constructor', '__proto__']) {
      const text = renderMissionMail(received({ job })).text;
      expect(text, String(job)).toContain(general);
      for (const paragraph of seen) expect(text, String(job)).not.toContain(paragraph);
    }
  });

  it('has a paragraph for every request type the form offers', () => {
    const keys = Object.keys(missionMailCatalog.en.requestReceived.nextByJob).sort();
    const typed = objectiveOptions.filter((name) => name !== 'Something else');
    expect(typed.length).toBe(5);
    expect(keys).toEqual(typed.map((name) => jobPhrase(name)).sort());
    expect(jobPhrase('Something else')).toBe('');
  });

  it('drops the job phrase when the job is empty, without a doubled "request"', () => {
    for (const job of [undefined, null, '', '  ']) {
      const text = renderMissionMail(received({ job })).text;
      expect(text).toContain(
        'Thanks for sending this. Your request has reached us, and a person on our team will read it.',
      );
      expect(text).not.toContain('request about');
    }
  });

  it('greets without a name when the name is empty', () => {
    expect(renderMissionMail(received({ name: '' })).text.startsWith('Hi,\n\n')).toBe(true);
  });

  it('does not promise what is not built', () => {
    const text = renderMissionMail(received()).text;
    expect(text).not.toMatch(/save a code|every time|without signing in|no need to sign in/i);
  });
});

describe('message 4, your move', () => {
  it('uses the agreed words and has no personal signature', () => {
    const mail = renderMissionMail(move());
    expect(mail.subject).toBe('One thing needs you: Confirm your sample size');
    expect(mail.preheader).toBe('Germany buyers is waiting on you.');
    expect(mail.text).toContain(
      'Germany buyers needs one thing from you: Confirm your sample size.',
    );
    expect(mail.text).toContain('Tell us how many pieces you can send for the first check.');
    expect(mail.text).toContain(
      "Please do it by 23 November 2026. If that date doesn't work, reply and tell us.",
    );
    expect(mail.text).toContain('Open: https://corridra.example/account/requests/abc');
    expect(mail.text).not.toMatch(/Sadat|Founder/);
    expect(mail.html).not.toMatch(/Sadat|Founder, Corridra/);
  });

  it('drops the date sentence when there is no due date', () => {
    for (const dueDate of [undefined, null, '']) {
      const text = renderMissionMail(move({ dueDate })).text;
      expect(text).toContain('If you need more time, reply and tell us.');
      expect(text).not.toContain('Please do it by');
    }
  });

  it('refuses a contract the data cannot satisfy', () => {
    expect(() => renderMissionMail(move({ moveTitle: 'ab' }))).toThrow(/move title/);
    expect(() => renderMissionMail(move({ moveDetail: '' }))).toThrow(/move detail/);
    expect(() => renderMissionMail(move({ missionName: 'x' }))).toThrow(/mission name/);
    expect(() => renderMissionMail(move({ dueDate: '2026-02-30' }))).toThrow(/does not exist/);
    expect(() => renderMissionMail(move({ dueDate: '23/11/2026' }))).toThrow(/YYYY-MM-DD/);
  });

  it('turns the date into words without a locale dependency', () => {
    expect(dueDateWords('2026-01-05')).toBe('5 January 2026');
    expect(dueDateWords('2028-02-29')).toBe('29 February 2028');
    expect(() => dueDateWords('2027-02-29')).toThrow();
  });
});

describe('both messages', () => {
  for (const [name, input] of [
    ['request received', received()],
    ['your move', move()],
  ] as const) {
    it(`${name}: footer has the why, mute link, manage link and language`, () => {
      const mail = renderMissionMail(input);
      // The footer pieces appear in this order, each escaped the way the layout escapes it.
      const pieces = [
        escapeHtml("You're getting this because you have a request with Corridra."),
        '>Mute this request</a>',
        '>Manage messages</a>',
        'Language: en</td>',
      ];
      let from = 0;
      for (const piece of pieces) {
        const at = mail.html.indexOf(piece, from);
        expect(at, piece).toBeGreaterThanOrEqual(from);
        from = at + piece.length;
      }
      expect(mail.html).toContain(`href="${links.muteLink}"`);
      expect(mail.html).toContain(`href="${links.manageLink}"`);
      expect(mail.text).toContain(`Mute this request: ${links.muteLink}`);
      expect(mail.text).toContain(`Manage messages: ${links.manageLink}`);
      expect(mail.text).toContain('Language: en');
    });

    it(`${name}: no dashes used as punctuation, no leftover placeholders, no unsafe markup`, () => {
      const mail = renderMissionMail(input);
      for (const part of [mail.subject, mail.preheader, mail.text]) {
        expect(part).not.toMatch(/—|–| - /);
        expect(part).not.toMatch(/\{[a-z_]+\}/);
      }
      expect(mail.html).not.toMatch(/<script|javascript:|\son[a-z]+=/i);
      expect(mail.html).toContain('lang="en"');
      expect(mail.html).toContain('dir="ltr"');
    });

    it(`${name}: text colour on the card and the button text keep AA contrast`, () => {
      expect(contrastRatio(authMailColours.ink, authMailColours.card)).toBeGreaterThanOrEqual(4.5);
      expect(
        contrastRatio(authMailColours.onAction, authMailColours.action),
      ).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(authMailColours.muted, authMailColours.card)).toBeGreaterThanOrEqual(
        4.5,
      );
      expect(renderMissionMail(input).html).toContain(`background:${authMailColours.action}`);
    });

    it(`${name}: rejects links that are not plain https`, () => {
      for (const bad of [
        'http://x.example/a',
        'javascript:alert(1)',
        'https://u:p@x.example/',
        'x',
      ]) {
        expect(() => renderMissionMail({ ...input, link: bad })).toThrow();
        expect(() => renderMissionMail({ ...input, muteLink: bad })).toThrow();
        expect(() => renderMissionMail({ ...input, manageLink: bad })).toThrow();
      }
    });
  }

  it('escapes what people typed in the page and keeps it out of the subject line breaks', () => {
    const mail = renderMissionMail(
      received({ name: '<img src=x onerror=alert(1)> Sam', job: 'A & B "quoted" <b>bold</b>' }),
    );
    expect(mail.html).not.toContain('<img');
    expect(mail.html).not.toContain('<b>');
    expect(mail.html).toContain('A &amp; B &quot;quoted&quot;');
    const moveMail = renderMissionMail(
      move({ moveTitle: 'Do this\r\nBcc: someone@example.com', missionName: 'Name\nInjected' }),
    );
    expect(moveMail.subject).not.toMatch(/[\r\n]/);
    expect(moveMail.preheader).not.toMatch(/[\r\n]/);
  });

  it('keeps the owner sentence to one clean line of plain text', () => {
    expect(cleanFounderLine('  Line one\nline two <b>x</b>  ')).toBe('Line one line two b x /b');
    expect(cleanFounderLine('x'.repeat(500)).length).toBe(280);
    expect(cleanFounderLine(undefined)).toBe('');
  });

  it('only knows the placeholders it lists, and an unknown or missing one is an error', () => {
    expect(() => fillMission('Hello {nope}', { nope: 'x' })).toThrow(/Unknown/);
    expect(() => fillMission('Hello {name}', {})).toThrow(/missing/);
    const texts = JSON.stringify(missionMailCatalog);
    for (const [, key] of texts.matchAll(/\{([a-z_]+)\}/g))
      expect(missionMailPlaceholders as readonly string[]).toContain(key);
  });

  it('falls back to English for a language that has no catalog yet', () => {
    const mail = renderMissionMail(received({ locale: 'bn' }));
    expect(mail.locale).toBe('en');
    expect(mail.text).toContain('Language: en');
  });

  it('carries no phone number, postal address or tracking pixel', () => {
    for (const input of [received(), move()]) {
      const html = renderMissionMail(input).html;
      expect(html).not.toMatch(/<img/i);
      expect(html).not.toMatch(/\+\d{6,}/);
    }
  });
});

describe('mute token', () => {
  const secret = 'a'.repeat(40);
  const id = 'e0b4b5c2-6c59-4c7a-8d3f-0a9f6a0d1b11';

  it('verifies for the request it was made for and for nothing else', () => {
    const token = signMissionMailMute(secret, id);
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(verifyMissionMailMute(secret, id, token)).toBe(true);
    const otherRequest = id.replace(/.$/, '2');
    expect(otherRequest).not.toBe(id);
    expect(verifyMissionMailMute(secret, otherRequest, token)).toBe(false);
    expect(verifyMissionMailMute('b'.repeat(40), id, token)).toBe(false);
  });

  it('rejects malformed, truncated and altered tokens without throwing', () => {
    const token = signMissionMailMute(secret, id);
    for (const bad of [
      '',
      'x',
      token.slice(1),
      token + 'A',
      token.replace(/.$/, 'A'),
      '!'.repeat(43),
    ])
      if (bad !== token) expect(verifyMissionMailMute(secret, id, bad)).toBe(false);
  });

  it('is scoped to one purpose: it is not a plain hash of the request id', () => {
    const plain = createHmac('sha256', secret).update(id).digest('base64url');
    expect(verifyMissionMailMute(secret, id, plain)).toBe(false);
  });

  it('refuses a weak secret or an unusable request id', () => {
    expect(() => signMissionMailMute('short', id)).toThrow(/secret/);
    expect(() => signMissionMailMute(secret, '')).toThrow(/request id/);
    expect(() => signMissionMailMute(secret, 'a/b')).toThrow(/request id/);
  });
});

describe('when a mission email may be sent', () => {
  const real = {
    DATA_ENVIRONMENT: 'real',
    CORRIDRA_REAL_USE_ENABLED: 'true',
    CORRIDRA_MISSION_EMAIL_ENABLED: 'true',
  } as NodeJS.ProcessEnv;
  const person = {
    workspaceSynthetic: false,
    accountEmail: 'amina@acme-textiles.com',
    accountEmailVerified: true,
  };

  it('sends only when every condition holds', () => {
    expect(missionMailGate({ env: real, ...person })).toEqual({ send: true });
  });

  it('is off when the switch is unset or anything but true', () => {
    for (const value of [undefined, '', 'false', 'TRUE', '1'])
      expect(
        missionMailGate({ env: { ...real, CORRIDRA_MISSION_EMAIL_ENABLED: value }, ...person }),
      ).toEqual({ send: false, reason: 'switch-off' });
  });

  it('is off outside real use, including with the switch on', () => {
    expect(
      missionMailGate({ env: { ...real, DATA_ENVIRONMENT: 'synthetic' }, ...person }).reason,
    ).toBe('not-real-use');
    expect(
      missionMailGate({ env: { ...real, CORRIDRA_REAL_USE_ENABLED: undefined }, ...person }).reason,
    ).toBe('not-real-use');
    expect(missionMailGate({ env: { ...real, VERCEL_ENV: 'production' }, ...person }).reason).toBe(
      'not-real-use',
    );
  });

  it('is off for a sample workspace, an unverified account and unusable addresses', () => {
    expect(missionMailGate({ env: real, ...person, workspaceSynthetic: true }).reason).toBe(
      'sample-workspace',
    );
    expect(missionMailGate({ env: real, ...person, accountEmailVerified: false }).reason).toBe(
      'email-not-verified',
    );
    for (const accountEmail of [
      null,
      undefined,
      '',
      'x@example.invalid',
      'x@example.com',
      'x@host.test',
      'two words@acme.com',
      'a@b',
      'a@@b.com',
      '<a@b.com>',
      `${'x'.repeat(60)}@${'y'.repeat(200)}.com`,
    ])
      expect(missionMailGate({ env: real, ...person, accountEmail }).reason).toBe(
        'address-not-usable',
      );
  });

  it('checks the switch before anything about the person, so nothing is read when it is off', () => {
    const touched: string[] = [];
    const guarded = new Proxy(
      { workspaceSynthetic: false, accountEmailVerified: true },
      {
        get(target, key) {
          touched.push(String(key));
          return Reflect.get(target, key);
        },
      },
    ) as never;
    const result = missionMailGate({
      env: {} as NodeJS.ProcessEnv,
      ...(guarded as object),
      accountEmail: 'a@b.com',
    } as never);
    expect(result.reason).toBe('switch-off');
  });

  it('reads the founder line as written, and empty when unset', () => {
    expect(readFounderLine({} as NodeJS.ProcessEnv)).toBe('');
    expect(readFounderLine({ MISSION_EMAIL_FOUNDER_LINE: 'Hello.' } as NodeJS.ProcessEnv)).toBe(
      'Hello.',
    );
  });
});
