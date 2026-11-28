'use client';

// What the person sees once the request is saved and the account steps remain (owner canvas board v10, 28 Nov 2026).
// It names the route and goal from the answers still in this tab and lists the steps that follow. Nothing is read from
// the server: the page only says what it knows, that the save was accepted and what the next steps are.
export function PlanReceived({
  goal,
  company,
  market,
  answers,
  signedIn,
  test = false,
}: {
  goal: string;
  company: string;
  market: string;
  answers: number;
  signedIn: boolean;
  test?: boolean;
}) {
  const steps = test
    ? ([
        { title: 'Request saved', note: 'Just now', state: 'done' },
        { title: 'Keep your receipt', note: 'It is how you check this request', state: 'now' },
        { title: 'We review it', note: 'Then we propose next steps', state: 'next' },
      ] as const)
    : ([
        { title: 'Request saved', note: 'Just now', state: 'done' },
        {
          title: signedIn ? 'Verify your email' : 'Create your account',
          note: signedIn ? 'One quick code' : 'Your request will be waiting in it',
          state: 'now',
        },
        {
          title: signedIn ? 'Sign in on this device' : 'Verify your email',
          note: 'Use this same device and browser',
          state: 'next',
        },
        { title: 'We review it', note: 'Then we propose next steps', state: 'next' },
      ] as const);
  return (
    <>
      <span className="pv-saved">✓ Saved</span>
      <div className="pv-chips">
        {company && <span>{company}</span>}
        {company && market && <em aria-hidden="true">→</em>}
        {market && <span>{market}</span>}
        {goal && <span className="pv-chip-plain">{goal}</span>}
        <span className="pv-chip-plain">{answers} answers saved</span>
      </div>
      <ol className="pv-timeline">
        {steps.map((step, index) => (
          <li key={step.title} data-state={step.state}>
            <span className="pv-tl-dot" aria-hidden="true">
              {step.state === 'done' ? '✓' : index + 1}
            </span>
            <span>
              <b>{step.title}</b>
              <span>{step.note}</span>
            </span>
          </li>
        ))}
      </ol>
    </>
  );
}
