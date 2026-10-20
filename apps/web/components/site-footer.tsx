import Link from 'next/link';
import { waysToWork } from './ways-to-work';

const learn = [
  ['/how-it-works', 'How it works'],
  ['/corridors', 'Trade routes'],
  ['/corridors#mission-example', 'Sample mission'],
  ['/trust', 'Trust and evidence'],
] as const;

const company = [
  ['/workspace', 'Start here'],
  ['/about', 'About Corridra'],
  ['/network', 'Corridra Network'],
  ['/institutions', 'For institutions'],
] as const;

export function SiteFooter() {
  return (
    <footer className="guide-footer">
      <div className="guide-footer-top">
        <div className="guide-footer-brand">
          <Link prefetch={false} className="brand" href="/">
            Corridra
          </Link>
          <p>Make market entry deliberate.</p>
          <span>Initial product directions: Bangladesh to China, Spain and the EU.</span>
        </div>
        <nav aria-label="Footer solutions">
          <p className="label">WAYS TO WORK</p>
          {waysToWork.map(({ href, label }) => (
            <Link prefetch={false} key={href} href={href}>
              {label}
            </Link>
          ))}
        </nav>
        <nav aria-label="Learn">
          <p className="label">LEARN</p>
          {learn.map(([href, label]) => (
            <Link prefetch={false} key={href} href={href}>
              {label}
            </Link>
          ))}
        </nav>
        <nav aria-label="About Corridra">
          <p className="label">CORRIDRA</p>
          {company.map(([href, label]) => (
            <Link prefetch={false} key={href} href={href}>
              {label}
            </Link>
          ))}
        </nav>
      </div>
      <div className="guide-footer-bottom">
        <span>© 2026 Corridra</span>
        <span>
          <Link prefetch={false} href="/privacy">
            Test intake notice
          </Link>
          <Link prefetch={false} href="/coming-soon">
            The original launch page
          </Link>
          <Link prefetch={false} href="#main">
            Back to top
          </Link>
        </span>
      </div>
    </footer>
  );
}
