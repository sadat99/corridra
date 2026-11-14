'use client';
import {
  ProgrammeLifecycle,
  changeProgramme,
  type LifecycleChange,
  type LifecycleProgramme,
} from './programme-lifecycle';
import { ProgrammeProjectionPanel } from './programme-projections';
import { realCustomerInput } from '@corridra/domain/customer-input-mode';
import { customerProvenanceAllowed } from '@corridra/domain/customer-input-mode';
import { ProgrammeContext } from './programme-context';
import { ProgrammeRoom } from './programme-room';
import { SubTabs, resolveSubTabsAgain } from '../../../components/ux/sub-tabs';
import { pp } from '../../../lib/i18n/programme-pages';
import { useCallback, useEffect, useRef, useState, lazy, Suspense } from 'react';
import { useFormDraft } from '../../../lib/ux/use-form-draft';
import { ProgrammeSharedObjectiveCount } from './programme-shared-objective-count';
const ProgrammeParticipants = lazy(() =>
  import('./programme-participants').then((module) => ({ default: module.ProgrammeParticipants })),
);
const ProgrammeTemplates = lazy(() =>
  import('./programme-templates').then((module) => ({ default: module.ProgrammeTemplates })),
);
const ProgrammePricing = lazy(() =>
  import('./programme-pricing').then((module) => ({ default: module.ProgrammePricing })),
);
const ProgrammeCoordination = lazy(() =>
  import('./programme-coordination').then((module) => ({ default: module.ProgrammeCoordination })),
);
const ProgrammeTerms = lazy(() =>
  import('./programme-terms').then((module) => ({ default: module.ProgrammeTerms })),
);
const ProgrammePage = lazy(() =>
  import('./programme-page').then((module) => ({ default: module.ProgrammePage })),
);
const FirstRun = lazy(() => import('./first-run').then((module) => ({ default: module.FirstRun })));
const ProgrammeEconomics = lazy(() =>
  import('./programme-economics').then((module) => ({ default: module.ProgrammeEconomics })),
);
type Programme = {
  id: string;
  workspaceId: string;
  name: string;
  reportingPurpose: string;
  createdAt: string;
  synthetic: boolean;
  // Present only where the programme lifecycle module is installed; absent means the controls stay hidden.
  archived?: boolean;
  version?: number;
};
type Command = {
  commandId: string;
  workspaceId: string;
  name: string;
  reportingPurpose: string;
  acknowledged: true;
};
type Props = {
  subject: string;
  issuer: string;
  workspaceId: string;
  participantsEnabled?: boolean;
  missionSharesEnabled?: boolean;
  contextEnabled?: boolean;
  economicsEnabled?: boolean;
  coordinationEnabled?: boolean;
  templatesEnabled?: boolean;
  termsEnabled?: boolean;
  pricingEnabled?: boolean;
  /** The public programme page and applications (ADR-080). */
  pagesEnabled?: boolean;
  serviceRequestsEnabled?: boolean;
  roomEnabled?: boolean;
  projectionsEnabled?: boolean;
  /** The guided first run and the decisions-first overview (ADR-084 S0). It acts only where pages are on. */
  firstRunEnabled?: boolean;
  /** The people board and the compact money view (ADR-084 S3). It acts only where the room and participants are on. */
  boardEnabled?: boolean;
  /** The Buying Trip starter template (ADR-084 S7). It acts only where programme templates are on. */
  buyingTripEnabled?: boolean;
  /** The page frame shows the back link, the status chips and the helper line, and rare row actions sit in a menu. */
  framed?: boolean;
};
const uuid = (value: unknown): value is string =>
  typeof value === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
function programme(value: unknown, workspaceId: string): value is Programme {
  if (!value || typeof value !== 'object') return false;
  const p = value as Partial<Programme>;
  return (
    uuid(p.id) &&
    p.workspaceId === workspaceId &&
    customerProvenanceAllowed(p.synthetic) &&
    typeof p.name === 'string' &&
    p.name.length >= 3 &&
    p.name.length <= 160 &&
    typeof p.reportingPurpose === 'string' &&
    p.reportingPurpose.length >= 10 &&
    p.reportingPurpose.length <= 500 &&
    typeof p.createdAt === 'string' &&
    Number.isFinite(Date.parse(p.createdAt)) &&
    (p.archived === undefined || typeof p.archived === 'boolean') &&
    (p.version === undefined || (Number.isInteger(p.version) && p.version >= 0))
  );
}
export function CustomerProgrammes(props: Props) {
  return (
    <ScopedProgrammes
      key={props.issuer + ':' + props.subject + ':' + props.workspaceId}
      {...props}
    />
  );
}
function ScopedProgrammes({
  subject,
  issuer,
  workspaceId,
  participantsEnabled = false,
  missionSharesEnabled = false,
  contextEnabled = false,
  economicsEnabled = false,
  coordinationEnabled = false,
  templatesEnabled = false,
  termsEnabled = false,
  pricingEnabled = false,
  pagesEnabled = false,
  serviceRequestsEnabled = false,
  roomEnabled = false,
  projectionsEnabled = false,
  firstRunEnabled = false,
  boardEnabled = false,
  buyingTripEnabled = false,
  framed = false,
}: Props) {
  // The first run ends on Publish, so it needs the public page and the participants module under it.
  const firstRun = firstRunEnabled && pagesEnabled && participantsEnabled;
  // ADR-084 S3: the board and the compact money view are the room's own, so they need the room and the participants.
  const board = boardEnabled && roomEnabled && participantsEnabled;
  const [selectedProgramme, setSelectedProgramme] = useState<string | null>(null);
  // The programme the room shows, kept in ?programme= (read once; the list itself loads after the first render).
  // An old link to one programme's section (#<programme id>-<view>) still opens that programme (layout budget L-03).
  // Only a programme in this workspace's own list can be chosen; anything else shows the first one.
  const [visited, setVisited] = useState<ReadonlySet<string>>(() => new Set());
  const [chosenId, setChosenId] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null;
    const asked = new URLSearchParams(window.location.search).get('programme');
    if (asked) return asked;
    const hash = /^#([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i.exec(
      window.location.hash,
    );
    return hash ? hash[1]!.toLowerCase() : null;
  });
  // The programme named in the address when the page opened (or when Back restored an address). Only that link may open the
  // Archived list by itself; archiving a programme from this page never switches the view.
  const [linkTarget, setLinkTarget] = useState<string | null>(chosenId);
  const [financeProgramme, setFinanceProgramme] = useState<string | null>(null);
  const [coordinationProgramme, setCoordinationProgramme] = useState<string | null>(null);
  const [termsProgramme, setTermsProgramme] = useState<string | null>(null);
  const [pageProgramme, setPageProgramme] = useState<string | null>(null);
  const [rows, setRows] = useState<Programme[]>([]),
    [next, setNext] = useState<string | null>(null);
  // Archived programmes (CRUD gap G7): hidden from the list and the picker unless the Archived filter is on.
  // The filter is kept in the address (?archived=1), so a reload, a shared link and Back all keep it (R-01).
  const [showArchived, setShowArchived] = useState<boolean>(
    () =>
      typeof window !== 'undefined' &&
      new URLSearchParams(window.location.search).get('archived') === '1',
  );
  const [undoing, setUndoing] = useState(false);
  // Programmes shown when the filter last changed stay mounted (hidden), so anything typed in them survives (page without the room).
  const [mounted, setMounted] = useState<ReadonlySet<string>>(() => new Set());
  const shownNow = useRef<string[]>([]);
  // The programme the room shows right now, so history navigation can keep it mounted (hidden) like the filter buttons do.
  const chosenNow = useRef<string | undefined>(undefined);
  const setArchivedFilter = (on: boolean) => {
    setMounted((current) => new Set([...current, ...shownNow.current]));
    setShowArchived(on);
    const url = new URL(window.location.href);
    if (on) url.searchParams.set('archived', '1');
    else {
      url.searchParams.delete('archived');
      // Leaving the Archived list also leaves a link that pointed into it.
      url.searchParams.delete('programme');
      setChosenId(null);
      setLinkTarget(null);
    }
    window.history.pushState(window.history.state, '', url);
  };
  useEffect(() => {
    const sync = () => {
      setMounted((current) => new Set([...current, ...shownNow.current]));
      const leaving = chosenNow.current;
      if (leaving) setVisited((current) => new Set(current).add(leaving));
      const query = new URLSearchParams(window.location.search);
      setShowArchived(query.get('archived') === '1');
      // The programme named in the restored address is the one shown, not whichever comes first.
      setChosenId(query.get('programme'));
      setLinkTarget(query.get('programme'));
    };
    window.addEventListener('popstate', sync);
    return () => window.removeEventListener('popstate', sync);
  }, []);
  const [archivedNotice, setArchivedNotice] = useState<LifecycleProgramme | null>(null);
  const [staleNote, setStaleNote] = useState('');
  // A programme someone archived while this person was renaming it: kept mounted so the typed text survives, and named here.
  const [archivedMidEdit, setArchivedMidEdit] = useState<{ id: string; name: string } | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'failed' | 'denied' | 'unavailable'>(
    'loading',
  );
  const planningDraft = useFormDraft<{ name: string; purpose: string }>(
    'programme-planning:' + JSON.stringify([issuer, subject, workspaceId]),
  );
  const name =
    typeof planningDraft.draft?.name === 'string' ? planningDraft.draft.name.slice(0, 160) : '';
  const purpose =
    typeof planningDraft.draft?.purpose === 'string'
      ? planningDraft.draft.purpose.slice(0, 500)
      : '';
  const setName = (value: string) => planningDraft.save({ name: value, purpose });
  const setPurpose = (value: string) => planningDraft.save({ name, purpose: value });
  const clearPlanningDraft = planningDraft.clear;
  const [ack, setAck] = useState(false);
  const [pending, setPending] = useState<Command | null>(null),
    [busy, setBusy] = useState(false),
    [visible, setVisible] = useState(true),
    [message, setMessage] = useState('');
  const active = useRef(false),
    getTask = useRef<AbortController | null>(null),
    postTask = useRef<AbortController | null>(null),
    inFlight = useRef(false);
  const headers = { 'x-corridra-customer-subject': subject, 'x-corridra-customer-issuer': issuer };
  const deny = useCallback(() => {
    postTask.current?.abort();
    setBusy(false);
    inFlight.current = false;
    setRows([]);
    setNext(null);
    setPending(null);
    clearPlanningDraft();
    setAck(false);
    setMessage('Account or workspace access changed. Local planning details were cleared.');
    setStatus('denied');
  }, [clearPlanningDraft]);
  // One reader for a page of programmes, used by the list and by the single-row refresh, so both check the answer the same way:
  // provenance, workspace, at most 25 rows, no duplicate ids, and a next cursor that is the last id on the page.
  const fetchPage = useCallback(
    async (
      after: string | undefined,
      signal: AbortSignal,
    ): Promise<
      | { kind: 'ok'; programmes: Programme[]; nextAfter: string | null }
      | { kind: 'denied' }
      | { kind: 'unavailable' }
    > => {
      const query = new URLSearchParams({ workspaceId, ...(after ? { after } : {}) });
      const response = await fetch('/api/customer-programmes?' + query, {
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { 'x-corridra-customer-subject': subject, 'x-corridra-customer-issuer': issuer },
        signal,
      });
      if ([401, 403, 409].includes(response.status)) return { kind: 'denied' };
      if (response.status === 503) return { kind: 'unavailable' };
      if (!response.ok) throw Error('Programme list failed');
      const data = await response.json();
      if (
        !data ||
        !customerProvenanceAllowed(data.synthetic) ||
        data.workspaceId !== workspaceId ||
        !Array.isArray(data.programmes) ||
        data.programmes.length > 25 ||
        !data.programmes.every((p: unknown) => programme(p, workspaceId)) ||
        new Set(data.programmes.map((p: Programme) => p.id)).size !== data.programmes.length ||
        !(
          data.nextAfter === null ||
          (uuid(data.nextAfter) && data.nextAfter === data.programmes.at(-1)?.id)
        )
      )
        throw Error('Invalid programme list');
      return { kind: 'ok', programmes: data.programmes, nextAfter: data.nextAfter };
    },
    [subject, issuer, workspaceId],
  );
  const load = useCallback(
    async (after?: string) => {
      getTask.current?.abort();
      const task = new AbortController();
      getTask.current = task;
      try {
        const page = await fetchPage(after, task.signal);
        if (task.signal.aborted || !active.current) return;
        if (page.kind === 'denied') {
          deny();
          return;
        }
        if (page.kind === 'unavailable') {
          setRows([]);
          setNext(null);
          setStatus('unavailable');
          return;
        }
        // A reload brings in the first page; programmes already loaded from later pages stay (their open forms and typed text
        // with them) until the person reloads the whole page. Nothing here is ever deleted, so keeping them cannot show a removed row.
        setRows((old) =>
          after
            ? [...old, ...page.programmes.filter((p) => !old.some((item) => item.id === p.id))]
            : [
                ...page.programmes,
                ...old.filter((o) => !page.programmes.some((p) => p.id === o.id)),
              ],
        );
        setNext(page.nextAfter);
        setStatus('ready');
      } catch {
        if (!task.signal.aborted && active.current) {
          setRows([]);
          setNext(null);
          setStatus('failed');
        }
      }
    },
    [fetchPage, deny],
  );
  // Refresh one programme in place after a stale answer: walk the pages until it is found and replace only that row, so rows
  // from later pages (and the controls typed into) are never dropped by a reload that only reaches the first page.
  // One controller per programme, so refreshing one never cancels another's.
  const refreshTasks = useRef(new Map<string, AbortController>());
  const refreshProgramme = useCallback(
    async (id: string) => {
      refreshTasks.current.get(id)?.abort();
      const task = new AbortController();
      refreshTasks.current.set(id, task);
      const gone = () => task.signal.aborted || !active.current;
      const lost = (words: string) => {
        if (!gone()) setStaleNote(words);
      };
      let cursor: string | undefined;
      const seen = new Set<string>();
      try {
        for (;;) {
          const page = await fetchPage(cursor, task.signal);
          if (gone()) return;
          if (page.kind === 'denied') {
            deny();
            return;
          }
          if (page.kind === 'unavailable')
            return lost('The latest version could not be loaded. Reload the page.');
          const hit = page.programmes.find((p) => p.id === id);
          if (hit) {
            setRows((old) => old.map((p) => (p.id === id ? hit : p)));
            setArchivedMidEdit(hit.archived === true ? { id, name: hit.name } : null);
            return;
          }
          // Follow the pages until the list ends; a cursor seen twice would loop, so it ends the walk too.
          if (!page.nextAfter || seen.has(page.nextAfter))
            return lost('That programme could no longer be found. Reload the page.');
          seen.add(page.nextAfter);
          cursor = page.nextAfter;
        }
      } catch {
        lost('The latest version could not be loaded. Reload the page.');
      }
    },
    [fetchPage, deny],
  );
  useEffect(() => {
    active.current = true;
    const refreshing = refreshTasks.current;
    void Promise.resolve().then(() => {
      if (active.current) void load();
    });
    const hide = () => {
      getTask.current?.abort();
      postTask.current?.abort();
      refreshing.forEach((task) => task.abort());
      setVisible(false);
      setRows([]);
      setNext(null);
      setMessage('');
    };
    const show = () => {
      setVisible(true);
      setBusy(false);
      inFlight.current = false;
      setStatus('loading');
      void load();
    };
    const visibility = () => (document.visibilityState === 'hidden' ? hide() : show());
    window.addEventListener('pagehide', hide);
    window.addEventListener('pageshow', show);
    document.addEventListener('visibilitychange', visibility);
    return () => {
      active.current = false;
      getTask.current?.abort();
      postTask.current?.abort();
      refreshing.forEach((task) => task.abort());
      window.removeEventListener('pagehide', hide);
      window.removeEventListener('pageshow', show);
      document.removeEventListener('visibilitychange', visibility);
    };
  }, [load]);
  useEffect(() => {
    const protectDraft = (event: BeforeUnloadEvent) => {
      if (name || purpose || pending) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', protectDraft);
    return () => window.removeEventListener('beforeunload', protectDraft);
  }, [name, purpose, pending]);
  async function create() {
    if (inFlight.current || status !== 'ready') return;
    let command = pending;
    if (!command) {
      if (
        name.trim().length < 3 ||
        name.trim().length > 160 ||
        purpose.trim().length < 10 ||
        purpose.trim().length > 500 ||
        !ack
      ) {
        setMessage(
          realCustomerInput()
            ? 'Enter a programme name and purpose, and confirm the planning details.'
            : 'Use a fictional name and purpose, and confirm sample planning only.',
        );
        return;
      }
      command = {
        commandId: crypto.randomUUID(),
        workspaceId,
        name: name.trim(),
        reportingPurpose: purpose.trim(),
        acknowledged: true,
      };
      setPending(command);
    }
    inFlight.current = true;
    setBusy(true);
    setMessage('');
    const task = new AbortController();
    postTask.current = task;
    try {
      const response = await fetch('/api/customer-programmes', {
        method: 'POST',
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { ...headers, 'content-type': 'application/json' },
        body: JSON.stringify(command),
        signal: task.signal,
      });
      if (task.signal.aborted || !active.current) return;
      if ([401, 403].includes(response.status)) {
        deny();
        return;
      }
      if (response.status === 409) {
        setMessage(
          'The planning request conflicts with current access or state. Reload this workspace before trying again.',
        );
        setPending(null);
        setRows([]);
        setNext(null);
        setStatus('failed');
        return;
      }
      if (!response.ok) throw Error('Unconfirmed programme command');
      const data = await response.json();
      if (task.signal.aborted || !active.current) return;
      if (
        !programme(data, workspaceId) ||
        data.name !== command.name ||
        data.reportingPurpose !== command.reportingPurpose
      )
        throw Error('Unconfirmed programme response');
      setPending(null);
      clearPlanningDraft();
      setAck(false);
      setMessage(
        realCustomerInput()
          ? participantsEnabled
            ? 'Your programme is saved. Next, invite participants from People.'
            : 'Your programme is saved.'
          : 'Your sample planning programme is saved. Participant and delivery operations are not available here.',
      );
      await load();
    } catch {
      if (!task.signal.aborted && active.current)
        setMessage(
          'Saving could not be confirmed. Retry the same planning request before changing it.',
        );
    } finally {
      if (!task.signal.aborted && active.current) {
        inFlight.current = false;
        setBusy(false);
      }
    }
  }
  // The approved Organise room (owner, 5 Nov 2026): with the room on, the page is cut into tabs and shows one
  // programme at a time, so it fits the page-length budget. Nothing is removed: the same list, panels, templates,
  // pricing and form, each in its own tab, every panel kept in the page. With the room off the page is unchanged.
  const lifecycleReady = rows.some((p) => typeof p.version === 'number');
  // A link to an archived programme shows the Archived list, so it opens that programme and not another.
  const archivedView =
    showArchived ||
    (linkTarget !== null && rows.some((p) => p.id === linkTarget && p.archived === true));
  const visibleRows = rows.filter((p) =>
    archivedView ? p.archived === true : p.archived !== true,
  );
  const chosenProgramme = visibleRows.find((p) => p.id === chosenId)?.id ?? visibleRows[0]?.id;
  // A programme once opened stays mounted, hidden, so anything typed in its panels survives a switch and back;
  // a hidden room is off screen, so it reads nothing until it is shown again.
  // The Archived filter only changes which room is shown: rooms already opened stay mounted (hidden), so typed text and the
  // selected tab survive a switch to the archived list and back.
  const visibleIds = new Set(visibleRows.map((p) => p.id));
  const shownRows = roomEnabled
    ? rows.filter((p) => p.id === chosenProgramme || visited.has(p.id))
    : rows.filter((p) => visibleIds.has(p.id) || mounted.has(p.id));
  useEffect(() => {
    shownNow.current = visibleRows.map((p) => p.id);
    chosenNow.current = chosenProgramme;
  });
  // The Archived filter and a link to one programme work over every page: the remaining pages load by themselves until the
  // programme asked for is found (or, with the filter on, until there are no more), so an empty list is never a half answer.
  useEffect(() => {
    if (status !== 'ready' || !next) return;
    // It stops as soon as the view has something to show and any programme asked for is found; Load More takes over from there.
    if (visibleRows.length === 0 || (chosenId !== null && !rows.some((p) => p.id === chosenId)))
      void Promise.resolve().then(() => load(next));
  }, [status, next, visibleRows.length, chosenId, rows, load]);
  const linkMissing =
    status === 'ready' && !next && chosenId !== null && !rows.some((p) => p.id === chosenId);
  // A link into the Archived list opens it without saying so in the address. The first thing the person does there makes it
  // explicit (?archived=1), so choosing another archived programme or restoring one keeps the Archived list instead of flipping away.
  const pinArchivedView = () => {
    if (!archivedView || showArchived) return;
    setShowArchived(true);
    const url = new URL(window.location.href);
    url.searchParams.set('archived', '1');
    window.history.replaceState(window.history.state, '', url);
  };
  const choose = (id: string) => {
    pinArchivedView();
    setVisited((current) => {
      const next = new Set(current);
      if (chosenProgramme) next.add(chosenProgramme);
      next.add(id);
      return next;
    });
    setChosenId(id);
    setLinkTarget(null);
    const url = new URL(window.location.href);
    url.searchParams.set('programme', id);
    window.history.replaceState(window.history.state, '', url);
  };
  // The first run published a new programme: show it, on its public page section, where the address to share is.
  const published = (id: string) => {
    const url = new URL(window.location.href);
    url.searchParams.delete('archived');
    url.searchParams.set('programme', id);
    if (roomEnabled) {
      url.searchParams.set('tab', 'programmes');
      url.hash = `${id}-page`;
    }
    window.history.replaceState(window.history.state, '', url);
    setShowArchived(false);
    setChosenId(id);
    setLinkTarget(null);
    setMessage(pp('pp.first.published'));
    if (roomEnabled) resolveSubTabsAgain();
    void load();
  };
  // Rename, archive and restore. The answer replaces the row in place, so the room, tabs and typed text stay where they are.
  // An archive keeps an Undo for ten seconds; a restore that the cap refuses says so in plain words.
  const archiveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const applyChange = (change: LifecycleChange, before: LifecycleProgramme) => {
    pinArchivedView();
    setLinkTarget(null);
    setStaleNote('');
    setArchivedMidEdit(null);
    // Whatever the answer, the programme stays mounted (hidden by the filter if need be) so typed text and the chosen tab survive.
    setMounted((current) => new Set(current).add(change.id));
    setVisited((current) => new Set(current).add(change.id));
    setRows((old) =>
      old.map((p) =>
        p.id === change.id
          ? {
              ...p,
              name: change.name,
              reportingPurpose: change.reportingPurpose,
              archived: change.archived,
              version: change.version,
            }
          : p,
      ),
    );
    if (archiveTimer.current) clearTimeout(archiveTimer.current);
    if (change.operation === 'archive') {
      setArchivedNotice({ ...before, ...change });
      archiveTimer.current = setTimeout(() => setArchivedNotice(null), 10000);
      setMessage('');
    } else {
      setArchivedNotice(null);
      setMessage(change.operation === 'restore' ? 'Programme restored.' : 'Programme renamed.');
    }
  };
  async function undoArchive() {
    const target = archivedNotice;
    if (!target || undoing) return;
    setUndoing(true);
    const outcome = await changeProgramme({
      workspaceId,
      headers,
      programme: target,
      operation: 'restore',
      commandId: crypto.randomUUID(),
    });
    if (outcome.ok) applyChange(outcome.result, target);
    else {
      setArchivedNotice(null);
      setMessage(outcome.message);
    }
    setUndoing(false);
  }
  // With the page frame and the room, the programme's rare actions sit in one "More actions" menu.
  const framedRoom = framed && roomEnabled;
  // The archived programme's row is gone from the list, so focus goes to the Undo that appears in its place.
  const undoButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (framedRoom && archivedNotice) undoButton.current?.focus();
  }, [framedRoom, archivedNotice]);
  const helpLink = (id: string) =>
    '/account/service-requests/new?kind=programme&ref=' +
    encodeURIComponent(id) +
    '&workspace=' +
    encodeURIComponent(workspaceId);
  const lifecycleFor = (p: Programme) =>
    typeof p.version === 'number' ? (
      <ProgrammeLifecycle
        key={p.id}
        programme={{
          id: p.id,
          name: p.name,
          reportingPurpose: p.reportingPurpose,
          archived: p.archived === true,
          version: p.version,
        }}
        workspaceId={workspaceId}
        headers={headers}
        menu={framedRoom}
        helpHref={framedRoom && serviceRequestsEnabled ? helpLink(p.id) : undefined}
        onChanged={applyChange}
        onStale={(note) => {
          if (note) setStaleNote(note);
          // Keep this programme mounted whatever the refresh finds, so a typed rename is never lost.
          setMounted((current) => new Set(current).add(p.id));
          setVisited((current) => new Set(current).add(p.id));
          void refreshProgramme(p.id);
        }}
      />
    ) : null;
  const programmeList = (
    <>
      <h2 className={roomEnabled && visibleRows.length > 0 ? 'sr-only' : undefined}>
        Your planning programmes
      </h2>
      {lifecycleReady && (
        <p>
          <button
            type="button"
            className="text-link"
            aria-pressed={archivedView}
            onClick={() => {
              if (roomEnabled && chosenProgramme)
                setVisited((current) => new Set(current).add(chosenProgramme));
              setArchivedFilter(!archivedView);
            }}
          >
            {archivedView ? 'Show Active Programmes' : 'Show Archived Programmes'}
          </button>
        </p>
      )}
      {staleNote && <p role="alert">{staleNote}</p>}
      {archivedMidEdit && !visibleIds.has(archivedMidEdit.id) && (
        <p role="alert">
          {archivedMidEdit.name} was archived by someone else while you were renaming it. Your text
          is kept.{' '}
          <button type="button" className="text-link" onClick={() => setArchivedFilter(true)}>
            Show Archived Programmes
          </button>
        </p>
      )}
      {archivedNotice && (
        <p role="status">
          Programme archived: {archivedNotice.name}.{' '}
          <button
            ref={undoButton}
            type="button"
            className="text-link"
            disabled={undoing}
            onClick={() => void undoArchive()}
          >
            Undo
          </button>
        </p>
      )}
      {linkMissing && <p role="status">That programme is not in this workspace.</p>}
      {visibleRows.length === 0 &&
        (next ? (
          <p role="status">Loading more programmes…</p>
        ) : (
          <p className="ux-empty">
            {' '}
            {archivedView
              ? 'No archived programmes.'
              : realCustomerInput()
                ? 'No programmes yet.'
                : 'No sample programmes yet.'}{' '}
          </p>
        ))}
      {shownRows.length > 0 && (
        <ul>
          {shownRows.map((p) => (
            <li key={p.id} hidden={roomEnabled ? p.id !== chosenProgramme : !visibleIds.has(p.id)}>
              {roomEnabled ? (
                <ProgrammeRoom
                  programmeId={p.id}
                  name={p.name}
                  purpose={p.reportingPurpose}
                  notes={
                    <>
                      <p>
                        {' '}
                        {realCustomerInput()
                          ? 'Planning record only · data'
                          : 'Planning record only · Sample data'}{' '}
                      </p>
                      {lifecycleFor(p)}
                      {serviceRequestsEnabled && !(framedRoom && typeof p.version === 'number') && (
                        <p>
                          <a className="text-link" href={helpLink(p.id)}>
                            Request help with this programme
                          </a>
                        </p>
                      )}
                    </>
                  }
                  scope={{ subject, issuer, workspaceId, programmeId: p.id }}
                  participantsEnabled={participantsEnabled}
                  sharedMoneyNote={templatesEnabled && pricingEnabled}
                  projectionsEnabled={projectionsEnabled}
                  termsEnabled={termsEnabled}
                  decisionsFirst={firstRun}
                  boardFirst={board}
                  panels={{
                    companies: projectionsEnabled ? (
                      <ProgrammeProjectionPanel
                        subject={subject}
                        issuer={issuer}
                        workspaceId={workspaceId}
                        programmeId={p.id}
                        view="companies"
                      />
                    ) : null,
                    agenda: projectionsEnabled ? (
                      <ProgrammeProjectionPanel
                        subject={subject}
                        issuer={issuer}
                        workspaceId={workspaceId}
                        programmeId={p.id}
                        view="agenda"
                      />
                    ) : null,
                    // Results (Wave 5): the two meeting counts where the projections are on, and a plain line
                    // where they are off. A count that is not available is never shown as zero.
                    results: participantsEnabled ? (
                      projectionsEnabled ? (
                        <ProgrammeProjectionPanel
                          subject={subject}
                          issuer={issuer}
                          workspaceId={workspaceId}
                          programmeId={p.id}
                          view="results"
                        />
                      ) : (
                        <p className="programme-note">
                          Meeting counts are not available for this programme.
                        </p>
                      )
                    ) : null,
                    page:
                      participantsEnabled && pagesEnabled && p.archived !== true ? (
                        <Suspense fallback={<p role="status">Loading the public page…</p>}>
                          <ProgrammePage
                            subject={subject}
                            issuer={issuer}
                            workspaceId={workspaceId}
                            programmeId={p.id}
                            programmeName={p.name}
                            queueInBoard={board}
                          />
                        </Suspense>
                      ) : null,
                    overview: contextEnabled ? (
                      <ProgrammeContext
                        subject={subject}
                        issuer={issuer}
                        workspaceId={workspaceId}
                        programmeId={p.id}
                      />
                    ) : null,
                    people: participantsEnabled ? (
                      <Suspense
                        fallback={
                          <p role="status">
                            {' '}
                            {realCustomerInput()
                              ? 'Loading participant tools…'
                              : 'Loading sample participant tools…'}{' '}
                          </p>
                        }
                      >
                        <ProgrammeParticipants
                          subject={subject}
                          issuer={issuer}
                          workspaceId={workspaceId}
                          missionSharesEnabled={missionSharesEnabled}
                          programmeId={p.id}
                          archived={p.archived === true}
                          boardEnabled={board}
                          applicationsOn={pagesEnabled && p.archived !== true}
                        />
                      </Suspense>
                    ) : null,
                    plan:
                      participantsEnabled && (coordinationEnabled || missionSharesEnabled) ? (
                        <>
                          {missionSharesEnabled && (
                            <ProgrammeSharedObjectiveCount
                              subject={subject}
                              issuer={issuer}
                              workspaceId={workspaceId}
                              programmeId={p.id}
                            />
                          )}
                          {coordinationEnabled && (
                            <Suspense
                              fallback={
                                <p role="status">
                                  {' '}
                                  {realCustomerInput()
                                    ? 'Loading coordination tools…'
                                    : 'Loading sample coordination tools…'}{' '}
                                </p>
                              }
                            >
                              <ProgrammeCoordination
                                subject={subject}
                                issuer={issuer}
                                workspaceId={workspaceId}
                                programmeId={p.id}
                              />
                            </Suspense>
                          )}
                        </>
                      ) : null,
                    terms:
                      participantsEnabled && termsEnabled ? (
                        <Suspense fallback={<p role="status">Loading terms and places…</p>}>
                          <ProgrammeTerms
                            subject={subject}
                            issuer={issuer}
                            workspaceId={workspaceId}
                            programmeId={p.id}
                            coordinationEnabled={coordinationEnabled}
                          />
                        </Suspense>
                      ) : null,
                    money:
                      participantsEnabled && economicsEnabled ? (
                        <Suspense
                          fallback={
                            <p role="status">
                              {' '}
                              {realCustomerInput()
                                ? 'Loading finance tools…'
                                : 'Loading sample finance tools…'}{' '}
                            </p>
                          }
                        >
                          <ProgrammeEconomics
                            subject={subject}
                            issuer={issuer}
                            workspaceId={workspaceId}
                            programmeId={p.id}
                            compact={board}
                          />
                        </Suspense>
                      ) : null,
                  }}
                />
              ) : (
                <>
                  <h3>{p.name}</h3>
                  <p>{p.reportingPurpose}</p>
                  <p>
                    {' '}
                    {realCustomerInput()
                      ? 'Planning record only · data'
                      : 'Planning record only · Sample data'}{' '}
                  </p>
                  {lifecycleFor(p)}
                  {serviceRequestsEnabled && (
                    <p>
                      <a
                        className="text-link"
                        href={
                          '/account/service-requests/new?kind=programme&ref=' +
                          encodeURIComponent(p.id) +
                          '&workspace=' +
                          encodeURIComponent(workspaceId)
                        }
                      >
                        Request help with this programme
                      </a>
                    </p>
                  )}
                  {contextEnabled && (
                    <ProgrammeContext
                      subject={subject}
                      issuer={issuer}
                      workspaceId={workspaceId}
                      programmeId={p.id}
                    />
                  )}
                  {participantsEnabled && (
                    <>
                      <button
                        type="button"
                        className="text-link"
                        onClick={() =>
                          setSelectedProgramme(selectedProgramme === p.id ? null : p.id)
                        }
                      >
                        {selectedProgramme === p.id
                          ? realCustomerInput()
                            ? 'Hide Participants'
                            : 'Hide Sample Participants'
                          : realCustomerInput()
                            ? 'Manage Participants'
                            : 'Manage Sample Participants'}
                      </button>
                      {selectedProgramme === p.id && (
                        <Suspense
                          fallback={
                            <p role="status">
                              {' '}
                              {realCustomerInput()
                                ? 'Loading participant tools…'
                                : 'Loading sample participant tools…'}{' '}
                            </p>
                          }
                        >
                          <ProgrammeParticipants
                            subject={subject}
                            issuer={issuer}
                            workspaceId={workspaceId}
                            missionSharesEnabled={missionSharesEnabled}
                            programmeId={p.id}
                            archived={p.archived === true}
                          />
                        </Suspense>
                      )}
                    </>
                  )}
                  {participantsEnabled && coordinationEnabled && (
                    <>
                      <button
                        type="button"
                        className="text-link"
                        onClick={() =>
                          setCoordinationProgramme(coordinationProgramme === p.id ? null : p.id)
                        }
                      >
                        {coordinationProgramme === p.id
                          ? 'Hide Coordination and Report'
                          : 'Coordinate and Report'}
                      </button>
                      {coordinationProgramme === p.id && (
                        <Suspense
                          fallback={
                            <p role="status">
                              {' '}
                              {realCustomerInput()
                                ? 'Loading coordination tools…'
                                : 'Loading sample coordination tools…'}{' '}
                            </p>
                          }
                        >
                          <ProgrammeCoordination
                            subject={subject}
                            issuer={issuer}
                            workspaceId={workspaceId}
                            programmeId={p.id}
                          />
                        </Suspense>
                      )}
                    </>
                  )}
                  {participantsEnabled && pagesEnabled && p.archived !== true && (
                    <>
                      <button
                        type="button"
                        className="text-link"
                        onClick={() => setPageProgramme(pageProgramme === p.id ? null : p.id)}
                      >
                        {pageProgramme === p.id
                          ? 'Hide Public Page and Applications'
                          : 'Public Page and Applications'}
                      </button>
                      {pageProgramme === p.id && (
                        <Suspense fallback={<p role="status">Loading the public page…</p>}>
                          <ProgrammePage
                            subject={subject}
                            issuer={issuer}
                            workspaceId={workspaceId}
                            programmeId={p.id}
                            programmeName={p.name}
                          />
                        </Suspense>
                      )}
                    </>
                  )}
                  {participantsEnabled && termsEnabled && (
                    <>
                      <button
                        type="button"
                        className="text-link"
                        onClick={() => setTermsProgramme(termsProgramme === p.id ? null : p.id)}
                      >
                        {termsProgramme === p.id
                          ? 'Hide Terms, Eligibility and Places'
                          : 'Terms, Eligibility and Places'}
                      </button>
                      {termsProgramme === p.id && (
                        <Suspense fallback={<p role="status">Loading terms and places…</p>}>
                          <ProgrammeTerms
                            subject={subject}
                            issuer={issuer}
                            workspaceId={workspaceId}
                            programmeId={p.id}
                            coordinationEnabled={coordinationEnabled}
                          />
                        </Suspense>
                      )}
                    </>
                  )}
                  {participantsEnabled && economicsEnabled && (
                    <>
                      <button
                        type="button"
                        className="text-link"
                        onClick={() => setFinanceProgramme(financeProgramme === p.id ? null : p.id)}
                      >
                        {financeProgramme === p.id
                          ? realCustomerInput()
                            ? 'Hide Finances'
                            : 'Hide Sample Finances'
                          : realCustomerInput()
                            ? 'Record Fees and Costs'
                            : 'Record Sample Fees and Costs'}
                      </button>
                      {financeProgramme === p.id && (
                        <Suspense
                          fallback={
                            <p role="status">
                              {' '}
                              {realCustomerInput()
                                ? 'Loading finance tools…'
                                : 'Loading sample finance tools…'}{' '}
                            </p>
                          }
                        >
                          <ProgrammeEconomics
                            subject={subject}
                            issuer={issuer}
                            workspaceId={workspaceId}
                            programmeId={p.id}
                          />
                        </Suspense>
                      )}
                    </>
                  )}
                </>
              )}
              {!roomEnabled && projectionsEnabled && (
                <>
                  <ProgrammeProjectionPanel
                    subject={subject}
                    issuer={issuer}
                    workspaceId={workspaceId}
                    programmeId={p.id}
                    view="companies"
                  />
                  <ProgrammeProjectionPanel
                    subject={subject}
                    issuer={issuer}
                    workspaceId={workspaceId}
                    programmeId={p.id}
                    view="agenda"
                  />
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </>
  );
  const programmeTemplates = (
    <>
      {templatesEnabled && (
        <Suspense
          fallback={
            <p role="status">
              {' '}
              {realCustomerInput() ? 'Loading templates…' : 'Loading sample templates…'}{' '}
            </p>
          }
        >
          <ProgrammeTemplates
            subject={subject}
            issuer={issuer}
            workspaceId={workspaceId}
            buyingTrip={buyingTripEnabled}
            programmes={rows
              .filter((p) => p.archived !== true)
              .map((p) => ({ id: p.id, name: p.name }))}
            onChanged={() => void load()}
          />
        </Suspense>
      )}
    </>
  );
  const programmePricing = (
    <>
      {templatesEnabled && pricingEnabled && (
        <Suspense fallback={<p role="status">Loading pricing and series…</p>}>
          <ProgrammePricing
            subject={subject}
            issuer={issuer}
            workspaceId={workspaceId}
            programmes={rows
              .filter((p) => p.archived !== true)
              .map((p) => ({ id: p.id, name: p.name }))}
            onChanged={() => void load()}
          />
        </Suspense>
      )}
    </>
  );
  const morePrograms = (
    <>
      {next && (
        <button type="button" className="text-link" disabled={busy} onClick={() => void load(next)}>
          Load More Planning Programmes
        </button>
      )}
    </>
  );
  const createForm = (
    <>
      <form
        className="operator-form"
        onSubmit={(event) => {
          event.preventDefault();
          void create();
        }}
      >
        <h2>{realCustomerInput() ? 'Create a programme' : 'Create a sample programme'}</h2>
        <label className="field">
          Programme name
          <input
            value={name}
            minLength={3}
            maxLength={160}
            required
            disabled={busy || !!pending || !planningDraft.restored}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <label className="field">
          Purpose and intended outcomes
          <textarea
            value={purpose}
            minLength={10}
            maxLength={500}
            required
            disabled={busy || !!pending || !planningDraft.restored}
            onChange={(event) => setPurpose(event.target.value)}
          />
        </label>
        <label className="check-field">
          <input
            type="checkbox"
            checked={ack}
            required
            disabled={busy || !!pending || !planningDraft.restored}
            onChange={(event) => setAck(event.target.checked)}
          />
          {realCustomerInput()
            ? 'I confirm these planning details. Arrangements and costs need separate agreement.'
            : 'I am using fictional information for sample planning only.'}
        </label>
        <button className="primary-link" disabled={busy || !planningDraft.restored}>
          {busy
            ? 'Saving…'
            : pending
              ? 'Retry Same Planning Request'
              : realCustomerInput()
                ? 'Save Programme'
                : 'Save Sample Programme'}
        </button>
      </form>
    </>
  );
  // What the page creates and what it does not hold. With the room on it heads the New Programme tab.
  const intro = (
    <p>
      {realCustomerInput()
        ? 'This creates a programme in your workspace.'
        : 'Fictional sample planning only. This creates a programme in your workspace.'}{' '}
      {realCustomerInput()
        ? participantsEnabled
          ? 'Invite participants and see consented registrations in People.'
          : ''
        : participantsEnabled
          ? 'Participant invitations and consented registrations have separate sample controls below. Private missions, dates, agendas, meetings, fees and costs are not available here yet.'
          : 'Participant invitations, private missions, dates, agendas, meetings, fees and costs are not available here yet.'}
    </p>
  );
  // With the first run on it takes the create form's place. The plain form stays, folded, for a programme that is
  // to have no public page yet: the original action is kept.
  const newProgramme = firstRun ? (
    <>
      <Suspense fallback={<p role="status">{pp('pp.first.restoring')}</p>}>
        <FirstRun
          subject={subject}
          issuer={issuer}
          workspaceId={workspaceId}
          templatesEnabled={templatesEnabled}
          buyingTrip={buyingTripEnabled}
          onPublished={published}
          onDenied={deny}
          plain={
            <details className="first-run-plain">
              <summary>{pp('pp.first.plain')}</summary>
              {intro}
              {createForm}
            </details>
          }
        />
      </Suspense>
    </>
  ) : null;
  // A workspace with no programme opens on the first run: it is the first tab there, and the list comes second.
  const startHere =
    firstRun && status === 'ready' && !next && !rows.some((p) => p.archived !== true);
  // The page's last lines: reload the list, and what programme administration never grants.
  const pageFoot = (
    <>
      {status !== 'loading' && status !== 'denied' && (
        <button
          type="button"
          className="text-link"
          disabled={busy}
          onClick={() => {
            setRows([]);
            setNext(null);
            setStatus('loading');
            void load();
          }}
        >
          Reload Planning Programmes
        </button>
      )}
      <p>
        Programme administration does not grant access to participants&apos; private offers,
        contacts, negotiations or commercial values.
      </p>
    </>
  );
  const roomTabs = <T extends { id: string }>(tabs: T[]): T[] =>
    startHere
      ? [...tabs.filter((t) => t.id === 'new'), ...tabs.filter((t) => t.id !== 'new')]
      : tabs;
  if (!visible)
    return (
      <p role="status">Planning details are hidden. Access will be checked when you return.</p>
    );
  return (
    <section
      className={
        roomEnabled
          ? framed
            ? 'delivery-view ux-saved-commercial-report programme-page ux-prog'
            : 'delivery-view ux-saved-commercial-report programme-page'
          : 'delivery-view ux-saved-commercial-report'
      }
      aria-label={realCustomerInput() ? 'Delegation planning' : 'Sample delegation planning'}
    >
      {!framed && (
        <a className="text-link ux-back" href="/account#customer-workspaces">
          Back to my workspaces
        </a>
      )}
      {!roomEnabled && intro}
      {/* With the room on the page heading is said to assistive technology only; when no programme can be shown
          the page still has a visible heading. */}
      {roomEnabled && status !== 'ready' && status !== 'loading' && (
        <h2>{realCustomerInput() ? 'Delegation planning' : 'Sample delegation planning'}</h2>
      )}
      {status === 'loading' && <p role="status">Checking programme access…</p>}
      {status === 'denied' && (
        <p role="alert">
          Programme administration access could not be confirmed. Only current workspace owners and
          administrators can use this page.
        </p>
      )}
      {status === 'unavailable' && (
        <p role="status">
          {' '}
          {realCustomerInput()
            ? 'Delegation planning is unavailable.'
            : 'Sample delegation planning is unavailable.'}{' '}
        </p>
      )}
      {status === 'failed' && (
        <p role="alert">Programmes could not be loaded. Reload to check access and try again.</p>
      )}
      {status === 'ready' && !roomEnabled && (
        <>
          {programmeList}
          {programmeTemplates}
          {programmePricing}
          {morePrograms}
          {newProgramme ?? createForm}
        </>
      )}
      {status === 'ready' && roomEnabled && (
        <SubTabs
          label="Delegation planning"
          className="programme-page-tabs account-compact"
          tabs={roomTabs([
            {
              id: 'programmes',
              label: 'Programmes',
              panel: (
                <>
                  {visibleRows.length > 1 && (
                    <label className="field programme-picker">
                      Programme
                      <select
                        aria-label="Programme"
                        value={chosenProgramme}
                        onChange={(event) => choose(event.target.value)}
                      >
                        {visibleRows.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                  {programmeList}
                  {morePrograms}
                </>
              ),
            },
            ...(templatesEnabled
              ? [{ id: 'templates', label: 'Templates', panel: programmeTemplates }]
              : []),
            ...(templatesEnabled && pricingEnabled
              ? [{ id: 'pricing', label: 'Pricing, Series and Exports', panel: programmePricing }]
              : []),
            {
              id: 'new',
              label: realCustomerInput() ? 'New Programme' : 'New Sample Programme',
              panel: newProgramme ?? (
                <>
                  {intro}
                  {createForm}
                </>
              ),
            },
          ])}
        />
      )}
      {message && <p role="status">{message}</p>}
      {roomEnabled ? <div className="programme-page-foot">{pageFoot}</div> : pageFoot}
    </section>
  );
}
