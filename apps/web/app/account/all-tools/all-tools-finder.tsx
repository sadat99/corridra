'use client';
import Link from 'next/link';
import { useId, useState } from 'react';
import { PhoneFold } from '../../../components/phone-fold';
import { SegmentedFilter } from '../../../components/ux/segmented-filter';
import {
  filterTools,
  groupLabel,
  parseToolGroup,
  toolGroups,
  toolGroupSlug,
  type Tool,
} from '../../../lib/all-tools';

export type FinderTool = Pick<Tool, 'href' | 'label' | 'line' | 'group'>;

/**
 * All Tools with a finder (UI/UX.v3 audit, screens batch A). A search box (name, line or group word) and one chip per
 * group, applied at once. Every tool stays on the page by default, so each is one tap or one search away. Without a
 * script the same words go to the address as a plain GET form (`?q=` and `?group=`) and the page reads them, so
 * the finder works there too. The state is kept in the address so a search can be shared or reloaded.
 */
export function AllToolsFinder({
  tools,
  initialQuery,
  initialGroup,
}: {
  tools: FinderTool[];
  initialQuery: string;
  initialGroup: string;
}) {
  const [query, setQuery] = useState(initialQuery);
  const [chosenWord, setChosenWord] = useState<string>(
    parseToolGroup(initialGroup) ? initialGroup : 'all',
  );
  const searchId = useId();
  const chosen = parseToolGroup(chosenWord);
  const searched = filterTools(tools, { query });
  const shown = filterTools(tools, { query, group: chosen });
  const present = toolGroups.filter((group) => tools.some((tool) => tool.group === group));
  const active = query.trim() !== '' || chosen !== undefined;

  const remember = (nextQuery: string, nextGroup: string) => {
    const url = new URL(window.location.href);
    if (nextQuery.trim()) url.searchParams.set('q', nextQuery.trim());
    else url.searchParams.delete('q');
    if (nextGroup !== 'all') url.searchParams.set('group', nextGroup);
    else url.searchParams.delete('group');
    window.history.replaceState(null, '', url.pathname + url.search + url.hash);
  };
  const clear = () => {
    setQuery('');
    setChosenWord('all');
    remember('', 'all');
  };

  return (
    <div className="ux-tools-finder">
      <form
        role="search"
        aria-label="Find a tool"
        method="get"
        action="/account/all-tools"
        className="ux-tools-find"
        onSubmit={(event) => event.preventDefault()}
      >
        <div className="field ux-tools-search">
          <label htmlFor={searchId} className="sr-only">
            Find a tool
          </label>
          <input
            id={searchId}
            name="q"
            type="search"
            autoComplete="off"
            enterKeyHint="search"
            placeholder="Find a tool, for example billing"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              remember(event.target.value, chosenWord);
            }}
          />
        </div>
        <SegmentedFilter
          label="Group"
          name="group"
          value={chosenWord}
          options={[
            { value: 'all', label: 'All', count: searched.length },
            ...present.map((group) => ({
              value: toolGroupSlug(group),
              label: groupLabel(group),
              count: searched.filter((tool) => tool.group === group).length,
            })),
          ]}
          onChange={(next) => {
            setChosenWord(next);
            remember(query, next);
          }}
        />
        <noscript>
          <button type="submit" className="button button-secondary">
            Find
          </button>
        </noscript>
      </form>
      <div className="ux-tools-status-row">
        <p aria-live="polite" className="ux-tools-status">
          {shown.length === 0 ? (
            <>
              No tool matches{query.trim() ? <> “{query.trim()}”</> : null}
              {chosen ? <> in {groupLabel(chosen)}</> : null}.
            </>
          ) : active ? (
            <>
              Showing {shown.length} of {tools.length} tools.
            </>
          ) : null}
        </p>
        {active ? (
          <button type="button" className="text-link" onClick={clear}>
            Clear Search
          </button>
        ) : null}
      </div>
      <div className="ux-tools-grid">
        {present.map((group) => {
          const inGroup = shown.filter((tool) => tool.group === group);
          if (inGroup.length === 0) return null;
          const id = `tools-${toolGroupSlug(group)}`;
          return (
            <section key={group} className="guide-area ux-account-groups" aria-labelledby={id}>
              <PhoneFold
                className="ux-tools-fold"
                keepOpen={active}
                summary={
                  <h2 id={id}>
                    {groupLabel(group)} ({inGroup.length})
                  </h2>
                }
              >
                <ul className="ux-link-list">
                  {inGroup.map((tool) => (
                    <li key={tool.href}>
                      <Link prefetch={false} href={tool.href}>
                        <strong>{tool.label}</strong>
                        <span>{tool.line}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </PhoneFold>
            </section>
          );
        })}
      </div>
    </div>
  );
}
