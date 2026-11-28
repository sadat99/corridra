'use client';

import { useT } from '../../components/language-provider';
import { fill } from '../../lib/i18n/fill';

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
  const t = useT();
  const saved = {
    title: t('home.v44.plan.saved.s1'),
    note: t('home.v44.plan.saved.s1.note'),
    state: 'done',
  } as const;
  const review = {
    title: t('home.v44.plan.saved.review'),
    note: t('home.v44.plan.saved.review.note'),
    state: 'next',
  } as const;
  const steps = test
    ? ([
        saved,
        {
          title: t('home.v44.plan.saved.receipt'),
          note: t('home.v44.plan.saved.receipt.note'),
          state: 'now',
        },
        review,
      ] as const)
    : ([
        saved,
        {
          title: signedIn ? t('home.v44.plan.saved.verify') : t('home.v44.plan.saved.account'),
          note: signedIn
            ? t('home.v44.plan.saved.verify.note')
            : t('home.v44.plan.saved.account.note'),
          state: 'now',
        },
        {
          title: signedIn ? t('home.v44.plan.saved.device') : t('home.v44.plan.saved.verify'),
          note: t('home.v44.plan.saved.device.note'),
          state: 'next',
        },
        review,
      ] as const);
  return (
    <>
      <span className="pv-saved">✓ {t('home.v44.plan.saved.chip')}</span>
      <div className="pv-chips">
        {company && <span>{company}</span>}
        {company && market && <em aria-hidden="true">→</em>}
        {market && <span>{market}</span>}
        {goal && <span className="pv-chip-plain">{goal}</span>}
        <span className="pv-chip-plain">
          {fill(t('home.v44.plan.saved.answers'), { amount: answers })}
        </span>
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
