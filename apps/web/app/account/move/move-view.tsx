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
import './move-view.css';

// The last reply a person marked as read, per request. It lives in this browser only (the same
// idea as the language choice): the server never learns what was read, and "forget" clears it.
const seenKey = 'corridra.move.seen';
const firstShown = 5;

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
}: {
  model: MoveModel;
  startHref: string;
  skippedWorkspaces?: number;
  /** True when a list was longer than the pages read. */
  partial?: boolean;
  /** True when a source that is on could not be read, so an empty list is not proof of nothing. */
  unreadable?: boolean;
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

  const items = [
    ...unread.map((reply) => (
      <li key={`reply:${reply.requestId}`} className="move-reply" data-kind="reply">
        <MoveCard
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
  const nothing = items.length === 0;

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
  const lede = nothing
    ? 'You are all caught up. Here is where your work stands.'
    : count === 1
      ? 'One thing needs you. Everything else is moving.'
      : `${count} things need you. Everything else is moving.`;

  return (
    <div className="move-view" lang={html} dir={dir}>
      <p className="move-lede" lang="en">
        {lede}
      </p>

      <div className="move-grid" data-latest={model.latest ? 'true' : 'false'}>
        <section className="move-card" aria-labelledby="move-you">
          <h2 id="move-you">{say('move.you.heading')}</h2>
          <span className="move-count" data-hot={nothing ? 'false' : 'true'}>
            <span className="sr-only">: </span>
            {count}
          </span>
          {nothing && unreadable ? (
            <div className="move-empty" role="status" lang="en">
              <p>
                <strong>{unreadWords.title}</strong> {unreadWords.text}
              </p>
              <a className="text-link ux-action" href="/account/move">
                {unreadWords.retry}
              </a>
              <Link prefetch={false} className="text-link ux-action" href={startHref}>
                {say('move.start')}
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

        {model.latest ? (
          <section className="move-card" aria-labelledby="move-latest">
            <h2 id="move-latest">{say('move.empty.latest')}</h2>
            <Link prefetch={false} className="move-card-link" href={model.latest.href}>
              <span>{say('move.wait.open')}</span>
              <CorridraIcon name="arrow" />
            </Link>
            <div className="move-latest">
              <p className="move-latest-top">
                <span className="move-latest-sent">
                  {fill(say('move.received'), {
                    date: day(model.latest.createdAt.slice(0, 10), locale),
                  })}
                </span>
              </p>
              {model.latest.status ? (
                <StageBar status={model.latest.status} labels={labels.road} named />
              ) : null}
            </div>
          </section>
        ) : null}
      </div>

      {model.waiting.length > 0 ? (
        <section className="move-card" aria-labelledby="move-others">
          <h2 id="move-others">{say('move.others.heading')}</h2>
          <span className="move-count">{model.waiting.length}</span>
          <RowList
            label={say('move.others.heading')}
            title="Request"
            columns={[{ name: 'Held by' }, { name: 'Where it stands' }]}
            lang="en"
          >
            {model.waiting.map((row) => {
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
                    { name: 'Held by', value: holders[row.holder === 'team' ? 'team' : 'third'] },
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

      <nav className="move-shortcuts" aria-label="Shortcuts" lang="en">
        {!nothing ? (
          <Link prefetch={false} className="move-tile" href={startHref}>
            <span className="move-tile-mark" aria-hidden="true">
              <CorridraIcon name="draft" />
            </span>
            <span className="move-tile-words">
              <b>{say('move.start')}</b>
              <small>Sell, source, organise or plan a trip.</small>
            </span>
          </Link>
        ) : null}
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
        {nothing ? (
          <Link prefetch={false} className="move-tile" href="/account?view=work">
            <span className="move-tile-mark" aria-hidden="true">
              <CorridraIcon name="work" />
            </span>
            <span className="move-tile-words">
              <b>See All Requests</b>
              <small>Every request in your workspaces.</small>
            </span>
          </Link>
        ) : null}
      </nav>

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
