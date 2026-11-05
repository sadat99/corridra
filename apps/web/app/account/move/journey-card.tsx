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
          <dd data-words={/^[0-9]/.test(item.value) ? undefined : 'true'}>{item.value}</dd>
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

/** "9 to 13 Apr 2027", "28 Mar to 2 Apr 2027" or the two full dates, in the programme's own time zone. */
export function dateRange(start: string, end: string, timeZone: string, locale: string) {
  const parts = (value: string) => {
    try {
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) return null;
      const get = (o: Intl.DateTimeFormatOptions) =>
        new Intl.DateTimeFormat(locale, { ...o, timeZone }).format(date);
      return {
        day: get({ day: 'numeric' }),
        month: get({ month: 'short' }),
        year: get({ year: 'numeric' }),
      };
    } catch {
      return null;
    }
  };
  const a = parts(start);
  const b = parts(end);
  if (!a || !b) return '';
  if (a.year !== b.year) return `${a.day} ${a.month} ${a.year} to ${b.day} ${b.month} ${b.year}`;
  if (a.month !== b.month) return `${a.day} ${a.month} to ${b.day} ${b.month} ${b.year}`;
  return a.day === b.day
    ? `${a.day} ${a.month} ${a.year}`
    : `${a.day} to ${b.day} ${b.month} ${b.year}`;
}

const shared = (n: number | null) => (n === null ? 'Not shared' : String(n));

function sourceBody(f: SourceFacts) {
  // How each quote is backed is shown on its own card in the report; Home counts the verified ones.
  return {
    meta: f.quotes ? '' : 'No quotes on the current request yet',
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
  const dates = f.startsAt && f.endsAt ? dateRange(f.startsAt, f.endsAt, zone, locale) : '';
  const people = [
    `${f.ready} ready`,
    f.invitationsOpen === null ? '' : `${f.invitationsOpen} invites open`,
    f.conflicts ? `${f.conflicts} ${plural(f.conflicts, 'conflict', 'conflicts')}` : '',
  ].filter(Boolean);
  return {
    meta: [dates, people.join(', ')].filter(Boolean).join(' · '),
    stats: [
      {
        value: String(f.participants),
        label: plural(f.participants, 'participant', 'participants'),
      },
      { value: shared(f.scheduled), label: 'scheduled' },
      { value: shared(f.qualifiedHeld), label: 'qualified' },
    ],
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
          <StageBar status={card.status} labels={labels} note={body?.meta || undefined} />
        ) : card.statusWords ? (
          <p className="move-journey-status">{card.statusWords}</p>
        ) : null}
        {body ? (
          <>
            {body.meta && !card.status ? <p className="move-journey-status">{body.meta}</p> : null}
            <Stats items={body.stats} label={`${title}: numbers`} />
            {card.journey === 'organise' ? (
              <Private>Counts only. Participants&apos; details stay private.</Private>
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

/** Taking part: shown with the journeys, only for a programme the person is registered for. */
export function ParticipantCard({ facts }: { facts: ParticipantFacts }) {
  return (
    <article className="move-journey" data-journey="part" aria-labelledby="move-journey-part">
      <header className="move-journey-head">
        <span className="move-tag" data-journey="part">
          Taking part
        </span>
        <h3 id="move-journey-part" dir="auto">
          {facts.name}
        </h3>
      </header>
      <div className="move-journey-body">
        <Private>
          Your quotes, contacts and costs stay private. Organisers see only the name you agreed to
          share.
        </Private>
      </div>
      <footer className="move-journey-foot">
        <span>{facts.registered === 1 ? 'Registered' : `Registered for ${facts.registered}`}</span>
        <Link prefetch={false} className="move-card-link" href={facts.href}>
          <span>Open My Programmes</span>
          <CorridraIcon name="arrow" />
        </Link>
      </footer>
    </article>
  );
}
