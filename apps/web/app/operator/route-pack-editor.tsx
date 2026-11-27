'use client';
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { CorridraIcon } from '../../components/corridra-icon';
import { StatusBadge } from '../../components/access-state';
import { FieldError } from '../../components/field-error';
import { EmptyState } from '../../components/ux/empty-state';
import { FactMark, StaleMark } from '../../components/ux/fact-mark';
import { RouteFactRow } from '../../components/ux/route-fact-row';
import { SegmentedFilter } from '../../components/ux/segmented-filter';
import { ShowMoreList } from '../../components/ux/show-more';
import { formatDate, formatUtcDay } from '../../lib/ux/format';
import type { OverviewRoute, RouteSummary } from '../../lib/route-pack-editor-read';
import {
  addressFor,
  coreListWords,
  defaultView,
  factsByKey,
  fieldView,
  gapsLine,
  markedButOpen,
  optionalLine,
  packChangeLine,
  progressWords,
  readinessLine,
  sectionLines,
  sectionName,
  sectionParts,
  staleLine,
  staleListWords,
  todoCount,
  todoItems,
  type EditorView,
  type RouteAddress,
  type SectionLine,
} from '../../lib/route-pack-editor-view';
import { CountryName } from './country-name';
import { goTo, takePendingFocus, useRouteDetail, type DetailData } from './route-pack-editor-data';
import { packStatusWords, packTones } from './pack-status';
import { standardFieldByKey, liveStatuses } from '@corridra/domain/route-pack-standard';
import './route-pack-editor.css';

// ADR-093 Phase 3, PR 1: the route pack editor, read only. One place in Settings: the Routes list (with completeness), and for
// the route a person opened, its header, a View choice and one of To Do, All Sections or one section. No control here writes:
// a control without a working backend is not drawn. The words come from the helpers in lib/route-pack-editor-view.ts; the rows
// from the standard's field dictionary.
const routeHeading = 'route-pack-editor-heading';
const sectionHeading = 'route-pack-section-heading';
const ownerNote = 'Route facts are shown read only here.';
const adminNote = 'Only the owner can change route facts and packs. You can read everything here.';
const notFoundRoute = 'That route was not found. Choose one from the list.';
const notFoundSection = 'That section was not found.';
const denied = 'You do not have access to route facts.';
const unavailable = 'Route facts are unavailable. Try again.';

/** The facts of one row of the Routes list: Core words, stale words and Live with gaps, only the ones that hold. */
export function RouteRowFacts({ summary }: { summary: RouteSummary }) {
  const core = coreListWords(summary.core);
  const stale = staleListWords(summary.core.stale);
  if (!core && !stale && !summary.liveWithGaps) return null;
  return (
    <span className="settings-route-facts">
      {core ? <span className="settings-route-core">{core}</span> : null}
      {stale ? (
        <span className="settings-route-stale">
          <CorridraIcon name="clock" />
          {stale}
        </span>
      ) : null}
      {summary.liveWithGaps ? (
        <StatusBadge tone="caution">
          <CorridraIcon name="alert" /> Live with gaps
        </StatusBadge>
      ) : null}
    </span>
  );
}

/** What stands under the Routes heading once the facts are read: the helper line, or why they are not shown. */
export function RoutesFactsHead({
  state,
  notice,
  retry,
  retrying,
}: {
  state: 'ready' | 'denied' | 'error';
  notice: boolean;
  retry: () => void;
  retrying: boolean;
}) {
  if (state === 'denied') return <p className="settings-routes-quiet">{denied}</p>;
  if (state === 'error')
    return (
      <div className="settings-routes-error">
        <FieldError id="route-facts-error">{unavailable}</FieldError>
        <button type="button" className="text-link" aria-busy={retrying} onClick={retry}>
          Try Again
        </button>
      </div>
    );
  return (
    <>
      <p className="settings-routes-quiet">
        Facts describe a route. The pack decides what the team may do on it. Choose a route to read
        its facts.
      </p>
      {notice ? (
        <p className="settings-routes-quiet" role="status">
          {notFoundRoute}
        </p>
      ) : null}
    </>
  );
}

const foldWidthRem = 56;
/**
 * The list and the editor of the open route. At least 56 rem of region and the two stand side by side (a rule on the width of
 * this region, not of the window); narrower, the list folds into one closed row, "Routes: Bangladesh to China".
 */
export function RouteEditorShell({
  list,
  summary,
  tenant,
  role,
  refreshKey,
  address,
}: {
  list: ReactNode;
  summary: RouteSummary;
  tenant: string;
  role: string;
  refreshKey: unknown;
  address: RouteAddress;
}) {
  const shell = useRef<HTMLDivElement>(null);
  const [wide, setWide] = useState(false);
  useLayoutEffect(() => {
    const element = shell.current;
    if (!element) return;
    const measure = () => {
      const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
      setWide(element.getBoundingClientRect().width >= foldWidthRem * rem);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return (
    <div className="settings-routes-shell" ref={shell} data-wide={wide ? 'true' : 'false'}>
      <details className="settings-routes-fold" open={wide || undefined}>
        <summary>
          Routes:{' '}
          <span className="settings-routes-fold-name">
            <CountryName code={summary.origin} /> to <CountryName code={summary.destination} />
          </span>
        </summary>
        {list}
      </details>
      <RoutePackEditor
        tenant={tenant}
        role={role}
        summary={summary}
        refreshKey={refreshKey}
        address={address}
      />
    </div>
  );
}

function Skeleton() {
  return (
    <div className="route-editor-skeleton" aria-hidden="true">
      <span />
      <span />
      <span />
      <span />
    </div>
  );
}

function RoutePackEditor({
  tenant,
  role,
  summary,
  refreshKey,
  address,
}: {
  tenant: string;
  role: string;
  summary: RouteSummary;
  refreshKey: unknown;
  address: RouteAddress;
}) {
  const data = useRouteDetail(tenant, summary.routeId, refreshKey);
  // Focus moves to the heading of the route or the section a person clicked, never on a deep link, Back or Forward.
  useEffect(() => {
    const target = takePendingFocus();
    if (target) document.getElementById(target)?.focus();
  });
  const route = data.detail?.route ?? null;
  return (
    <section className="route-editor" aria-labelledby={routeHeading}>
      <h2 id={routeHeading} tabIndex={-1}>
        <CountryName code={summary.origin} /> to <CountryName code={summary.destination} />
      </h2>
      {data.state === 'loading' ? (
        <>
          <p role="status" className="route-editor-quiet">
            Loading route facts…
          </p>
          <Skeleton />
        </>
      ) : data.state === 'denied' ? (
        <p className="route-editor-quiet">{denied}</p>
      ) : data.state === 'error' ? (
        <div className="settings-routes-error">
          <FieldError id="route-editor-error">{unavailable}</FieldError>
          <button
            type="button"
            className="text-link"
            aria-busy={data.retrying}
            onClick={data.retry}
          >
            Try Again
          </button>
        </div>
      ) : !route ? (
        <p role="status" className="route-editor-quiet">
          {notFoundRoute}
        </p>
      ) : (
        <RouteBody
          route={route}
          detail={data.detail!}
          packHistory={data.packHistory}
          role={role}
          summary={summary}
          address={address}
        />
      )}
    </section>
  );
}

type Route = NonNullable<OverviewRoute['route']>;

function RouteBody({
  route,
  detail,
  packHistory,
  role,
  summary,
  address,
}: {
  route: Route;
  detail: OverviewRoute;
  packHistory: DetailData['packHistory'];
  role: string;
  summary: RouteSummary;
  address: RouteAddress;
}) {
  const { completeness, pack, content } = route;
  const total = completeness.fields.filter((row) => row.core).length;
  const pending = completeness.pendingCore.length;
  const stale = completeness.staleCore.length;
  const live = !!pack && (liveStatuses as readonly string[]).includes(pack.status);
  const document = content?.document ?? null;
  const facts = factsByKey(document);
  const labels = (key: string) =>
    standardFieldByKey.get(key)?.label ?? facts.get(key)?.label ?? detail.customLabels[key] ?? key;
  const view: EditorView | 'section' = address.section
    ? 'section'
    : address.sectionUnknown
      ? 'sections'
      : (address.view ?? defaultView({ pending, stale }));
  const lastChange = packHistory?.[0];
  const changeWords = lastChange
    ? packChangeLine(lastChange, formatDate(lastChange.effectiveFrom))
    : null;
  const row = (item: Route['completeness']['fields'][number], heading?: ReactNode) => {
    const v = fieldView(item, facts, pack?.configuration ?? null, detail.customLabels);
    return (
      <RouteFactRow
        key={item.key}
        label={v.label}
        core={v.core}
        locked={v.locked}
        state={v.state}
        value={v.value}
        note={v.note}
        packNote={v.packNote}
        source={v.source}
        observed={v.observedOn ? formatUtcDay(v.observedOn) : null}
        validUntil={v.validUntil ? formatUtcDay(v.validUntil) : null}
        staleSince={item.stale && v.validUntil ? formatUtcDay(v.validUntil) : null}
        heading={heading}
      />
    );
  };
  return (
    <>
      <p className="route-editor-line">
        {pack ? (
          <>
            <StatusBadge tone={packTones[pack.status]}>{packStatusWords(pack.status)}</StatusBadge>{' '}
            <span>Pack version {pack.version}</span>
          </>
        ) : (
          <StatusBadge tone="unknown">No pack yet</StatusBadge>
        )}
        <span>{content ? `Route facts version ${content.version}` : 'No facts saved yet'}</span>
      </p>
      <div className="route-editor-progress">
        <p>{progressWords({ total, pending })}</p>
        <progress value={total - pending} max={total} aria-label="Core fields done" />
      </div>
      {stale > 0 ? (
        <p className="route-editor-line">
          <StaleMark>{staleLine(stale)}</StaleMark>
        </p>
      ) : null}
      {live && pending > 0 ? (
        <p className="route-editor-gaps">
          <CorridraIcon name="alert" />
          <span>{gapsLine(packStatusWords(pack.status), pending)}</span>
        </p>
      ) : null}
      {route.readiness && pack ? (
        <p className="route-editor-quiet">{readinessLine(route.readiness, pack.version)}</p>
      ) : null}
      {pack ? (
        <p className="route-editor-quiet">
          {changeWords ?? 'The last pack change is not available.'}
        </p>
      ) : null}
      <p className="route-editor-quiet">{role === 'owner' ? ownerNote : adminNote}</p>
      <SegmentedFilter<EditorView | 'section'>
        label="View"
        // A section is neither choice, so choosing either one fires and clears the section.
        value={view}
        options={[
          { value: 'todo', label: 'To Do', count: todoCount(completeness) },
          { value: 'sections', label: 'All Sections', count: completeness.sections.length },
        ]}
        onChange={(next) => next !== 'section' && goTo({ route: summary.key, view: next })}
      />
      {view === 'todo' ? (
        <TodoView
          route={route}
          hasFacts={!!content}
          row={row}
          optional={optionalLine(completeness.pendingOptionalCount)}
        />
      ) : view === 'sections' ? (
        <SectionsView
          lines={sectionLines(completeness)}
          routeKey={summary.key}
          unknown={address.sectionUnknown}
        />
      ) : (
        <SectionView
          route={route}
          section={address.section!}
          row={row}
          markedOpen={markedButOpen(completeness, document, address.section!, labels)}
        />
      )}
    </>
  );
}

type RowMaker = (item: Route['completeness']['fields'][number], heading?: ReactNode) => ReactNode;

function TodoView({
  route,
  hasFacts,
  row,
  optional,
}: {
  route: Route;
  hasFacts: boolean;
  row: RowMaker;
  optional: string | null;
}) {
  const items = todoItems(route.completeness);
  return (
    <div className="route-editor-view">
      {!hasFacts ? (
        <p className="route-editor-quiet">Nothing is recorded for this route yet.</p>
      ) : null}
      {items.length ? (
        <ShowMoreList limit={8} noun="fields" className="route-editor-rows">
          {items.map((item) =>
            row(
              item.row,
              item.heading ? (
                <h3>
                  {item.heading.number}. {item.heading.name}
                </h3>
              ) : undefined,
            ),
          )}
        </ShowMoreList>
      ) : (
        <EmptyState icon="check">Every Core field is done and nothing is stale.</EmptyState>
      )}
      {optional ? <p className="route-editor-quiet">{optional}</p> : null}
    </div>
  );
}

function SectionsView({
  lines,
  routeKey,
  unknown,
}: {
  lines: SectionLine[];
  routeKey: string;
  unknown: boolean;
}) {
  return (
    <div className="route-editor-view">
      {unknown ? (
        <p role="status" className="route-editor-quiet">
          {notFoundSection}
        </p>
      ) : null}
      <ul className="route-editor-sections">
        {lines.map((line) => (
          <li key={line.number}>
            <a
              href={addressFor(window.location.href, { route: routeKey, section: line.number })}
              onClick={(event) => {
                if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
                event.preventDefault();
                goTo({ route: routeKey, section: line.number }, sectionHeading);
              }}
            >
              <span className="route-editor-section-name">
                {line.number}. {line.name}
              </span>
              <FactMark state={line.state} />
              {sectionParts(line).map((part) => (
                <span key={part} className="route-editor-section-part">
                  {part}
                </span>
              ))}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}

function SectionView({
  route,
  section,
  row,
  markedOpen,
}: {
  route: Route;
  section: number;
  row: RowMaker;
  markedOpen: string | null;
}) {
  const state = route.completeness.sections.find((item) => item.section === section);
  const rows = route.completeness.fields.filter((item) => item.section === section);
  const groups = [
    { name: 'Core fields', rows: rows.filter((item) => item.core) },
    { name: 'Optional fields', rows: rows.filter((item) => !item.core && !item.custom) },
    { name: 'Your own fields', rows: rows.filter((item) => item.custom) },
  ].filter((group) => group.rows.length);
  return (
    <div className="route-editor-view">
      <h3 id={sectionHeading} tabIndex={-1}>
        {section}. {sectionName(section)}
      </h3>
      {state ? <FactMark state={state.state} /> : null}
      {markedOpen ? <p className="route-editor-quiet">{markedOpen}</p> : null}
      <ShowMoreList limit={8} noun="fields" className="route-editor-rows">
        {groups.flatMap((group) =>
          group.rows.map((item, index) =>
            row(item, index === 0 ? <h4>{group.name}</h4> : undefined),
          ),
        )}
      </ShowMoreList>
    </div>
  );
}
