'use client';

import { CorridraIcon } from './corridra-icon';
import { HowTile, RulesTile, personIcon } from './home-v42-parts';
import { useT } from './language-provider';
import {
  DeepFaq,
  DeepFrame,
  DeepHead,
  DeepHero,
  key,
  RelatedLink,
  StartBand,
} from './how-trust-v43-parts';
import { FlaggedNames, PlaceWords } from './place-words';
import { howTrustV43 } from '../content/how-trust-v43';
import { publicPages } from '../content/public-pages';
import { intentKeys, stageIds, v43 } from '../lib/home-v43-data';

// /how-it-works with CORRIDRA_UX_HOW_TRUST_V43 on (owner, 26 Nov 2026, first hand to Guardian G66: "yes to all three,
// build it"; mockup docs/revamp/mockups/how-trust-v43/how-it-works.html on branch claude/mockups-how-trust). The page
// has one job, the whole process, and shows all of it: the six steps in two phases, the four stages by route, the
// fourteen stages with the optional ones and the four rules, the eight roles and the process questions, then one Start
// a Request. Nothing sits behind Show More (owner exception in docs/revamp/specs/layout-budget.md).
const content = publicPages['how-it-works']!;
const page = howTrustV43.howItWorks;

function Approach() {
  const groups = content.groups!;
  const total = content.sections.length;
  const size = Math.ceil(total / groups.length);
  return (
    <section className="hv43-band" id="page-approach" aria-labelledby="approach-title">
      <DeepHead
        id="approach-title"
        eyebrow={page.approachEyebrow}
        title={content.introduction.title}
        lead={content.introduction.text}
      />
      <div className="htv43-cards htv43-cols-2" role="group" aria-label="The approach">
        {groups.map((title, index) => {
          const start = index * size;
          const items = content.sections.slice(start, start + size);
          return (
            <section key={title} className="htv43-phase" aria-labelledby={`phase-${index}`}>
              <header>
                <h3 id={`phase-${index}`}>{title}</h3>
                <p>
                  Steps {start + 1} to {start + items.length}
                </p>
              </header>
              <ol>
                {items.map((section, i) => {
                  const next = content.sections[start + i + 1];
                  return (
                    <li key={section.title} className="htv43-step">
                      <span className="htv43-step-no" aria-hidden="true">
                        {start + i + 1}
                      </span>
                      <h4>{section.title}</h4>
                      <p className="label htv43-step-name">{section.name}</p>
                      <p className="htv43-step-line">
                        <span>
                          Step {start + i + 1} of {total}: {section.name}
                        </span>
                        {next?.name ? (
                          <>
                            <span aria-hidden="true"> · </span>
                            <span>Next: {next.name}</span>
                          </>
                        ) : null}
                      </p>
                      <p>{section.text}</p>
                    </li>
                  );
                })}
              </ol>
            </section>
          );
        })}
      </div>
    </section>
  );
}

function Expect() {
  return (
    <section className="hv43-band htv43-selected" id="page-next" aria-labelledby="close-title">
      <div className="htv43-split">
        <div className="htv43-lede">
          <p className="label ux-eyebrow ac1-rule">{page.expectEyebrow}</p>
          <h2 id="close-title">{content.closing.title}</h2>
          <p>{content.closing.text}</p>
          <RelatedLink href={content.related.href} label={content.related.label} />
        </div>
        <ul className="htv43-statements">
          {content.statements!.map((statement) => (
            <li key={statement}>{statement}</li>
          ))}
        </ul>
      </div>
    </section>
  );
}

/** The four stages of each route, as the home explorer drew them for the chosen route: here every route, static. */
function Stages() {
  const t = useT();
  return (
    <section className="hv43-band hv43-process" id="process" aria-labelledby="process-title">
      <DeepHead
        id="process-title"
        eyebrow={t(v43('process.eyebrow'))}
        title={t(v43('process.title'))}
        lead={t(v43('process.lead'))}
      />
      <ul className="htv43-cards htv43-cols-4" aria-label={t(v43('process.group'))}>
        {intentKeys.map((route) => (
          <li key={route} className="htv43-card">
            <h3>
              <PlaceWords text={t(v43(`door.${route}.title`))} />
            </h3>
            <ol className="htv43-stages">
              {stageIds.map((n) => (
                <li key={n}>
                  <span className="htv43-stage">{t(v43(`process.step.${n}`))}</span>
                  <strong>{t(v43(`process.rec.${route}.${n}.title`))}</strong>
                  <p>{t(v43(`process.rec.${route}.${n}.line`))}</p>
                </li>
              ))}
            </ol>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** The fourteen stages and the four rules, the live words of the home disclosure; the optional ones are dashed and named. */
function Fourteen() {
  return (
    <div className="hv43-band htv43-subtle htv43-how">
      <HowTile />
      <p className="htv43-legend" aria-hidden="true">
        <i className="htv43-dot" />
        {page.optionalKey}
      </p>
      <RulesTile />
    </div>
  );
}

function Roles() {
  const t = useT();
  return (
    <section className="hv43-band" id="who" aria-labelledby="who-title">
      <DeepHead id="who-title" eyebrow={t('home.tr.pe.eyebrow')} title={t('home.tr.pe.title')} />
      <ul className="htv43-cards htv43-cols-4" id="who-panel" aria-label={t('home.tr.pe.aria')}>
        {Array.from({ length: 8 }, (_, i) => (
          <li key={i} className="htv43-card">
            <div className="htv43-card-head">
              <span className="hv43-icon" aria-hidden="true">
                <CorridraIcon name={personIcon[i]!} size={20} />
              </span>
              <h3>
                <FlaggedNames text={t(key(`home.tr.pe.${i}`))} />
              </h3>
            </div>
            <div className="htv43-kv">
              <p className="label">{t('home.tr.pe.give')}</p>
              <p>{t(key(`home.tr.pe.${i}.give`))}</p>
            </div>
            <div className="htv43-kv is-get">
              <p className="label">{t('home.tr.pe.get')}</p>
              <p>{t(key(`home.tr.pe.${i}.get`))}</p>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function HowItWorksV43() {
  return (
    <DeepFrame>
      <DeepHero
        content={content}
        action={page.action}
        tocLabel={howTrustV43.tocLabel}
        toc={page.toc}
      />
      <Approach />
      <Expect />
      <Stages />
      <Fourteen />
      <Roles />
      <DeepFaq ids={howTrustV43.faq.howItWorks} subtle />
      <StartBand band={content.band!} />
    </DeepFrame>
  );
}
