'use client';

import { usePlanWords } from './plan-words';

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
  const { word } = usePlanWords();
  const saved = {
    title: word('home.v44.plan.saved.s1'),
    note: word('home.v44.plan.saved.s1.note'),
    state: 'done',
  } as const;
  const review = {
    title: word('home.v44.plan.saved.review'),
    note: word('home.v44.plan.saved.review.note'),
    state: 'next',
  } as const;
  const steps = test
    ? ([
        saved,
        {
          title: word('home.v44.plan.saved.receipt'),
          note: word('home.v44.plan.saved.receipt.note'),
          state: 'now',
        },
        review,
      ] as const)
    : ([
        saved,
        {
          title: signedIn
            ? word('home.v44.plan.saved.verify')
            : word('home.v44.plan.saved.account'),
          note: signedIn
            ? word('home.v44.plan.saved.verify.note')
            : word('home.v44.plan.saved.account.note'),
          state: 'now',
        },
        {
          title: signedIn ? word('home.v44.plan.saved.device') : word('home.v44.plan.saved.verify'),
          note: word('home.v44.plan.saved.device.note'),
          state: 'next',
        },
        review,
      ] as const);
  return (
    <>
      <span className="pv-saved">✓ {word('home.v44.plan.saved.chip')}</span>
      <div className="pv-chips">
        {company && <span>{company}</span>}
        {company && market && <em aria-hidden="true">→</em>}
        {market && <span>{market}</span>}
        {goal && <span className="pv-chip-plain">{goal}</span>}
        <span className="pv-chip-plain">
          {word('home.v44.plan.saved.answers', { amount: answers })}
        </span>
      </div>
      <ol className="pv-timeline">
        {steps.map((step, index) => (
          <li key={index} data-state={step.state}>
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
