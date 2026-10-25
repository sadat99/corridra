'use client';

import Link from 'next/link';
import { useMemo, useSyncExternalStore } from 'react';
import { HolderBadge, MoveCard, Road, mrLabelsFor, type MoveVerb } from '../../../components/mr';
import { useLanguage } from '../../../components/language-provider';
import { fill } from '../../../lib/i18n/fill';
import { localeMeta } from '../../../lib/i18n/locales';
import { translate, type MessageKey } from '../../../lib/i18n/messages';
import { moveWorkspaceCap } from '../../../lib/move-constants';
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

const verbOf: Record<MoveCardData['kind'], MoveVerb> = {
  draft: 'Send',
  quote: 'Answer',
  company: 'Add',
};
const objectKey: Record<MoveCardData['kind'], MessageKey> = {
  draft: 'move.card.draft.object',
  quote: 'move.card.quote.object',
  company: 'move.card.company.object',
};
const actionKey: Record<MoveCardData['kind'], MessageKey> = {
  draft: 'move.card.draft.action',
  quote: 'move.card.quote.action',
  company: 'move.card.company.action',
};

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
}: {
  model: MoveModel;
  startHref: string;
  skippedWorkspaces?: number;
  /** True when a list was longer than the pages read. */
  partial?: boolean;
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
      <li key={`reply:${reply.requestId}`} className="move-reply">
        <MoveCard
          verb="Read"
          object={say('move.card.reply.object')}
          holder="you"
          context={fill(say('move.received'), { date: reply.received })}
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
      <li key={card.id}>
        <MoveCard
          verb={verbOf[card.kind]}
          object={say(objectKey[card.kind])}
          holder={card.holder}
          context={card.context}
          href={card.href}
          action={say(actionKey[card.kind])}
          labels={labels}
        />
      </li>
    )),
  ];
  const nothing = items.length === 0;

  const waitingLine = (row: WaitingRow) =>
    row.kind === 'quote'
      ? say('move.wait.quote')
      : row.kind === 'company'
        ? say('move.wait.company')
        : (labels.road.sublines[row.status as keyof typeof labels.road.sublines] ??
          labels.road.sublines.ACTIVE);
  const ownerHolders = { ...labels.holder, third: say('move.wait.owner') };

  return (
    <div className="move-view" lang={html} dir={dir}>
      <p className="move-explainer">{labels.move.explainer}</p>

      <section aria-labelledby="move-you">
        <h2 id="move-you">{say('move.you.heading')}</h2>
        {nothing ? (
          <div className="move-empty" role="status">
            <p>
              <strong>{say('move.empty.title')}</strong> {say('move.empty.text')}
            </p>
            {model.latest ? (
              <>
                <h3>{say('move.empty.latest')}</h3>
                {model.latest.status ? (
                  <Road status={model.latest.status} labels={labels.road} showLegend={false} />
                ) : null}
                <Link prefetch={false} className="text-link ux-action" href={model.latest.href}>
                  {say('move.wait.open')}
                </Link>
              </>
            ) : null}
            <Link prefetch={false} className="button" href={startHref}>
              {say('move.start')}
            </Link>
          </div>
        ) : (
          <>
            <ul className="move-list">{items.slice(0, firstShown)}</ul>
            {items.length > firstShown ? (
              <details className="move-more">
                <summary>{fill(say('move.more'), { count: items.length - firstShown })}</summary>
                <ul className="move-list">{items.slice(firstShown)}</ul>
              </details>
            ) : null}
          </>
        )}
      </section>

      {model.waiting.length > 0 ? (
        <section aria-labelledby="move-others">
          <h2 id="move-others">{say('move.others.heading')}</h2>
          <ul className="move-list">
            {model.waiting.map((row) => (
              <li key={row.id} className="move-wait">
                <p>
                  <HolderBadge
                    holder={row.holder === 'team' ? 'team' : 'third'}
                    labels={row.holder === 'team' ? labels.holder : ownerHolders}
                  />
                </p>
                {row.title || row.received ? (
                  <p className="move-wait-title">
                    {row.title ?? fill(say('move.received'), { date: row.received ?? '' })}
                  </p>
                ) : null}
                <p>{waitingLine(row)}</p>
                <Link prefetch={false} className="text-link ux-action" href={row.href}>
                  {say('move.wait.open')}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {skippedWorkspaces > 0 ? (
        <p className="move-explainer" role="note">
          {fill(say('move.capped'), { count: moveWorkspaceCap })}
        </p>
      ) : null}
      {partial ? (
        <p className="move-explainer" role="note">
          {say('move.partial')}
        </p>
      ) : null}

      <div className="move-foot">
        {!nothing ? (
          <Link prefetch={false} className="text-link ux-action" href={startHref}>
            {say('move.start')}
          </Link>
        ) : null}
        {seen && Object.keys(seen).length > 0 ? (
          <button type="button" className="button button-secondary" onClick={forget}>
            {say('move.forget')}
          </button>
        ) : null}
      </div>
    </div>
  );
}
