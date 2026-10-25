// Pulse email (ADR-067): "One thing needs you", "Your request moved forward", "A date is coming up", "Your
// mission is complete" and the daily digest. Pure functions: no network, no logging, no sending. A body shows
// the name on the person's account, a short description written by the team (80 characters at most, checked in the
// database) and a date; a subject never carries the team's words, and no price, file or document number is
// meant to appear. The words live in the catalog, so another language only adds a catalog entry (English until one is reviewed).
// Mission mail's templates are not edited; this file only reuses their exported helpers.
import {
  authMailColours as colour,
  authMailFont as font,
  directionOf,
  escapeHtml,
} from './customer-auth-mail-templates';
import { dueDateWords } from './mission-mail-templates';

export type PulseKind = 'your-move' | 'update' | 'countdown' | 'complete';

type Links = {
  /** The button. An https address to the canonical origin. */
  link: string;
  /** Mutes this request only. An https address; no sign-in needed. Omitted for a digest. */
  muteLink?: string;
  /** The message settings. An https address. */
  manageLink: string;
};

export type PulseInput = Links & {
  kind: PulseKind;
  name?: string | null;
  /** The Move words, the stage name, the visit name or the mission name. Plain text, as validated by the database. */
  title: string;
  /** A real calendar date, YYYY-MM-DD. Missing drops the date sentence. */
  date?: string | null;
  locale?: string;
};

export type PulseDigestInput = Links & {
  kind: 'digest';
  name?: string | null;
  items: { kind: PulseKind; title: string; date?: string | null }[];
  locale?: string;
};

export type RenderedPulse = {
  subject: string;
  preheader: string;
  html: string;
  text: string;
  locale: string;
  dir: 'ltr' | 'rtl';
};

type Catalog = {
  yourMove: {
    subject: string;
    preheader: string;
    need: string;
    due: string;
    noDue: string;
    button: string;
  };
  update: { subject: string; preheader: string; body: string; button: string };
  countdown: { subject: string; preheader: string; body: string; noDate: string; button: string };
  complete: { subject: string; preheader: string; body: string; button: string };
  digest: { subject: string; preheader: string; intro: string; itemDue: string; button: string };
  greeting: string;
  greetingNoName: string;
  footerWhy: string;
  mute: string;
  manage: string;
  language: string;
};

// The only placeholders any catalog text may contain.
export const pulsePlaceholders = ['name', 'title', 'date', 'count', 'language_code'] as const;

export const pulseCatalog: Record<string, Catalog> = {
  en: {
    yourMove: {
      // The subject never carries the team's words: it shows on a lock screen and stays in the mail provider's log.
      subject: 'One thing needs you',
      preheader: 'Your request is waiting on you.',
      need: 'Your request needs one thing from you: {title}.',
      due: 'Please do it by {date}. If that date does not work, reply and tell us.',
      noDue: 'If you need more time, reply and tell us.',
      button: 'Open',
    },
    update: {
      subject: 'Your request moved forward',
      preheader: 'There is a new step in your request.',
      body: 'Your request moved forward: {title}.',
      button: 'See your request',
    },
    countdown: {
      subject: 'A date is coming up',
      preheader: 'A date you are waiting for is close.',
      body: '{title} is on {date}.',
      noDate: '{title} is coming up.',
      button: 'See the plan',
    },
    complete: {
      subject: 'Your mission is complete',
      preheader: 'Your report is waiting in your account.',
      body: '{title} is complete. Your report is waiting in your account.',
      button: 'Open your report',
    },
    digest: {
      subject: 'What is waiting for you',
      preheader: '{count} things in your requests.',
      intro: 'Here is what is new in your requests.',
      itemDue: '{title} (by {date})',
      button: 'Open Your Move',
    },
    greeting: 'Hi {name},',
    greetingNoName: 'Hi,',
    footerWhy:
      'You are getting this because you switched on email about your requests in Corridra.',
    mute: 'Mute this request',
    manage: 'Manage messages',
    language: 'Language: {language_code}',
  },
};

/** Fills {placeholders}. A placeholder with no value, or an unknown one, is an error, never text. */
export function fillPulse(template: string, values: Partial<Record<string, string>>) {
  return template.replace(/\{([a-z_]+)\}/g, (_, key: string) => {
    const value = values[key];
    if (!(pulsePlaceholders as readonly string[]).includes(key) || value === undefined)
      throw new Error(`Unknown or missing mail placeholder: ${key}`);
    return value;
  });
}

// One line, no control characters, no angle brackets, capped. Values from people never carry a line
// break into a subject, and never carry markup into anything.
function oneLine(value: string | null | undefined, max: number) {
  return (value ?? '')
    .replace(/[\u0000-\u001f\u007f\u2028\u2029<>]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

function titleOf(value: string) {
  const clean = oneLine(value, 121);
  if (clean.length < 3 || clean.length > 120)
    throw new Error('The title must be 3 to 120 characters');
  return clean;
}

function assertLink(label: string, url: string) {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`${label} must be an https address`);
  }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password)
    throw new Error(`${label} must be a plain https address`);
  return parsed.href;
}

type Body = {
  subject: string;
  preheader: string;
  paragraphs: string[];
  button: { label: string; url: string };
  mute: string | null;
  manage: string;
};

function compose(input: PulseInput | PulseDigestInput, catalog: Catalog): Body {
  const name = oneLine(input.name, 80);
  const greeting = name ? fillPulse(catalog.greeting, { name }) : catalog.greetingNoName;
  const url = assertLink('The button link', input.link);
  const manage = assertLink('The manage link', input.manageLink);
  const mute = input.muteLink ? assertLink('The mute link', input.muteLink) : null;
  if (input.kind === 'digest') {
    if (input.items.length < 1 || input.items.length > 20)
      throw new Error('A digest holds 1 to 20 items');
    const copy = catalog.digest;
    const lines = input.items.map((item) => {
      const title = titleOf(item.title);
      return item.date ? fillPulse(copy.itemDue, { title, date: dueDateWords(item.date) }) : title;
    });
    return {
      subject: copy.subject,
      preheader: fillPulse(copy.preheader, { count: String(input.items.length) }),
      paragraphs: [greeting, copy.intro, ...lines],
      button: { label: copy.button, url },
      mute,
      manage,
    };
  }
  const title = titleOf(input.title);
  const date = input.date ? dueDateWords(input.date) : null;
  if (input.kind === 'your-move') {
    const copy = catalog.yourMove;
    return {
      subject: fillPulse(copy.subject, {}),
      preheader: copy.preheader,
      paragraphs: [
        greeting,
        fillPulse(copy.need, { title }),
        date ? fillPulse(copy.due, { date }) : copy.noDue,
      ],
      button: { label: copy.button, url },
      mute,
      manage,
    };
  }
  if (input.kind === 'update') {
    const copy = catalog.update;
    return {
      subject: copy.subject,
      preheader: copy.preheader,
      paragraphs: [greeting, fillPulse(copy.body, { title })],
      button: { label: copy.button, url },
      mute,
      manage,
    };
  }
  if (input.kind === 'countdown') {
    const copy = catalog.countdown;
    return {
      subject: fillPulse(copy.subject, {}),
      preheader: copy.preheader,
      paragraphs: [
        greeting,
        date ? fillPulse(copy.body, { title, date }) : fillPulse(copy.noDate, { title }),
      ],
      button: { label: copy.button, url },
      mute,
      manage,
    };
  }
  const copy = catalog.complete;
  return {
    subject: copy.subject,
    preheader: copy.preheader,
    paragraphs: [greeting, fillPulse(copy.body, { title })],
    button: { label: copy.button, url },
    mute,
    manage,
  };
}

export function renderPulse(input: PulseInput | PulseDigestInput): RenderedPulse {
  const locale = input.locale && pulseCatalog[input.locale] ? input.locale : 'en';
  const dir = directionOf(locale);
  const catalog = pulseCatalog[locale];
  const body = compose(input, catalog);
  const start = dir === 'rtl' ? 'right' : 'left';
  const p = (text: string) =>
    `<p style="margin:0 0 16px 0;font-family:${font};font-size:16px;line-height:24px;color:${colour.ink};text-align:${start};">${escapeHtml(text)}</p>`;
  const button = `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 24px 0;"><tr><td style="border-radius:8px;background:${colour.action};"><a href="${escapeHtml(body.button.url)}" style="display:inline-block;min-height:48px;padding:0 24px;font-family:${font};font-size:16px;line-height:48px;font-weight:600;color:${colour.onAction};text-decoration:none;border-radius:8px;">${escapeHtml(body.button.label)}</a></td></tr></table>`;
  const linkStyle = `color:${colour.action};text-decoration:underline;`;
  const language = fillPulse(catalog.language, { language_code: locale });
  const footerLinks = [
    ...(body.mute
      ? [`<a href="${escapeHtml(body.mute)}" style="${linkStyle}">${escapeHtml(catalog.mute)}</a>`]
      : []),
    `<a href="${escapeHtml(body.manage)}" style="${linkStyle}">${escapeHtml(catalog.manage)}</a>`,
    escapeHtml(language),
  ].join(' | ');
  const footer = `${escapeHtml(catalog.footerWhy)} ${footerLinks}`;
  const html = [
    '<!doctype html>',
    `<html lang="${escapeHtml(locale)}" dir="${dir}">`,
    '<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="light">',
    `<title>${escapeHtml(body.subject)}</title></head>`,
    `<body style="margin:0;padding:0;background:${colour.page};">`,
    `<div style="display:none;max-height:0;max-width:0;overflow:hidden;opacity:0;color:${colour.page};font-size:1px;line-height:1px;">${escapeHtml(body.preheader)}</div>`,
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${colour.page};"><tr><td align="center" style="padding:24px 16px;">`,
    `<table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0" dir="${dir}" style="width:100%;max-width:560px;background:${colour.card};border:1px solid ${colour.line};border-radius:12px;">`,
    `<tr><td style="padding:24px 32px 8px 32px;font-family:${font};font-size:20px;line-height:28px;font-weight:700;color:${colour.navy};text-align:${start};">Corridra</td></tr>`,
    `<tr><td style="padding:8px 32px 8px 32px;text-align:${start};">`,
    body.paragraphs.map(p).join(''),
    button,
    '</td></tr>',
    `<tr><td style="padding:8px 32px 24px 32px;border-top:1px solid ${colour.line};font-family:${font};font-size:12px;line-height:18px;color:${colour.muted};text-align:${start};">${footer}</td></tr>`,
    '</table></td></tr></table></body></html>',
  ].join('');
  const text = [
    ...body.paragraphs,
    `${body.button.label}: ${body.button.url}`,
    [
      catalog.footerWhy,
      ...(body.mute ? [`${catalog.mute}: ${body.mute}`] : []),
      `${catalog.manage}: ${body.manage}`,
      language,
    ].join('\n'),
  ].join('\n\n');
  return { subject: body.subject, preheader: body.preheader, html, text, locale, dir };
}
