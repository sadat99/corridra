import Link from 'next/link';
import { waysToWork } from './ways-to-work';

/** The header already carries How it works and Routes, so the footer repeats neither. */
const company = [
  ['/workspace', 'Start here'],
  ['/corridors#mission-example', 'Sample mission'],
  ['/trust', 'Trust and evidence'],
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
        </span>
      </div>
    </footer>
  );
}
