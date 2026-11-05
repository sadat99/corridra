'use client';

import Link from 'next/link';
import { useMemo, useSyncExternalStore } from 'react';
import { MoveCard, StageBar, mrLabelsFor, type MoveVerb } from '../../../components/mr';
import { RowLink, RowList } from '../../../components/ux/row-list';
import { CorridraIcon } from '../../../components/corridra-icon';
import { useLanguage } from '../../../components/language-provider';
import { fill } from '../../../lib/i18n/fill';
import { localeMeta } from '../../../lib/i18n/locales';
import { translate, type MessageKey } from '../../../lib/i18n/messages';
import { moveWorkspaceCap } from '../../../lib/move-constants';
import { formatDate } from '../../../lib/ux/format';
import {
  unreadReplies,
  type MoveCardData,
  type MoveModel,
  type WaitingRow,
} from '../../../lib/move-cards';
import {
  journeys as journeyOrder,
  journeyWords,
  type Journey,
  type JourneyCard,
  type LatestItem,
} from './journeys';
import { JourneyCardView, ParticipantCard } from './journey-card';
import type { JourneyFacts } from '../../../lib/home-journeys/load';
import './move-view.css';

// The last reply a person marked as read, per request. It lives in this browser only (the same
// idea as the language choice): the server never learns what was read, and "forget" clears it.
const seenKey = 'corridra.move.seen';
const firstShown = 3;

function parse(text: string): Record<string, string> {
  try {
    const value: unknown = JSON.parse(text);
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, string>)
      : {};
  } catch {
    return {};
  }
}

// Where storage is blocked the mark is kept for this visit only (the same rule as the language choice).
let memory: string | null = null;
const listeners = new Set<() => void>();
function snapshot(): string {
  if (memory !== null) return memory;
  try {
    return window.localStorage.getItem(seenKey) ?? '{}';
  } catch {
    return '{}';
  }
}
function subscribe(listener: () => void) {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key === null || event.key === seenKey) memory = null;
    listener();
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', onStorage);
  };
}
function commit(value: Record<string, string>) {
  memory = JSON.stringify(value);
  try {
    window.localStorage.setItem(seenKey, memory);
  } catch {
    /* The mark still applies to this visit. */
  }
  listeners.forEach((listener) => listener());
}

const verbOf: Record<Exclude<MoveCardData['kind'], 'move'>, MoveVerb> = {
  draft: 'Send',
  quote: 'Answer',
  company: 'Add',
  report: 'Read',
};
const objectKey: Record<Exclude<MoveCardData['kind'], 'move'>, MessageKey> = {
  draft: 'move.card.draft.object',
  quote: 'move.card.quote.object',
  company: 'move.card.company.object',
  report: 'wsb.move.report.object',
};
const actionKey: Record<MoveCardData['kind'], MessageKey> = {
  // Older label kept for the catalogue; an unsent draft now reads 'Finish and send' (D6, CQ-21).
  draft: 'move.card.draft.action',
  quote: 'move.card.quote.action',
  company: 'move.card.company.action',
  move: 'move.card.reply.action',
  report: 'wsb.move.report.action',
};
/** A real due date (year-month-day) in the person's language. */
function day(value: string, locale: string) {
  // D11: one date style ("24 Oct 2026"), never a US numeric date or a raw ISO string.
  return formatDate(`${value}T00:00:00Z`, { timeZone: 'UTC', locale }) || value;
}

// Launch language is English only (owner, 4 Nov 2026), so these lines are not in the catalogues and
// carry lang="en" in every locale: no screen claims a translation nobody reviewed.
const unreadWords = {
  title: 'We could not check everything just now.',
  text: 'Something may be waiting for you that this page could not read. Your work is safe.',
  some: 'Some of your work could not be read just now, so this list may not show everything.',
  retry: 'Try again',
} as const;

/**
 * Your Move, drawn. The server decides what exists (see `buildMoveModel`); this only chooses words
 * and shows them in the person's language. The region says which language it is written in, so a
 * page whose main text is still English never mislabels it.
 */
export function MoveView({
  model,
  startHref,
  skippedWorkspaces = 0,
  partial = false,
  unreadable = false,
  latestItem = null,
  journeys = [],
  facts = null,
  journey = null,
  taskJourneys = {},
  sortIncomplete = false,
}: {
  model: MoveModel;
  startHref: string;
  skippedWorkspaces?: number;
  /** True when a list was longer than the pages read. */
  partial?: boolean;
  /** True when a source that is on could not be read, so an empty list is not proof of nothing. */
  unreadable?: boolean;
  /** The latest request's stored title, journey and status, from the work list (null when it is not there). */
  latestItem?: LatestItem | null;
  /** The newest piece of work in each journey the person has (Sourcing, Selling, Organising). */
  journeys?: JourneyCard[];
  /** The numbers on each journey card and the Taking part card; null parts keep the plain count. */
  facts?: JourneyFacts | null;
  /** The journey Home is showing (`?journey=`), or null for all of them. */
  journey?: Journey | null;
  /** Each task's and waiting row's journey, by id. A task with none shows under All only. */
  taskJourneys?: Record<string, Journey>;
  /** The work list that sorts tasks into journeys was not read in full, so a journey view may miss some. */
  sortIncomplete?: boolean;
}) {
  const { locale } = useLanguage();
  const say = (key: MessageKey) => translate(locale, key);
  const labels = useMemo(() => mrLabelsFor(locale), [locale]);
  const { html, dir } = localeMeta[locale];
  // Null on the server and on the first paint, so a reply is never shown as new before the device has been asked.
  const raw = useSyncExternalStore(subscribe, snapshot, () => null);
  const seen = useMemo(() => (raw === null ? null : parse(raw)), [raw]);

  const unread = seen ? unreadReplies(model.replyCandidates, seen) : [];
  const mark = (requestId: string, latestReplyAt: string) =>
    commit({ ...(seen ?? {}), [requestId]: latestReplyAt });
  const forget = () => commit({});

  // Under All each task says which journey it belongs to; under one journey the tag would only repeat it.
  const tag = (id: string) => {
    const j = taskJourneys[id];
    return j && !journey ? (
      <span className="move-tag move-task-tag" data-journey={j} lang="en">
        {journeyWords[j]}
      </span>
    ) : null;
  };
  const shown = (id: string) => !journey || taskJourneys[id] === journey;

  const allItems = [
    ...unread.map((reply) => (
      <li key={`reply:${reply.requestId}`} className="move-reply" data-kind="reply">
        <MoveCard
          tag={tag(`reply:${reply.requestId}`)}
          verb="Read"
          object={say('move.card.reply.object')}
          holder="you"
          context={fill(say('move.received'), { date: day(reply.received, locale) })}
          href={reply.href}
          action={say('move.card.reply.action')}
          labels={labels}
        />
        <button
          type="button"
          className="button button-secondary"
          onClick={() => mark(reply.requestId, reply.latestReplyAt)}
        >
          {say('move.card.reply.read')}
        </button>
      </li>
    )),
    ...model.cards.map((card) => (
      <li key={card.id} data-kind={card.kind}>
        {card.kind === 'move' ? (
          <MoveCard
            tag={tag(card.id)}
            verb={card.verb}
            object={card.object ?? ''}
            title={`${card.verb} ${card.object ?? ''}`}
            titleLang="en"
            holder={card.holder}
            context={card.context}
            due={card.dueOn ? day(card.dueOn, locale) : null}
            href={card.href}
            action={say(actionKey.move)}
            labels={labels}
          />
        ) : (
          <MoveCard
            tag={tag(card.id)}
            verb={verbOf[card.kind]}
            object={say(objectKey[card.kind])}
            holder={card.holder}
            context={
              card.kind === 'report'
                ? `${say('wsb.move.report.title')}: ${card.context ?? ''}`
                : card.kind === 'draft'
                  ? [card.context, labels.road.draftSubline].filter(Boolean).join(' · ')
                  : card.context
            }
            href={card.href}
            action={
              card.kind === 'draft' ? say('wsb.move.draft.action') : say(actionKey[card.kind])
            }
            labels={labels}
          />
        )}
      </li>
    )),
  ];
  const items = allItems.filter((item) => shown(String(item.key)));
  const nothing = items.length === 0;
  // The switch counts what needs the person in each journey; it appears once any task or card has one.
  const perJourney = Object.fromEntries(
    journeyOrder.map((j) => [
      j,
      allItems.filter((item) => taskJourneys[String(item.key)] === j).length,
    ]),
  ) as Record<Journey, number>;
  const present = journeyOrder.filter(
    (j) => perJourney[j] > 0 || journeys.some((card) => card.journey === j),
  );
  const cards = journey ? journeys.filter((card) => card.journey === journey) : journeys;
  const waiting = model.waiting.filter((row) => shown(row.id));
  const participant = !journey ? (facts?.participant ?? null) : null;
  // The latest request has its own card only when no journey card already shows it.
  const latestShown =
    model.latest &&
    !cards.some((card) => card.kind === 'request' && card.id === model.latest?.id) &&
    (!journey || latestItem?.journey === journey)
      ? model.latest
      : null;

  const waitingLine = (row: WaitingRow) =>
    row.kind === 'move'
      ? (row.title ?? '')
      : row.kind === 'quote'
        ? say('move.wait.quote')
        : row.kind === 'company'
          ? say('move.wait.company')
          : (labels.road.sublines[row.status as keyof typeof labels.road.sublines] ??
            labels.road.sublines.ACTIVE);
  const ownerHolders = { ...labels.holder, third: say('move.wait.owner') };

  const count = items.length;
  // The summary never claims more than the page could read: an unreadable source, a list cut short or
  // workspaces left unread make "all caught up" and "everything else is moving" unprovable.
  const incomplete = unreadable || partial || skippedWorkspaces > 0;
  const where = journey ? ` in ${journeyWords[journey].toLowerCase()}` : '';
  const needs = count === 1 ? `One thing needs you${where}` : `${count} things need you${where}`;
  // A journey view shows only tasks the work list could sort. Tasks it could not sort, or a work list that was
  // not read in full, mean the view may miss some: it says so and points to All, never "nothing needs you".
  const unsorted = allItems.filter((item) => !taskJourneys[String(item.key)]).length;
  const unsortedWords =
    unsorted === 1
      ? 'One more thing needs you under All.'
      : `${unsorted} more things need you under All.`;
  const filterGap = !!journey && (unsorted > 0 || sortIncomplete);
  const lede = filterGap
    ? nothing
      ? unsorted > 0
        ? `Nothing sorted into ${journeyWords[journey!].toLowerCase()} needs you. ${unsortedWords}`
        : `This view may not show everything${where} yet.`
      : `${needs} so far. ${unsorted > 0 ? unsortedWords : 'This view may not show everything yet.'}`
    : incomplete
      ? nothing
        ? 'This page may not show everything that needs you yet.'
        : `${needs} so far. This page may not show everything yet.`
      : nothing
        ? journey
          ? `Nothing needs you${where} right now. Here is where it stands.`
          : 'You are all caught up. Here is where your work stands.'
        : `${needs}. Everything else is moving.`;

  return (
    <div className="move-view" lang={html} dir={dir}>
      <div className="move-hello">
        <p className="move-lede" lang="en">
          {lede}
        </p>
        {present.length > 0 ? (
          <nav className="move-seg" aria-label="Show work for" lang="en">
            <Link prefetch={false} href="/account/move" aria-current={journey ? undefined : 'page'}>
              All <em>{allItems.length}</em>
            </Link>
            {present.map((j) => (
              <Link
                key={j}
                prefetch={false}
                href={`/account/move?journey=${j}`}
                aria-current={journey === j ? 'page' : undefined}
              >
                {journeyWords[j]} <em>{perJourney[j]}</em>
              </Link>
            ))}
          </nav>
        ) : null}
      </div>

      <div className="move-grid" data-latest={latestShown || waiting.length > 0 ? 'true' : 'false'}>
        <section className="move-card" aria-labelledby="move-you">
          <h2 id="move-you">{say('move.you.heading')}</h2>
          <span className="move-count" data-hot={nothing ? 'false' : 'true'}>
            <span className="sr-only">: </span>
            {count}
          </span>
          {/* With work on the page the shortcuts give way, so the way to start a request stays here. */}
          {!nothing ? (
            <Link prefetch={false} className="move-card-link" href={startHref}>
              <span>{say('move.start')}</span>
              <CorridraIcon name="arrow" />
            </Link>
          ) : null}
          {nothing && unreadable ? (
            <div className="move-empty" role="status" lang="en">
              <p>
                <strong>{unreadWords.title}</strong> {unreadWords.text}
              </p>
              <div className="move-empty-actions">
                <a className="text-link ux-action" href="/account/move">
                  {unreadWords.retry}
                </a>
                <Link prefetch={false} className="text-link ux-action" href={startHref}>
                  {say('move.start')}
                </Link>
              </div>
            </div>
          ) : nothing && journey ? (
            <div className="move-empty" role="status" lang="en">
              <p>
                <strong>Nothing here{where}.</strong>{' '}
                {filterGap
                  ? unsorted > 0
                    ? unsortedWords
                    : 'Some work may not be sorted into a journey yet.'
                  : 'Nothing in this journey needs you right now.'}
              </p>
              <Link prefetch={false} className="text-link ux-action" href="/account/move">
                Show All
              </Link>
            </div>
          ) : nothing ? (
            <div className="move-empty" role="status">
              <span className="move-empty-mark" aria-hidden="true">
                <CorridraIcon name="check" />
              </span>
              <p>
                <strong>{say('move.empty.title')}</strong> {say('move.empty.text')}
              </p>
              <div className="move-guide">
                <span className="move-guide-mark" aria-hidden="true">
                  <CorridraIcon name="draft" />
                </span>
                <span className="move-guide-words" lang="en">
                  <b>Suggested next step</b>
                  <small>Tell us your goal. It takes a few minutes.</small>
                </span>
                <Link prefetch={false} className="button button-secondary" href={startHref}>
                  {say('move.start')}
                </Link>
              </div>
            </div>
          ) : (
            <div className="move-items">
              <ul className="move-list">{items.slice(0, firstShown)}</ul>
              {items.length > firstShown ? (
                <details className="move-more">
                  <summary>{fill(say('move.more'), { count: items.length - firstShown })}</summary>
                  <ul className="move-list">{items.slice(firstShown)}</ul>
                </details>
              ) : null}
            </div>
          )}
        </section>

        {latestShown || waiting.length > 0 ? (
          <div className="move-side">
            {latestShown ? (
              <section className="move-card" aria-labelledby="move-latest">
                <h2 id="move-latest">{say('move.empty.latest')}</h2>
                <Link prefetch={false} className="move-card-link" href={latestShown.href}>
                  <span>{say('move.wait.open')}</span>
                  <CorridraIcon name="arrow" />
                </Link>
                <div className="move-latest">
                  {latestItem?.title ? (
                    <p className="move-latest-title" dir="auto">
                      {latestItem.title}
                    </p>
                  ) : null}
                  <p className="move-latest-top">
                    <span className="move-latest-sent">
                      {latestItem?.journey ? `${journeyWords[latestItem.journey]} · ` : ''}
                      {fill(say('move.received'), {
                        date: day(latestShown.createdAt.slice(0, 10), locale),
                      })}
                    </span>
                    {latestItem?.statusWords ? (
                      <span className="move-badge" lang="en">
                        {latestItem.statusWords}
                      </span>
                    ) : null}
                  </p>
                  {latestShown.status ? (
                    <StageBar status={latestShown.status} labels={labels.road} named />
                  ) : null}
                </div>
              </section>
            ) : null}
            {waiting.length > 0 ? (
              <section className="move-card" aria-labelledby="move-others">
                <h2 id="move-others">{say('move.others.heading')}</h2>
                <span className="move-count">{waiting.length}</span>
                <RowList
                  label={say('move.others.heading')}
                  title="Request"
                  columns={[{ name: 'Held by' }, { name: 'Where it stands' }]}
                  lang="en"
                >
                  {waiting.map((row) => {
                    const holders = row.holder === 'owner' ? ownerHolders : labels.holder;
                    const title =
                      row.kind !== 'move' && row.title
                        ? row.title
                        : fill(say('move.received'), {
                            date: row.received ? day(row.received, locale) : '',
                          });
                    return (
                      <RowLink
                        key={row.id}
                        href={row.href}
                        title={title}
                        cells={[
                          {
                            name: 'Held by',
                            value: holders[row.holder === 'team' ? 'team' : 'third'],
                          },
                          {
                            name: 'Where it stands',
                            value: waitingLine(row),
                            lang: row.kind === 'move' ? 'en' : undefined,
                          },
                        ]}
                      />
                    );
                  })}
                </RowList>
              </section>
            ) : null}
          </div>
        ) : null}
      </div>

      {cards.length > 0 || participant ? (
        <section className="move-journeys" aria-labelledby="move-journeys" lang="en">
          <h2 id="move-journeys" className="sr-only">
            Your work by journey
          </h2>
          {cards.map((card) => (
            <JourneyCardView
              key={card.journey}
              card={card}
              facts={facts?.[card.journey] ?? null}
              labels={labels.road}
              locale={locale}
            />
          ))}
          {participant ? <ParticipantCard facts={participant} /> : null}
        </section>
      ) : null}

      {skippedWorkspaces > 0 ? (
        <p className="move-explainer" role="note">
          {fill(say('move.capped'), { count: moveWorkspaceCap })}
        </p>
      ) : null}
      {unreadable && !nothing ? (
        <p className="move-explainer" role="note" lang="en">
          {unreadWords.some}{' '}
          <a className="text-link" href="/account/move">
            {unreadWords.retry}
          </a>
        </p>
      ) : null}
      {partial ? (
        <p className="move-explainer" role="note">
          {say('move.partial')}
        </p>
      ) : null}

      {/* The shortcuts guide an empty Home. With work on the page, New Request is in the header and the
          other two are in All tools, so the busy Home stays within one screen (owner rule). */}
      {nothing ? (
        <nav className="move-shortcuts" aria-label="Shortcuts" lang="en">
          <Link prefetch={false} className="move-tile" href="/plan#receipt-check">
            <span className="move-tile-mark" aria-hidden="true">
              <CorridraIcon name="search" />
            </span>
            <span className="move-tile-words">
              <b>Check a Request Receipt</b>
              <small>See progress and replies on a request you sent.</small>
            </span>
          </Link>
          <Link prefetch={false} className="move-tile" href="/account?view=results">
            <span className="move-tile-mark" aria-hidden="true">
              <CorridraIcon name="open" />
            </span>
            <span className="move-tile-words">
              <b>Open a Shared Mission</b>
              <small>Paste the private link you were sent.</small>
            </span>
          </Link>
          <Link prefetch={false} className="move-tile" href="/account?view=work">
            <span className="move-tile-mark" aria-hidden="true">
              <CorridraIcon name="work" />
            </span>
            <span className="move-tile-words">
              <b>See All Requests</b>
              <small>Every request in your workspaces.</small>
            </span>
          </Link>
        </nav>
      ) : null}

      {seen && Object.keys(seen).length > 0 ? (
        <div className="move-foot">
          <button type="button" className="button button-secondary" onClick={forget}>
            {say('move.forget')}
          </button>
        </div>
      ) : null}
    </div>
  );
}
