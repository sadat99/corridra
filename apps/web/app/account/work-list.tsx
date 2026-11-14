import Link from 'next/link';
import { loadWorkItems } from '../../lib/work-items/load';
import {
  filterWorkItems,
  incomplete,
  kindWords,
  workCounts,
  workFilterLabels,
  workFilters,
  workState,
  contentLang,
  workDateWords,
  workStatusWords,
  type WorkFilter,
} from '../../lib/work-items/view';
import type { WorkFamily, WorkItem, WorkList as WorkListData } from '../../lib/work-items/types';
import { formatDate } from '../../lib/ux/format';
import { RowLink } from '../../components/ux/row-list';
import { WorkFilterBar } from './work-filter';
import { WorkRows } from './work-rows';
import './work-list.css';

const here = (filter: WorkFilter) =>
  filter === 'all' ? '/account?view=work' : `/account?view=work&work=${filter}`;

// The three starts reuse the deep links the public plan page already reads.
const starts = [
  { label: 'Sell: find buyers', href: '/plan?job=buyers' },
  { label: 'Source: find suppliers', href: '/plan?job=sourcing' },
  { label: 'Organise a delegation', href: '/plan?job=delegations' },
] as const;

function Starts() {
  return (
    <p className="work-starts">
      {starts.map((start) => (
        <Link key={start.href} prefetch={false} className="text-link" href={start.href}>
          {start.label}
        </Link>
      ))}
    </p>
  );
}

// The Journey cell uses the filter's own words, so one idea has one word on the page. Work in no single family is Other.
const journeyFilter: Record<WorkFamily, Exclude<WorkFilter, 'all'>> = {
  SELL: 'sell',
  SOURCE: 'source',
  ORGANISE: 'organise',
  UNCLASSIFIED: 'other',
};

function Row({ item, names }: { item: WorkItem; names: Map<string, string> }) {
  const heading = item.title ?? kindWords[item.kind];
  const status = workStatusWords(item);
  const date = item.at ? formatDate(item.at) : '';
  const workspace = names.get(item.workspaceId);
  return (
    <RowLink
      href={item.href}
      title={heading}
      titleLang={contentLang(heading)}
      cells={[
        { name: 'Journey', value: workFilterLabels[journeyFilter[item.family]] },
        { name: 'Kind', value: kindWords[item.kind] },
        { name: 'Workspace', value: workspace ?? '', lang: contentLang(workspace ?? '') },
        { name: 'Status', value: status, status: true },
        { name: 'Date', value: date && `${workDateWords(item)} ${date}` },
      ]}
    />
  );
}

/** What the person sees for a read work list. Every state has its own words; none is borrowed. */
export function WorkListView({
  list,
  filter,
  framed = false,
}: {
  list: WorkListData;
  filter: WorkFilter;
  /** The page frame already names this list (its tab and title), so the heading is for assistive technology only. */
  framed?: boolean;
}) {
  const state = workState(list, filter);
  const counts = workCounts(list);
  const names = new Map(list.workspaces.map((workspace) => [workspace.id, workspace.name]));
  const retry = here(filter);
  return (
    <section id="work-list" className="work-list" aria-labelledby="work-list-title">
      <h2 id="work-list-title" className={framed ? 'sr-only' : undefined}>
        Your work
      </h2>
      {state === 'unreadable' && (
        <div role="status" className="work-note">
          <p>
            We could not check everything just now. Something may be waiting for you that this page
            could not read. Your work is safe.
          </p>
          <p>
            <Link prefetch={false} className="text-link" href={retry}>
              Try again
            </Link>
          </p>
        </div>
      )}
      {state === 'empty' && (
        <div className="work-note">
          <p>You have no work here yet.</p>
          <Starts />
        </div>
      )}
      {(state === 'list' || state === 'filtered-empty') && (
        <>
          <WorkFilterBar
            filter={filter}
            options={workFilters.map((option) => ({
              value: option,
              label: workFilterLabels[option],
              count: counts[option],
            }))}
          />
          <noscript>
            <form method="get" action="/account" className="work-filter">
              <input type="hidden" name="view" value="work" />
              <fieldset>
                <legend>Show</legend>
                {workFilters.map((option) => (
                  <label key={option} className="work-choice">
                    <input
                      type="radio"
                      name="work"
                      value={option}
                      defaultChecked={option === filter}
                    />
                    <span>
                      {workFilterLabels[option]}{' '}
                      <span className="work-count">{counts[option]}</span>
                    </span>
                  </label>
                ))}
              </fieldset>
              <button type="submit" className="work-apply">
                Show
              </button>
            </form>
          </noscript>
          {state === 'filtered-empty' ? (
            <p className="work-note">
              No {workFilterLabels[filter]} work.{' '}
              <Link prefetch={false} className="text-link" href={here('all')}>
                Show all
              </Link>
            </p>
          ) : (
            <WorkRows>
              {filterWorkItems(list.items, filter).map((item) => (
                <Row key={item.key} item={item} names={names} />
              ))}
            </WorkRows>
          )}
          {incomplete(list) && (
            <p role="note" className="work-note">
              This list may not show everything.{' '}
              {list.unreadable.length > 0 ? (
                <Link prefetch={false} className="text-link" href={retry}>
                  Try again
                </Link>
              ) : list.skippedWorkspaces > 0 ? (
                <Link prefetch={false} className="text-link" href="#customer-workspaces">
                  Open your workspaces
                </Link>
              ) : null}
            </p>
          )}
          <Starts />
        </>
      )}
    </section>
  );
}

/** Server side: reads with the person's own session proof, then shows the list. */
export async function WorkList({
  subject,
  issuer,
  filter,
  rooms,
  framed,
}: {
  subject: string;
  issuer: string;
  filter: WorkFilter;
  rooms: boolean;
  framed?: boolean;
}) {
  return (
    <WorkListView
      list={await loadWorkItems(subject, issuer, { rooms })}
      filter={filter}
      framed={framed}
    />
  );
}
