import type { Metadata } from 'next';
import localFont from 'next/font/local';
import './globals.css';
import { readNeonAuthConfig } from '@corridra/config';
import { SiteHeader } from '../components/site-header';
import { SiteFooter } from '../components/site-footer';
import { CornerDock } from '../components/corner-dock';
import { LanguageProvider } from '../components/language-provider';
import { SkipLink } from '../components/skip-link';
import { CanonicalLink } from '../components/ux/canonical-link';
import { languageBootScript } from '../lib/ux/language-boot';
import { offeredLanguages } from '../lib/i18n/locales';
import { languagesWithPages } from '../lib/i18n/pages';
import { uxSwitchOn } from '../lib/ux-switches';
import { realUseEnabled } from '@corridra/auth/customer-production';

// Self-hosted variable fonts (SIL OFL, licences in fonts/). Newsreader sets public and section
// headings, Geist the product text, Geist Mono labels and references. All three are Latin only.
// The Bangla serif is a lazy face: the browser fetches it only when a page contains Bengali
// characters, and it is never preloaded. Han text keeps the system fallbacks in --font-ui.
const newsreader = localFont({
  src: './fonts/newsreader-latin-variable.woff2',
  variable: '--font-newsreader',
  weight: '200 800',
  display: 'swap',
  adjustFontFallback: 'Times New Roman',
});
const geist = localFont({
  src: './fonts/geist-latin-variable.woff2',
  variable: '--font-geist',
  weight: '100 900',
  display: 'swap',
  adjustFontFallback: 'Arial',
});
const geistMono = localFont({
  src: './fonts/geist-mono-latin-variable.woff2',
  variable: '--font-geist-mono',
  weight: '100 900',
  display: 'swap',
  adjustFontFallback: 'Arial',
});
const notoSerifBengali = localFont({
  src: './fonts/noto-serif-bengali-variable.woff2',
  variable: '--font-bengali',
  weight: '100 900',
  display: 'swap',
  preload: false,
  declarations: [
    {
      prop: 'unicode-range',
      value: 'U+0951-0952,U+0964-0965,U+0980-09FE,U+200C-200D,U+20B9,U+25CC',
    },
  ],
});
// The Bangla sans is the face for buttons, labels, tables and text (ADR-066 decision 1, recorded in
// the language review record). It is lazy in the same way: fetched only when a page has Bengali
// characters, never preloaded. The serif above stays for headings.
const notoSansBengali = localFont({
  src: './fonts/noto-sans-bengali-variable.woff2',
  variable: '--font-bengali-sans',
  weight: '100 900',
  display: 'swap',
  preload: false,
  declarations: [
    {
      prop: 'unicode-range',
      value: 'U+0951-0952,U+0964-0965,U+0980-09FE,U+200C-200D,U+20B9,U+25CC',
    },
  ],
});
const fontVariables = [
  newsreader.variable,
  geist.variable,
  geistMono.variable,
  notoSerifBengali.variable,
  notoSansBengali.variable,
].join(' ');

export const metadata: Metadata = {
  title: 'Corridra | Cross-border market access',
  description:
    'Know who is worth meeting before you arrive. Corridra is being built for cross-border market access, starting with Bangladesh and Spain/EU.',
  applicationName: 'Corridra',
  openGraph: {
    title: 'Corridra | Know who is worth meeting.',
    description: 'Cross-border market access. Starting with Bangladesh and Spain/EU.',
    type: 'website',
    locale: 'en_GB',
  },
  twitter: { card: 'summary' },
  robots: { index: true, follow: true },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const offered = offeredLanguages();
  return (
    // The boot script may set lang and dir before React loads; the provider keeps them after.
    <html lang="en" className={fontVariables} suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: languageBootScript(offered.map((item) => item.code)),
          }}
        />
      </head>
      <body>
        <LanguageProvider offered={offered} pageLocales={languagesWithPages()}>
          <CanonicalLink />
          <SkipLink />
          <div className="site-shell">
            <SiteHeader
              shells={uxSwitchOn('CORRIDRA_UX_SHELLS_V2')}
              notifications={uxSwitchOn('CORRIDRA_NOTIFICATIONS_V2')}
              live={process.env.VERCEL_ENV === 'production'}
              accounts={readNeonAuthConfig() !== null}
              mode={
                uxSwitchOn('CORRIDRA_UX_FIRSTQ')
                  ? realUseEnabled()
                    ? 'real'
                    : 'sample'
                  : undefined
              }
            />
            {children}
            <SiteFooter />
            <CornerDock />
          </div>
        </LanguageProvider>
      </body>
    </html>
  );
}
