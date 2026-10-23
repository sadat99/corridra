// Branded customer identity emails: sign-in code, email confirmation code and password reset.
// Pure functions. No network, no logging. The words live in the catalog, not in the layout, so
// another language or a right-to-left script only adds a catalog entry.

export type AuthMailKind = 'sign-in-code' | 'verify-code' | 'reset-link' | 'reset-code';

export type AuthMailInput = {
  kind: AuthMailKind;
  /** Six digits. Required for the three code messages. */
  code?: string;
  /** Required for the reset link message. An https address. */
  linkUrl?: string;
  /** Plain words, for example "1 hour". Required for the reset link message. */
  expiry?: string;
  /** The person's name. Empty or missing gives a greeting without a name. */
  name?: string | null;
  locale?: string;
};

export type RenderedAuthMail = {
  subject: string;
  preheader: string;
  html: string;
  text: string;
  locale: string;
  dir: 'ltr' | 'rtl';
};

type Catalog = {
  signInCode: { subject: string; preheader: string; lead: string; ignore: string };
  verifyCode: { subject: string; preheader: string; lead: string; ignore: string };
  resetLink: {
    subject: string;
    preheader: string;
    greeting: string;
    greetingNoName: string;
    intro: string;
    expiry: string;
    button: string;
  };
  resetCode: { subject: string; preheader: string; lead: string; ignore: string };
  useCode: string;
  sentBy: string;
};

// The only placeholders any catalog text may contain.
export const authMailPlaceholders = ['otp_code', 'name', 'expiry'] as const;

export const authMailCatalog: Record<string, Catalog> = {
  en: {
    signInCode: {
      subject: 'Your Corridra code: {otp_code}',
      preheader: 'It works once and it expires soon.',
      lead: 'Your code to sign in:',
      ignore: "If you didn't ask for it, ignore this email. Nothing on your account has changed.",
    },
    verifyCode: {
      subject: 'Your Corridra code: {otp_code}',
      preheader: 'It works once and it expires soon.',
      lead: 'Your code to confirm your email address:',
      ignore: "If you didn't ask for it, ignore this email. No account will be created.",
    },
    resetLink: {
      subject: 'Reset your Corridra password',
      preheader: 'The link works once.',
      greeting: 'Hi {name},',
      greetingNoName: 'Hi,',
      intro:
        'Someone asked to reset the password on your Corridra account. If that was you, use the button.',
      expiry:
        "The link works once and expires in {expiry}. If it wasn't you, do nothing. Your password stays as it is.",
      button: 'Choose a new password',
    },
    resetCode: {
      subject: 'Reset your Corridra password',
      preheader: 'It works once and it expires soon.',
      lead: 'Your code to reset your password:',
      ignore: "If you didn't ask for it, ignore this email. Your password stays as it is.",
    },
    useCode: 'Type it where you asked for it. It works once and it expires soon.',
    sentBy: 'Sent by Corridra.',
  },
};

const rightToLeft = new Set(['ar', 'fa', 'he', 'ur']);

export function directionOf(locale: string): 'ltr' | 'rtl' {
  return rightToLeft.has(locale.toLowerCase().split('-')[0]) ? 'rtl' : 'ltr';
}

// AC/1 values. Email clients do not read CSS variables, so the layout names them here.
const colour = {
  page: '#F6F8FB',
  card: '#FFFFFF',
  line: '#D8E0EA',
  ink: '#18283C',
  navy: '#142438',
  muted: '#4B5A6C',
  action: '#2856C5',
  onAction: '#FFFFFF',
} as const;
export const authMailColours = colour;

const font =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif";
const mono = "ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace";

export function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

/** Fills {placeholders}. A placeholder with no value, or an unknown one, is an error, never text. */
export function fill(template: string, values: Partial<Record<string, string>>) {
  return template.replace(/\{([a-z_]+)\}/g, (_, key: string) => {
    const value = values[key];
    if (!(authMailPlaceholders as readonly string[]).includes(key) || value === undefined)
      throw new Error(`Unknown or missing mail placeholder: ${key}`);
    return value;
  });
}

function cleanName(name: string | null | undefined) {
  const value = (name ?? '')
    .replace(/[\u0000-\u001f\u007f<>]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return value.slice(0, 80);
}

function assertCode(code: string | undefined) {
  if (!code || !/^[0-9]{6}$/.test(code)) throw new Error('A six-digit code is required');
  return code;
}

function assertLink(url: string | undefined) {
  if (!url) throw new Error('A link is required');
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password)
    throw new Error('The link must be a plain https address');
  return parsed.href;
}

type Body = {
  subject: string;
  preheader: string;
  paragraphs: string[];
  code?: string;
  button?: { label: string; url: string };
  closing: string[];
};

function compose(input: AuthMailInput, catalog: Catalog): Body {
  const { kind } = input;
  if (kind === 'reset-link') {
    const copy = catalog.resetLink;
    const name = cleanName(input.name);
    if (!input.expiry) throw new Error('An expiry is required');
    return {
      subject: copy.subject,
      preheader: copy.preheader,
      paragraphs: [name ? fill(copy.greeting, { name }) : copy.greetingNoName, copy.intro],
      button: { label: copy.button, url: assertLink(input.linkUrl) },
      closing: [fill(copy.expiry, { expiry: input.expiry })],
    };
  }
  const otp_code = assertCode(input.code);
  const copy =
    kind === 'sign-in-code'
      ? catalog.signInCode
      : kind === 'verify-code'
        ? catalog.verifyCode
        : catalog.resetCode;
  return {
    subject: fill(copy.subject, { otp_code }),
    preheader: copy.preheader,
    paragraphs: [copy.lead],
    code: otp_code,
    closing: [catalog.useCode, copy.ignore],
  };
}

export function renderAuthMail(input: AuthMailInput): RenderedAuthMail {
  const locale = input.locale && authMailCatalog[input.locale] ? input.locale : 'en';
  const dir = directionOf(locale);
  const body = compose(input, authMailCatalog[locale]);
  const sentBy = authMailCatalog[locale].sentBy;
  const start = dir === 'rtl' ? 'right' : 'left';
  const p = (text: string) =>
    `<p style="margin:0 0 16px 0;font-family:${font};font-size:16px;line-height:24px;color:${colour.ink};text-align:${start};">${escapeHtml(text)}</p>`;
  const codeBlock = body.code
    ? `<div dir="ltr" style="margin:8px 0 24px 0;padding:16px 8px;text-align:center;background:${colour.page};border:1px solid ${colour.line};border-radius:8px;font-family:${mono};font-size:32px;line-height:40px;font-weight:600;letter-spacing:0.18em;font-variant-numeric:tabular-nums;color:${colour.navy};-webkit-user-select:all;user-select:all;">${escapeHtml(body.code)}</div>`
    : '';
  const button = body.button
    ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 24px 0;"><tr><td style="border-radius:8px;background:${colour.action};"><a href="${escapeHtml(body.button.url)}" style="display:inline-block;min-height:48px;padding:0 24px;font-family:${font};font-size:16px;line-height:48px;font-weight:600;color:${colour.onAction};text-decoration:none;border-radius:8px;">${escapeHtml(body.button.label)}</a></td></tr></table>`
    : '';
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
    codeBlock,
    button,
    body.closing.map(p).join(''),
    '</td></tr>',
    `<tr><td style="padding:8px 32px 24px 32px;border-top:1px solid ${colour.line};font-family:${font};font-size:12px;line-height:18px;color:${colour.muted};text-align:${start};">${escapeHtml(sentBy)}</td></tr>`,
    '</table></td></tr></table></body></html>',
  ].join('');
  const text = [
    ...body.paragraphs,
    ...(body.code ? [body.code] : []),
    ...(body.button ? [body.button.label + ': ' + body.button.url] : []),
    ...body.closing,
    sentBy,
  ].join('\n\n');
  return { subject: body.subject, preheader: body.preheader, html, text, locale, dir };
}

/** "10 minutes", "1 hour". From the provider's own expiry and event time, never a guess. */
export function expiryWords(expiresAt: string, eventTimestamp: string | number) {
  const end = Date.parse(expiresAt);
  const start = typeof eventTimestamp === 'number' ? eventTimestamp : Date.parse(eventTimestamp);
  if (!Number.isFinite(end) || !Number.isFinite(start) || end <= start)
    throw new Error('The expiry time is not usable');
  const minutes = Math.max(1, Math.min(1440, Math.round((end - start) / 60000)));
  if (minutes < 60) return `${minutes} ${minutes === 1 ? 'minute' : 'minutes'}`;
  const hours = Math.round(minutes / 60);
  return `${hours} ${hours === 1 ? 'hour' : 'hours'}`;
}

// Contrast helper for tests: WCAG relative luminance ratio of two #RRGGBB colours.
export function contrastRatio(a: string, b: string) {
  const channel = (hex: string, i: number) => {
    const v = parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  const lum = (hex: string) =>
    0.2126 * channel(hex, 0) + 0.7152 * channel(hex, 1) + 0.0722 * channel(hex, 2);
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}
