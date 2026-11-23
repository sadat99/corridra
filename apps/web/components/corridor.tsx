import Link from 'next/link';
import { Flagged } from './ux/flag';

export function Corridor() {
  return (
    <div
      className="corridor"
      aria-label="Open directions: Bangladesh to China, the EU, the UK, the US, Australia and key Asian markets"
    >
      <div className="corridor-heading">
        <span className="label">OPEN COMMERCIAL DIRECTIONS</span>
        <span className="corridor-index">03 / DIRECTIONS</span>
      </div>
      <div className="corridor-path" aria-hidden="true">
        <svg viewBox="0 0 430 260" fill="none">
          <path d="M38 205h83c54 0 68-150 122-150h149" className="path-ghost" />
          <path d="M38 205h83c54 0 68-150 122-150h149" className="path-main" />
          <path d="M38 222h80c69 0 70-150 128-150h146" className="path-companion" />
          <path d="M38 188h86c41 0 68-150 116-150h152" className="path-companion" />
          <circle cx="38" cy="205" r="7" fill="var(--ink)" />
          <circle
            cx="392"
            cy="55"
            r="12"
            fill="var(--paper)"
            stroke="var(--accent)"
            strokeWidth="2"
          />
          <circle cx="392" cy="55" r="4" fill="var(--accent)" />
          <path d="m278 50 5 5-5 5" stroke="var(--accent)" strokeWidth="2" />
          <path d="M38 229v16M392 79v16" stroke="var(--line)" />
        </svg>
        <span className="path-note">A clear path forward.</span>
      </div>
      <div className="corridor-locations">
        <div>
          <span className="location-code">BD</span>
          <strong>
            <Flagged code="bd">Bangladesh</Flagged>
          </strong>
        </div>
        <span className="location-connection" aria-hidden="true">
          →
        </span>
        <div>
          <span className="location-code">CN / EU / GB / US / AU</span>
          <strong>
            <Flagged code="cn">China</Flagged>, <Flagged code="eu">the EU</Flagged>,{' '}
            <Flagged code="gb">the UK</Flagged>, <Flagged code="us">the US</Flagged>,{' '}
            <Flagged code="au">Australia</Flagged> and{' '}
            <Flagged code="region">key Asian markets</Flagged>
          </strong>
        </div>
      </div>
      <p className="corridor-caption">
        Shared mission workflows. Each direction needs its own check of what we can do there.
      </p>
      <p>
        <Link prefetch={false} href="/corridors">
          Explore the open destinations
        </Link>
      </p>
    </div>
  );
}
