import { Arrow } from './arrow';
import Link from 'next/link';
export function SiteFooter() {
  return (
    <footer className="public-footer">
      <div className="footer-top">
        <div>
          <Link prefetch={false} className="brand" href="/">
            corridra
          </Link>
          <p>Make market entry deliberate.</p>
          <span>Initial directions: Bangladesh ↔ China / Spain / EU</span>
        </div>
        <nav aria-label="Footer solutions">
          <Link prefetch={false} href="/sell">
            Sell in a new market
          </Link>
          <Link prefetch={false} href="/source">
            Source suppliers
          </Link>
          <Link prefetch={false} href="/enter-market">
            Enter a new market
          </Link>
          <Link prefetch={false} href="/trade-missions">
            Run a trade mission
          </Link>
        </nav>
        <nav aria-label="About Corridra">
          <Link prefetch={false} href="/how-it-works">
            How it works
          </Link>
          <Link prefetch={false} href="/network">
            Corridra Network
          </Link>
          <Link prefetch={false} href="/institutions">
            For Institutions
          </Link>
          <Link prefetch={false} href="/trust">
            Trust & Evidence
          </Link>
          <Link prefetch={false} href="/about">
            About Corridra
          </Link>
        </nav>
      </div>
      <div className="footer-bottom">
        <span>© 2026 Corridra</span>
        <Link prefetch={false} href="/privacy">
          Test intake notice
        </Link>
        <Link prefetch={false} href="/coming-soon">
          The original launch page
        </Link>
        <Link prefetch={false} href="#main">
          Back to top <Arrow />
        </Link>
      </div>
    </footer>
  );
}
