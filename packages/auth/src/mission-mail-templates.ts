// Mission emails to the person who owns a request: "We have your request" and "One thing needs you".
// Pure functions. No network, no logging, no sending. The words live in the catalog so another
// language only adds a catalog entry. Nothing here sends or schedules anything; the switch, the
// recipient and the trigger are decided elsewhere (see mission-mail-gate.ts and the proposal).
import {
  authMailColours as colour,
  authMailFont as font,
  directionOf,
  escapeHtml,
} from './customer-auth-mail-templates';

export type MissionMailKind = 'request-received' | 'your-move';

type Links = {
  /** The button. An https address to the account request page. */
  link: string;
  /** Mutes this request only. An https address; the person needs no sign-in. */
  muteLink: string;
  /** The account message settings. An https address. */
  manageLink: string;
};

export type RequestReceivedInput = Links & {
  kind: 'request-received';
  /** What the person typed as their name. Empty or missing gives a greeting without a name. */
  name?: string | null;
  /** What the request is about, in a few words. Empty gives the version without it. */
  job?: string | null;
  /** True when code sign-in is on for customers. Decides which sign-in sentence is used. */
  codeSignIn: boolean;
  /** One sentence the owner wrote. Empty or missing renders nothing at all. */
  founderLine?: string | null;
  locale?: string;
};

/**
 * What "One thing needs you" needs. Nothing in the data today records something a customer must do, so this
 * is a contract for the Mission Road work, not a trigger: the owner of that work fills these fields.
 */
export type MissionMove = {
  missionName: string;
  moveTitle: string;
  moveDetail: string;
  /** A calendar date, YYYY-MM-DD. Missing drops the date sentence. */
  dueDate?: string | null;
};

export type YourMoveInput = Links &
  MissionMove & {
    kind: 'your-move';
    name?: string | null;
    locale?: string;
  };

export type MissionMailInput = RequestReceivedInput | YourMoveInput;

export type RenderedMissionMail = {
  subject: string;
  preheader: string;
  html: string;
  text: string;
  locale: string;
  dir: 'ltr' | 'rtl';
};

type Catalog = {
  requestReceived: {
    subject: string;
    preheader: string;
    greeting: string;
    greetingNoName: string;
    intro: string;
    introNoJob: string;
    /** Used when the request type is not one of the keys of nextByJob. */
    next: string;
    /** What comes next, by the job phrase mission-mail.ts stores for each request type. */
    nextByJob: Record<string, string>;
    signInCode: string;
    signInPassword: string;
    reply: string;
    signature: [string, string];
    button: string;
  };
  yourMove: {
    subject: string;
    preheader: string;
    greeting: string;
    greetingNoName: string;
    need: string;
    due: string;
    noDue: string;
    button: string;
  };
  footerWhy: string;
  mute: string;
  manage: string;
  language: string;
};

// The only placeholders any catalog text may contain.
export const missionMailPlaceholders = [
  'name',
  'job',
  'mission_name',
  'move_title',
  'move_detail',
  'due_date',
  'language_code',
] as const;

export const missionMailCatalog: Record<string, Catalog> = {
  en: {
    requestReceived: {
      subject: 'We have your request',
      preheader: 'A person on our team will read it. Your link is inside.',
      greeting: 'Hi {name},',
      greetingNoName: 'Hi,',
      intro:
        'Thanks for sending this. Your request about {job} has reached us, and a person on our team will read it.',
      introNoJob:
        'Thanks for sending this. Your request has reached us, and a person on our team will read it.',
      next: "Here's what comes next. We check the details with you. Then we tell you the next step in your request.",
      nextByJob: {
        'sourcing suppliers':
          "Here's what comes next. We check the details with you. Then we look for suppliers and check what they say about themselves. When quotes arrive, you'll see them side by side.",
        'selling in a new market':
          "Here's what comes next. We check the details with you. Then we look for buyers and partners in your target market and check what they say about themselves. What we find will appear in your request.",
        'finding customers or distributors':
          "Here's what comes next. We check the details with you. Then we look for customers or distributors that fit and check what they say about themselves. What we find will appear in your request.",
        'making an upcoming business trip more productive':
          "Here's what comes next. We check the details with you. Then we work out who is worth meeting on your trip and what to prepare. Your plan will appear in your request.",
        'running a multi-company mission':
          "Here's what comes next. We check the details with you and each company taking part. Then we plan the mission around what each company needs. You'll see the plan in your request.",
      },
      signInCode:
        'The button below takes you to your request. Sign in with your email address and a code, or with your password.',
      signInPassword: 'The button below takes you to your request. Sign in with your password.',
      reply: 'If something in your request is wrong, reply to this email.',
      signature: ['Sadat', 'Founder, Corridra'],
      button: 'See your request',
    },
    yourMove: {
      subject: 'One thing needs you: {move_title}',
      preheader: '{mission_name} is waiting on you.',
      greeting: 'Hi {name},',
      greetingNoName: 'Hi,',
      need: '{mission_name} needs one thing from you: {move_title}.',
      due: "Please do it by {due_date}. If that date doesn't work, reply and tell us.",
      noDue: 'If you need more time, reply and tell us.',
      button: 'Open',
    },
    footerWhy: "You're getting this because you have a request with Corridra.",
    mute: 'Mute this request',
    manage: 'Manage messages',
    language: 'Language: {language_code}',
  },
};

const monthNames = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

/** Fills {placeholders}. A placeholder with no value, or an unknown one, is an error, never text. */
export function fillMission(template: string, values: Partial<Record<string, string>>) {
  return template.replace(/\{([a-z_]+)\}/g, (_, key: string) => {
    const value = values[key];
    if (!(missionMailPlaceholders as readonly string[]).includes(key) || value === undefined)
      throw new Error(`Unknown or missing mail placeholder: ${key}`);
    return value;
  });
}

// One line, no control characters, no angle brackets, capped. Values from people never carry a
// line break into a subject, and never carry markup into anything.
function oneLine(value: string | null | undefined, max: number) {
  return (value ?? '')
    .replace(/[\u0000-\u001f\u007f\u2028\u2029<>]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

function bounded(label: string, value: string, min: number, max: number) {
  const clean = oneLine(value, max + 1);
  if (clean.length < min || clean.length > max)
    throw new Error(`${label} must be ${min} to ${max} characters`);
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

/** "2026-11-23" gives "23 November 2026". A date that does not exist is an error. */
export function dueDateWords(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) throw new Error('The due date must be YYYY-MM-DD');
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  )
    throw new Error('The due date does not exist');
  return `${day} ${monthNames[month - 1]} ${year}`;
}

/** The founder sentence. Plain text only; empty after cleaning means nothing is rendered. */
export function cleanFounderLine(value: string | null | undefined) {
  return oneLine(value, 280);
}

type Body = {
  subject: string;
  preheader: string;
  paragraphs: string[];
  button: { label: string; url: string };
  closing: string[];
  signature?: string[];
  mute: string;
  manage: string;
};

function compose(input: MissionMailInput, catalog: Catalog): Body {
  const name = oneLine(input.name, 80);
  const links = {
    url: assertLink('The button link', input.link),
    mute: assertLink('The mute link', input.muteLink),
    manage: assertLink('The manage link', input.manageLink),
  };
  if (input.kind === 'request-received') {
    const copy = catalog.requestReceived;
    const job = oneLine(input.job, 120);
    const founder = cleanFounderLine(input.founderLine);
    return {
      subject: copy.subject,
      preheader: copy.preheader,
      paragraphs: [
        name ? fillMission(copy.greeting, { name }) : copy.greetingNoName,
        job ? fillMission(copy.intro, { job }) : copy.introNoJob,
        Object.hasOwn(copy.nextByJob, job) ? copy.nextByJob[job] : copy.next,
        input.codeSignIn ? copy.signInCode : copy.signInPassword,
        ...(founder ? [founder] : []),
        copy.reply,
      ],
      button: { label: copy.button, url: links.url },
      closing: [],
      signature: [...copy.signature],
      mute: links.mute,
      manage: links.manage,
    };
  }
  const copy = catalog.yourMove;
  const mission_name = bounded('The mission name', input.missionName, 2, 160);
  const move_title = bounded('The move title', input.moveTitle, 3, 120);
  const move_detail = bounded('The move detail', input.moveDetail, 1, 1000);
  const due = input.dueDate ? dueDateWords(input.dueDate) : null;
  return {
    subject: fillMission(copy.subject, { move_title }),
    preheader: fillMission(copy.preheader, { mission_name }),
    paragraphs: [
      name ? fillMission(copy.greeting, { name }) : copy.greetingNoName,
      fillMission(copy.need, { mission_name, move_title }),
      move_detail,
      due ? fillMission(copy.due, { due_date: due }) : copy.noDue,
    ],
    button: { label: copy.button, url: links.url },
    closing: [],
    mute: links.mute,
    manage: links.manage,
  };
}

export function renderMissionMail(input: MissionMailInput): RenderedMissionMail {
  const locale = input.locale && missionMailCatalog[input.locale] ? input.locale : 'en';
  const dir = directionOf(locale);
  const catalog = missionMailCatalog[locale];
  const body = compose(input, catalog);
  const start = dir === 'rtl' ? 'right' : 'left';
  const p = (text: string) =>
    `<p style="margin:0 0 16px 0;font-family:${font};font-size:16px;line-height:24px;color:${colour.ink};text-align:${start};">${escapeHtml(text)}</p>`;
  const signature = body.signature
    ? `<p style="margin:0 0 16px 0;font-family:${font};font-size:16px;line-height:24px;color:${colour.ink};text-align:${start};">${body.signature.map(escapeHtml).join('<br>')}</p>`
    : '';
  const button = `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 24px 0;"><tr><td style="border-radius:8px;background:${colour.action};"><a href="${escapeHtml(body.button.url)}" style="display:inline-block;min-height:48px;padding:0 24px;font-family:${font};font-size:16px;line-height:48px;font-weight:600;color:${colour.onAction};text-decoration:none;border-radius:8px;">${escapeHtml(body.button.label)}</a></td></tr></table>`;
  const linkStyle = `color:${colour.action};text-decoration:underline;`;
  const language = fillMission(catalog.language, { language_code: locale });
  const footer = `${escapeHtml(catalog.footerWhy)} <a href="${escapeHtml(body.mute)}" style="${linkStyle}">${escapeHtml(catalog.mute)}</a> | <a href="${escapeHtml(body.manage)}" style="${linkStyle}">${escapeHtml(catalog.manage)}</a> | ${escapeHtml(language)}`;
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
    signature,
    button,
    body.closing.map(p).join(''),
    '</td></tr>',
    `<tr><td style="padding:8px 32px 24px 32px;border-top:1px solid ${colour.line};font-family:${font};font-size:12px;line-height:18px;color:${colour.muted};text-align:${start};">${footer}</td></tr>`,
    '</table></td></tr></table></body></html>',
  ].join('');
  const text = [
    ...body.paragraphs,
    ...(body.signature ? [body.signature.join('\n')] : []),
    `${body.button.label}: ${body.button.url}`,
    ...body.closing,
    `${catalog.footerWhy}\n${catalog.mute}: ${body.mute}\n${catalog.manage}: ${body.manage}\n${language}`,
  ].join('\n\n');
  return { subject: body.subject, preheader: body.preheader, html, text, locale, dir };
}
