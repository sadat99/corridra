import type { Metadata } from 'next';
import localFont from 'next/font/local';
import './globals.css';
import { readNeonAuthConfig } from '@corridra/config';
import { SiteHeader } from '../components/site-header';
import { SiteFooter } from '../components/site-footer';
import { CornerDock } from '../components/corner-dock';

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
const fontVariables = [
  newsreader.variable,
  geist.variable,
  geistMono.variable,
  notoSerifBengali.variable,
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
  return (
    <html lang="en" className={fontVariables}>
      <body>
        <a className="skip-link" href="#main">
          Skip to content
        </a>
        <div className="site-shell">
          <SiteHeader accounts={readNeonAuthConfig() !== null} />
          {children}
          <SiteFooter />
          <CornerDock />
        </div>
      </body>
    </html>
  );
}
