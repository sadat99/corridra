import Link from 'next/link';
export function Corridor() {
  return (
    <div
      className="corridor"
      aria-label="Initial directions: Bangladesh–China, Bangladesh–Spain and Bangladesh–EU"
    >
      <div className="corridor-heading">
        <span className="label">INITIAL COMMERCIAL DIRECTIONS</span>
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
          <strong>Bangladesh</strong>
        </div>
        <span className="location-connection" aria-hidden="true">
          ↔
        </span>
        <div>
          <span className="location-code">CN / ES / EU</span>
          <strong>China, Spain & EU</strong>
        </div>
      </div>
      <p className="corridor-caption">
        Shared mission workflows. Each direction requires its own reviewed scope.
      </p>
      <p>
        <Link href="/corridors">Explore the initial directions</Link>
      </p>
    </div>
  );
}
