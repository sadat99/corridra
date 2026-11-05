// One journey card and the "Taking part" card on Home (owner-approved role mockup, 5 Nov 2026). Every
// number comes from ../../../lib/home-journeys/facts.ts; a number that could not be read is said as
// "Not shared" or left out, never drawn as zero. Launch language is English only, so these words carry
// lang="en" on the parent section.
import Link from 'next/link';
import { StageBar, type MrLabels } from '../../../components/mr';
import { CorridraIcon } from '../../../components/corridra-icon';
import { formatDate } from '../../../lib/ux/format';
import type {
  OrganiseFacts,
  ParticipantFacts,
  SellFacts,
  SourceFacts,
} from '../../../lib/home-journeys/facts';
import { journeyWords, type JourneyCard } from './journeys';

type Stat = { value: string; label: string; warn?: boolean };

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

function Stats({ items, label }: { items: Stat[]; label: string }) {
  return (
    <dl className="move-stats" aria-label={label}>
      {items.map((item) => (
        <div key={item.label} className="move-stat" data-warn={item.warn ? 'true' : undefined}>
          <dt>{item.label}</dt>
          <dd>{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function Private({ children }: { children: string }) {
  return (
    <p className="move-private">
      <CorridraIcon name="lock" />
      <span>{children}</span>
    </p>
  );
}

const shared = (n: number | null) => (n === null ? 'Not shared' : String(n));

function sourceBody(f: SourceFacts) {
  const backing = [
    f.evidence ? `${f.evidence} with evidence` : '',
    f.selfDeclared ? `${f.selfDeclared} self-declared` : '',
  ].filter(Boolean);
  return {
    meta: f.quotes
      ? backing.length
        ? `Each quote shows how it is backed: ${backing.join(', ')}.`
        : 'Each quote shows how it is backed.'
      : 'No quotes on the current request yet.',
    stats: [
      { value: String(f.quotes), label: plural(f.quotes, 'quote in', 'quotes in') },
      { value: String(f.notComparable), label: 'not comparable', warn: f.notComparable > 0 },
      { value: String(f.verified), label: 'verified' },
    ],
  };
}

function sellBody(f: SellFacts) {
  return {
    meta: `${f.shortlisted} ${plural(f.shortlisted, 'company', 'companies')} shortlisted`,
    stats: [
      { value: String(f.proposed), label: 'proposed' },
      { value: String(f.confirmed), label: 'confirmed' },
      { value: String(f.held), label: 'held' },
    ],
  };
}

function organiseBody(f: OrganiseFacts, locale: string) {
  const zone = f.timezone ?? 'UTC';
  const dates =
    f.startsAt && f.endsAt
      ? `${formatDate(f.startsAt, { timeZone: zone, locale })} to ${formatDate(f.endsAt, { timeZone: zone, locale })}`
      : '';
  const people = `${f.participants} ${plural(f.participants, 'participant', 'participants')}, ${f.ready} ready`;
  return {
    meta: [dates, people].filter(Boolean).join(' · '),
    stats: [
      ...(f.invitationsOpen === null
        ? []
        : [{ value: f.invitationsOpen, label: 'invitations open' }]),
      { value: shared(f.scheduled), label: 'meetings scheduled' },
      { value: shared(f.qualifiedHeld), label: 'qualified' },
      ...(f.conflicts
        ? [
            {
              value: String(f.conflicts),
              label: plural(f.conflicts, 'conflict', 'conflicts'),
              warn: true,
            },
          ]
        : []),
    ].slice(0, 3),
  };
}

export function JourneyCardView({
  card,
  facts,
  labels,
  locale,
}: {
  card: JourneyCard;
  facts: SourceFacts | SellFacts | OrganiseFacts | null;
  labels: MrLabels['road'];
  locale: string;
}) {
  const body = !facts
    ? null
    : card.journey === 'source'
      ? sourceBody(facts as SourceFacts)
      : card.journey === 'sell'
        ? sellBody(facts as SellFacts)
        : organiseBody(facts as OrganiseFacts, locale);
  const title = card.title ?? (card.kind === 'programme' ? 'Programme' : 'Request');
  return (
    <article
      className="move-journey"
      data-journey={card.journey}
      aria-labelledby={`move-journey-${card.journey}`}
    >
      <header className="move-journey-head">
        <span className="move-tag" data-journey={card.journey}>
          {journeyWords[card.journey]}
        </span>
        <h3 id={`move-journey-${card.journey}`} dir="auto">
          {title}
        </h3>
      </header>
      <div className="move-journey-body">
        {card.status ? (
          <StageBar status={card.status} labels={labels} />
        ) : card.statusWords ? (
          <p className="move-journey-status">{card.statusWords}</p>
        ) : null}
        {body ? (
          <>
            {body.meta ? <p className="move-journey-status">{body.meta}</p> : null}
            <Stats items={body.stats} label={`${title}: numbers`} />
            {card.journey === 'organise' ? (
              <Private>
                Counts only. Participants&apos; quotes and costs stay private to them.
              </Private>
            ) : null}
          </>
        ) : (
          <p className="move-journey-count">
            {card.count === '1' ? '1 piece of work' : `${card.count} pieces of work`} in{' '}
            {journeyWords[card.journey].toLowerCase()}
          </p>
        )}
      </div>
      <footer className="move-journey-foot">
        <span>
          {card.dateWords} {card.at ? formatDate(card.at, { timeZone: 'UTC', locale }) : ''}
        </span>
        <Link prefetch={false} className="move-card-link" href={card.href}>
          <span>{card.kind === 'programme' ? 'Open Organiser Room' : 'Open Request'}</span>
          <CorridraIcon name="arrow" />
        </Link>
      </footer>
    </article>
  );
}

export function ParticipantCard({ facts }: { facts: ParticipantFacts }) {
  return (
    <section className="move-card move-taking-part" aria-labelledby="move-taking-part" lang="en">
      <h2 id="move-taking-part">Taking part</h2>
      <span className="move-tag move-head-tag" data-journey="part">
        Participant
      </span>
      <div className="move-part">
        <p className="move-latest-title" dir="auto">
          {facts.name}
        </p>
        <p className="move-journey-status">
          {facts.registered === 1
            ? 'You are registered for this programme.'
            : `You are registered for ${facts.registered} programmes.`}
        </p>
        <Private>
          Your quotes, contacts and costs stay private. Organisers see only the display name you
          agreed to share.
        </Private>
        <Link prefetch={false} className="button button-primary move-part-action" href={facts.href}>
          Open My Programmes
        </Link>
      </div>
    </section>
  );
}
