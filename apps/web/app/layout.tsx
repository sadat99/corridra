import type { Metadata } from 'next';
import './globals.css';

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
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
