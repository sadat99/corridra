// A pure matcher from a typed goal to ranked action rows. No network, model, storage, logging or clock.
// It reuses the customer search ranking: a row needs every typed word at the substring tier or better, and a near
// miss (fuzzy) never counts, so text Corridra does not cover returns nothing instead of a guess.
import { foldText, queryWords, rankFields } from '../palette-rank';
import { liveActions, machineryRoute, machineryWords } from './catalogue';
import type { ActionContract, ActionId, ActionModuleKey, ActionSwitchKey } from './contract';
import type { ActionState } from './states';

export type MatchContext = {
  switches: Readonly<Partial<Record<ActionSwitchKey, boolean>>>;
  modules: Readonly<Partial<Record<ActionModuleKey, boolean>>>;
  hasWorkspace: boolean;
};

export type ActionRow = { id: ActionId; score: number; href: string | null; state: ActionState };

const minLength = 2;

const visible = (entry: ActionContract, ctx: MatchContext) =>
  entry.authority.switches.every((key) => ctx.switches[key] === true) &&
  entry.authority.modules.every((key) => ctx.modules[key] === true);

function scoreEntry(words: string[], entry: ActionContract): number {
  let best = 0;
  for (const phrase of [...entry.intent.phrases.en, ...entry.intent.synonyms]) {
    const ranked = rankFields(words, [{ value: phrase, label: true }]);
    if (ranked && !ranked.close && ranked.score > best) best = ranked.score;
  }
  return best;
}

function hrefFor(entry: ActionContract, words: string[], ctx: MatchContext): string | null {
  if (entry.context.includes('workspace') && !ctx.hasWorkspace) return null;
  if (
    entry.id === 'start_source' &&
    words.some((word) => machineryWords.some((m) => word.startsWith(m)))
  )
    return machineryRoute;
  return entry.service.route;
}

function stateFor(entry: ActionContract, ctx: MatchContext): ActionState {
  return entry.context.includes('workspace') && !ctx.hasWorkspace ? 'needs_info' : 'ready';
}

/** Ranked rows for the typed text, best first; empty for empty, one-character or uncovered text. */
export function matchActions(text: string, ctx: MatchContext): ActionRow[] {
  if (foldText(text).trim().length < minLength) return [];
  const words = queryWords(text);
  if (words.length === 0) return [];
  const rows: (ActionRow & { order: number })[] = [];
  liveActions.forEach((entry, order) => {
    if (!visible(entry, ctx)) return;
    const score = scoreEntry(words, entry);
    if (score <= 0) return;
    const href = hrefFor(entry, words, ctx);
    rows.push({ id: entry.id, score, href, state: stateFor(entry, ctx), order });
  });
  rows.sort((a, b) => b.score - a.score || a.order - b.order);
  return rows.map((row) => ({ id: row.id, score: row.score, href: row.href, state: row.state }));
}
