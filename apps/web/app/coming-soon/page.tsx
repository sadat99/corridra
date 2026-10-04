const stages = [
  {
    number: '01',
    title: 'Define the objective',
    description: 'Start with what you want to achieve.',
  },
  { number: '02', title: 'Find the right fit', description: 'Focus on companies worth pursuing.' },
  { number: '03', title: 'Create access', description: 'Work towards a relevant conversation.' },
  {
    number: '04',
    title: 'Follow it through',
    description: 'Keep the next commercial step in view.',
  },
];

function Arrow({ diagonal = false }: { diagonal?: boolean }) {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      {diagonal ? (
        <path d="M5 15 15 5M5 5h10v10" stroke="currentColor" strokeWidth="1.5" />
      ) : (
        <path d="M3 10h13m-5-5 5 5-5 5" stroke="currentColor" strokeWidth="1.5" />
      )}
    </svg>
  );
}

function Corridor() {
  return (
    <div className="corridor" aria-label="Initial corridor: Bangladesh and Spain/EU">
      <div className="corridor-heading">
        <span className="label">WHERE WE ARE STARTING</span>
        <span className="corridor-index">01 / CORRIDOR</span>
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
          <span className="location-code">ES / EU</span>
          <strong>Spain & Europe</strong>
        </div>
      </div>
      <p className="corridor-caption">Starting with one corridor. Building for what comes next.</p>
    </div>
  );
}

export const metadata = { title: 'Coming soon | Corridra' };

export default function ComingSoon() {
  return (
    <main id="main" tabIndex={-1}>
      <section className="hero" aria-labelledby="hero-title">
        <div className="hero-copy">
          <p className="label hero-label">CROSS-BORDER MARKET ACCESS</p>
          <h1 id="hero-title">
            Going into a<br className="desktop-break" /> new market?
            <br />
            <span>
              Know who is
              <br className="desktop-break" /> worth meeting.
            </span>
          </h1>
          <p className="hero-description">
            We’re building Corridra to help you identify, qualify and reach the companies that fit
            your commercial objective. Then keep track of what happens next.
          </p>
          <div className="hero-actions">
            <a className="primary-link" href="#approach">
              See what’s taking shape <Arrow />
            </a>
            <span className="launch-status">
              <span aria-hidden="true" />
              Coming soon
            </span>
          </div>
          <p className="hero-reassurance">
            For companies selling, sourcing or entering a new market.
          </p>
        </div>
        <Corridor />
      </section>

      <section className="approach" id="approach" aria-labelledby="approach-title">
        <div className="section-intro">
          <p className="label">THE APPROACH</p>
          <h2 id="approach-title">
            A meeting is a start.
            <br />
            What follows matters.
          </h2>
          <p>
            From the first commercial objective to the next useful step. This is the process we’re
            building around.
          </p>
        </div>
        <ol className="stages">
          {stages.map((stage) => (
            <li key={stage.number}>
              <span className="stage-number">{stage.number}</span>
              <h3>{stage.title}</h3>
              <p>{stage.description}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="closing" aria-labelledby="closing-title">
        <p className="label">TAKING SHAPE</p>
        <div className="closing-content">
          <h2 id="closing-title">
            Make market entry
            <br />
            <em>deliberate.</em>
          </h2>
          <div className="closing-note">
            <span className="launch-status">
              <span aria-hidden="true" />
              Coming soon
            </span>
            <p>
              We’re getting the first corridor ready.
              <br />
              Mission planning will open here.
            </p>
          </div>
        </div>
      </section>
    </main>
  );
}
