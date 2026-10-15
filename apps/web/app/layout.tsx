import type { Metadata } from 'next';
import localFont from 'next/font/local';
import './globals.css';
import { SiteHeader } from '../components/site-header';
import { SiteFooter } from '../components/site-footer';

// Self-hosted variable Inter (SIL OFL, see fonts/INTER-LICENSE.txt). Latin only; Bangla and Han
// text keeps the system fallbacks declared in --font-ui.
const inter = localFont({
  src: './fonts/inter-latin-variable.woff2',
  variable: '--font-inter',
  weight: '100 900',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Corridra | Cross-border market access',
  description:
    'Know who is worth meeting before you arrive. Corridra is being built for cross-border market access, starting with Bangladesh and Spain/EU.',
  applicationName: 'Corridra',
  openGraph: {
    title: 'Corridra | Know who is worth meeting.',
    description: 'Cross-border market access. Starting with Bangladesh and Spain/EU. Coming soon.',
    type: 'website',
    locale: 'en_GB',
  },
  twitter: { card: 'summary' },
  robots: { index: true, follow: true },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={inter.variable}>
      <body>
        <a className="skip-link" href="#main">
          Skip to content
        </a>
        <div className="site-shell">
          <SiteHeader />
          <aside className="availability-note" aria-label="Service availability">
            Mission intake is open for example requests. Customer missions are not open yet.
          </aside>
          {children}
          <SiteFooter />
        </div>
      </body>
    </html>
  );
}
