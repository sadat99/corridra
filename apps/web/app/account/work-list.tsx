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
import type { WorkItem, WorkList as WorkListData } from '../../lib/work-items/types';
import { formatDate } from '../../lib/ux/format';
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

function Row({ item, names }: { item: WorkItem; names: Map<string, string> }) {
  const heading = item.title ?? kindWords[item.kind];
  const status = workStatusWords(item);
  const date = item.at ? formatDate(item.at) : '';
  return (
    <li className="work-row">
      <h3 dir="auto" lang={contentLang(heading)}>
        {heading}
      </h3>
      <p className="work-meta">
        <span>{kindWords[item.kind]}</span>
        <span dir="auto" lang={contentLang(names.get(item.workspaceId) ?? '')}>
          {names.get(item.workspaceId)}
        </span>
        <span>{status}</span>
        <span className="work-date">{date && `${workDateWords(item)} ${date}`}</span>
      </p>
      <Link prefetch={false} className="text-link work-open" href={item.href}>
        Open<span className="sr-only"> {heading}</span>
      </Link>
    </li>
  );
}

/** What the person sees for a read work list. Every state has its own words; none is borrowed. */
export function WorkListView({ list, filter }: { list: WorkListData; filter: WorkFilter }) {
  const state = workState(list, filter);
  const counts = workCounts(list);
  const names = new Map(list.workspaces.map((workspace) => [workspace.id, workspace.name]));
  const retry = here(filter);
  return (
    <section id="work-list" className="work-list" aria-labelledby="work-list-title">
      <h2 id="work-list-title">Your work</h2>
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
                    {workFilterLabels[option]} <span className="work-count">{counts[option]}</span>
                  </span>
                </label>
              ))}
            </fieldset>
            <button type="submit" className="work-apply">
              Show
            </button>
          </form>
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
}: {
  subject: string;
  issuer: string;
  filter: WorkFilter;
  rooms: boolean;
}) {
  return <WorkListView list={await loadWorkItems(subject, issuer, { rooms })} filter={filter} />;
}
