'use client';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { CorridraIcon } from '../../../components/corridra-icon';
import { mrLabels } from '../../../components/mr/labels';
import {
  boardingCounts,
  boardingLine,
  meetingCoverage,
  programmeChecklist,
  programmeAttention,
  programmeDecisions,
  programmeFacts,
  programmeGlance,
  programmeNextStep,
  programmeRoadSteps,
  programmeStage,
  roomGroups,
  roomViewLabels,
  type ApplicationCounts,
  type BoardingCounts,
  type ChecklistTerms,
  type DecisionTarget,
  type ProgrammeGlanceSource,
  type RoomGroupKey,
  type RoomLensKey,
} from '../../../lib/programme-room';
import { useParticipantView, type ParticipantScope } from './participant-client';
import { useChecklistTerms } from './programme-checklist';
import { useApplicationCounts } from './programme-page-client';
import { useProgrammeGlance } from './programme-projections';

// The Programme Room (Lane 10; the Organise work room, owner-approved mockups of 5 Nov 2026): one programme in
// one place. Its styles come from programme-room-styles.tsx, which the page mounts with the switch, so this file
// (and the delegation screens that import it) imports no stylesheet of its own. It wraps panels that already
// exist and changes none of them: the same components, the same props, the same data. Each view mounts its
// panel the first time it is opened and keeps it mounted afterwards, so anything typed in a panel is still
// there when the person comes back to it. The room reads nothing the participants panel and the programme
// projection do not already read, and shows only counts and states, never a participant's own answers.
type LensKey = RoomLensKey | 'companies' | 'agenda' | 'results' | 'page';
export type RoomPanels = Partial<Record<LensKey, ReactNode>>;
type Live = { counts: BoardingCounts | null; notice: string };

const noop = () => {};
const nothingRead: Live = { counts: null, notice: '' };

// Where the programme stands, drawn as every room draws it (CX-06): a stage with a record is done or current,
// and any other stage is a plain grey segment with no words. CQ-85: the Invite stage still opens the People
// view, where invitations are created.
function Stage({
  counts,
  projection,
  onInvite,
}: {
  counts: BoardingCounts | null;
  projection?: ProgrammeGlanceSource | null;
  onInvite?: () => void;
}) {
  const { states, current } = programmeStage(counts, projection);
  const labels = mrLabels.road;
  const at = current ? programmeRoadSteps.findIndex((step) => step.key === current) : -1;
  return (
    <div className="mr-stage-wrap programme-stage" data-named="true">
      <ol className="mr-stage" aria-label="Where this programme stands">
        {programmeRoadSteps.map((step) => {
          const state = states[step.key];
          const said = state === 'grey' ? '' : `, ${labels.states[state]}`;
          return (
            <li
              key={step.key}
              data-state={state}
              aria-current={state === 'now' ? 'step' : undefined}
            >
              {step.key === 'invite' && onInvite ? (
                <>
                  {/* The name and state are said on every width; the button is the wide-screen shortcut (CQ-85).
                      On a phone the stage names give way to the stage line and the next step opens Participants. */}
                  <span className="sr-only">
                    {step.label}
                    {said}
                  </span>
                  <button
                    type="button"
                    className="mr-stage-name text-link"
                    onClick={onInvite}
                    aria-label={`${step.label}: Open Participants`}
                  >
                    {step.label}
                  </button>
                </>
              ) : (
                <>
                  <span className="mr-stage-name" aria-hidden="true">
                    {step.label}
                  </span>
                  <span className="sr-only">
                    {step.label}
                    {said}
                  </span>
                </>
              )}
            </li>
          );
        })}
      </ol>
      {current ? (
        <p className="mr-stage-line">
          Stage {at + 1} of {programmeRoadSteps.length}: <b>{programmeRoadSteps[at]!.label}</b>
        </p>
      ) : null}
    </div>
  );
}

// The one next step, from the boarding counts. Its line is the boarding line, always out of a total, and
// "Refresh Counts" reads again.
function NextStep({
  live,
  onOpen,
  onRefresh,
}: {
  live: Live;
  onOpen: (target: 'people' | 'plan') => (() => void) | undefined;
  onRefresh?: () => void;
}) {
  const next = programmeNextStep(live.counts);
  const open = onOpen(next.target);
  return (
    <section className="room-next" aria-label="Your next step">
      <span className="room-next-mark" aria-hidden="true">
        <CorridraIcon name={next.target === 'plan' ? 'calendar' : 'people'} />
      </span>
      <span className="room-next-words">
        <small>Your next step</small>
        <b>{next.title}</b>
        <span className="programme-boarding">
          <strong>Boarding</strong> {boardingLine(live.counts)}
          {onRefresh && (
            <button type="button" className="text-link programme-refresh" onClick={onRefresh}>
              Refresh Counts
            </button>
          )}
        </span>
        {!live.counts && live.notice ? <span className="programme-note">{live.notice}</span> : null}
      </span>
      <span className="room-next-actions">
        {open ? (
          <button type="button" className="button" onClick={open}>
            {next.target === 'plan' ? 'Open Programme and Meetings' : 'Open Participants'}
          </button>
        ) : null}
      </span>
    </section>
  );
}

// "At a glance" and "Needs your attention" (Overview). The boarding tiles come from the participants read; the
// readiness, meeting and attention lines come from the programme projection where the projections are on.
function Glance({
  counts,
  projection,
  projectionsOn,
  terms,
  termsOn,
  onOpen,
  host,
}: {
  counts: BoardingCounts | null;
  projection: Parameters<typeof programmeGlance>[1];
  projectionsOn: boolean;
  /** Terms, places and minimum from the terms read; null while unread or where it cannot be read. */
  terms: ChecklistTerms | null;
  termsOn: boolean;
  onOpen: (target: 'people' | 'plan') => (() => void) | undefined;
  /** Where the projection read watches whether the Overview is on screen. */
  host?: (node: HTMLElement | null) => void;
}) {
  const tiles = programmeGlance(counts, projection, projectionsOn);
  const coverage = meetingCoverage(projection);
  const attention = programmeAttention(projection);
  const checklist = projectionsOn || termsOn ? programmeChecklist(counts, projection, terms) : [];
  return (
    <>
      <section ref={host} className="programme-card programme-glance-card" aria-label="At a glance">
        <h5 className="programme-card-title">At a glance</h5>
        <dl className="programme-tiles">
          {tiles.map((tile) => (
            <div key={tile.key} data-known={tile.known ? undefined : 'false'}>
              <dt>{tile.label}</dt>
              <dd>
                {tile.value}
                {tile.of ? <small> {tile.of}</small> : null}
              </dd>
            </div>
          ))}
        </dl>
        {coverage ? <p className="programme-card-note">{coverage}</p> : null}
        <p className="programme-card-foot">
          <CorridraIcon name="lock" />
          Counts only. Participants&apos; quotes, contacts and costs stay private to them.
        </p>
      </section>
      {checklist.length > 0 ? (
        <details
          className="programme-card programme-checklist-card"
          aria-label="Programme checklist"
        >
          <summary>
            <h5 className="programme-card-title">Programme checklist ({checklist.length})</h5>
          </summary>
          <dl className="programme-tiles programme-checklist">
            {checklist.map((row) => (
              <div key={row.key} data-known={row.known ? undefined : 'false'}>
                <dt>{row.fact}</dt>
                <dd>
                  {row.value}
                  {row.note ? <small> {row.note}</small> : null}
                </dd>
              </div>
            ))}
          </dl>
          <p className="programme-card-note">
            Facts from this programme&apos;s records. Corridra does not judge whether it is ready.
          </p>
        </details>
      ) : null}
      {projectionsOn ? (
        <section
          className="programme-card programme-attention-card"
          aria-label="Needs your attention"
        >
          <h5 className="programme-card-title">
            Needs your attention
            {attention.length > 0 ? (
              <span className="programme-badge">{attention.length}</span>
            ) : null}
          </h5>
          {attention.length === 0 ? (
            <p className="programme-quiet">
              {projection ? 'Nothing needs you right now.' : 'Not measured yet.'}
            </p>
          ) : (
            <ul className="programme-attention">
              {attention.map((item) => {
                const open = onOpen(item.target);
                return (
                  <li key={item.key} data-tone={item.tone}>
                    <span className="programme-attention-mark" aria-hidden="true">
                      <CorridraIcon name={item.target === 'plan' ? 'calendar' : 'people'} />
                    </span>
                    <span className="programme-attention-words">
                      <b>{item.title}</b>
                      <span>{item.detail}</span>
                    </span>
                    {open ? (
                      <button type="button" className="button button-secondary" onClick={open}>
                        {item.action}
                      </button>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      ) : null}
    </>
  );
}

// The decisions-first Overview (ADR-084 S0, behind CORRIDRA_DELEGATION_FIRST_RUN). The next real decision takes the
// next-step card's place, with any other decision listed under it; the facts follow as counts out of a total. It
// reads what the room already reads plus the two application counts of the organiser's own page read.
const decisionIcon = { page: 'inbox', people: 'people', plan: 'calendar' } as const;
function Decisions({
  live,
  projection,
  applications,
  onOpen,
  onRefresh,
}: {
  live: Live;
  projection: ProgrammeGlanceSource | null;
  applications: ApplicationCounts | null;
  onOpen: (target: DecisionTarget) => (() => void) | undefined;
  onRefresh?: () => void;
}) {
  const [first, ...rest] = programmeDecisions(live.counts, projection, applications);
  const open = onOpen(first!.target);
  return (
    <section className="room-next room-decisions" aria-label="Your next decision">
      <span className="room-next-mark" aria-hidden="true">
        <CorridraIcon name={decisionIcon[first!.target]} />
      </span>
      <span className="room-next-words">
        <small>Your next decision</small>
        <b>{first!.title}</b>
        {!live.counts && live.notice ? <span className="programme-note">{live.notice}</span> : null}
      </span>
      <span className="room-next-actions">
        {open ? (
          <button type="button" className="button" onClick={open}>
            {first!.action}
          </button>
        ) : null}
        {onRefresh && (
          <button type="button" className="text-link programme-refresh" onClick={onRefresh}>
            Refresh Counts
          </button>
        )}
      </span>
      {rest.length > 0 ? (
        <ul className="room-decisions-then" aria-label="Then">
          {rest.map((item) => {
            const go = onOpen(item.target);
            return (
              <li key={item.key}>
                <span>{item.title}</span>
                {go ? (
                  <button type="button" className="text-link" onClick={go}>
                    {item.action}
                  </button>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}
    </section>
  );
}

// The facts under the decisions: counts out of a total, and the checklist of facts already read, folded.
function Facts({
  counts,
  projection,
  terms,
  applications,
  checklistOn,
  host,
}: {
  counts: BoardingCounts | null;
  projection: ProgrammeGlanceSource | null;
  terms: ChecklistTerms | null;
  applications: ApplicationCounts | null;
  checklistOn: boolean;
  host?: (node: HTMLElement | null) => void;
}) {
  const tiles = programmeFacts(counts, projection, terms, applications);
  const coverage = meetingCoverage(projection);
  // Only facts that were read: a row whose record is not loaded is left out, not called unknown.
  const checklist = checklistOn
    ? programmeChecklist(counts, projection, terms).filter((row) => row.known)
    : [];
  return (
    <>
      <section ref={host} className="programme-card programme-glance-card" aria-label="At a glance">
        <h5 className="programme-card-title">At a glance</h5>
        {tiles.length > 0 ? (
          <dl className="programme-tiles">
            {tiles.map((tile) => (
              <div key={tile.key} data-known={tile.known ? undefined : 'false'}>
                <dt>{tile.label}</dt>
                <dd>
                  {tile.value}
                  {tile.of ? <small> {tile.of}</small> : null}
                </dd>
              </div>
            ))}
          </dl>
        ) : (
          <p className="programme-quiet">No counts yet. They appear here as people are invited.</p>
        )}
        {coverage ? <p className="programme-card-note">{coverage}</p> : null}
        <p className="programme-card-foot">
          <CorridraIcon name="lock" />
          Counts only. Participants&apos; quotes, contacts and costs stay private to them.
        </p>
      </section>
      {checklist.length > 0 ? (
        <details
          className="programme-card programme-checklist-card"
          aria-label="Programme checklist"
        >
          <summary>
            <h5 className="programme-card-title">Programme checklist ({checklist.length})</h5>
          </summary>
          <dl className="programme-tiles programme-checklist">
            {checklist.map((row) => (
              <div key={row.key}>
                <dt>{row.fact}</dt>
                <dd>
                  {row.value}
                  {row.note ? <small> {row.note}</small> : null}
                </dd>
              </div>
            ))}
          </dl>
          <p className="programme-card-note">
            Facts from this programme&apos;s records. Corridra does not judge whether it is ready.
          </p>
        </details>
      ) : null}
    </>
  );
}

function LiveGlance(props: {
  scope: ParticipantScope;
  counts: BoardingCounts | null;
  terms: ChecklistTerms | null;
  termsOn: boolean;
  onProjection: (projection: ProgrammeGlanceSource | null) => void;
  onOpen: (target: 'people' | 'plan') => (() => void) | undefined;
  /** Decisions-first: the facts replace the glance and attention cards. */
  facts?: { applications: ApplicationCounts | null };
}) {
  const { subject, issuer, workspaceId, programmeId } = props.scope;
  const { host, ...view } = useProgrammeGlance(
    { subject, issuer },
    workspaceId ?? '',
    programmeId ?? '',
  );
  const { onProjection } = props;
  const projection = view.data;
  useEffect(() => {
    onProjection(projection);
    return () => onProjection(null);
  }, [projection, onProjection]);
  return (
    <>
      {props.facts ? (
        <Facts
          counts={props.counts}
          projection={projection}
          terms={props.terms}
          applications={props.facts.applications}
          checklistOn
          host={host}
        />
      ) : (
        <Glance
          counts={props.counts}
          projection={projection}
          projectionsOn
          terms={props.terms}
          termsOn={props.termsOn}
          onOpen={props.onOpen}
          host={host}
        />
      )}
      {!view.data && view.notice ? <p className="programme-note">{view.notice}</p> : null}
    </>
  );
}

// True while the room is on screen (with a little room around it). A long list of programmes then reads
// only the ones the person can see, instead of every programme at once, and a room scrolled far away
// stops refreshing. Where the browser cannot tell, the room counts as on screen.
function useOnScreen() {
  const [onScreen, setOnScreen] = useState(false);
  const watch = useCallback((node: HTMLElement | null) => {
    if (!node) return;
    if (typeof IntersectionObserver === 'undefined') {
      setOnScreen(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        const last = entries[entries.length - 1];
        if (last) setOnScreen(last.isIntersecting);
      },
      { rootMargin: '200px 0px' },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  return [onScreen, watch] as const;
}

// Reads the invitations and consented registrations the participants panel reads, with the same
// access rules and the same hiding when the page is hidden. Counts only. The participants panel keeps its
// own copy of the same read, so the room reads again whenever the person changes view or asks for it. It draws
// nothing itself: it hands the counts to the room, which shows them in the stage, the next step and the glance.
function LiveStatus({ scope, onRead }: { scope: ParticipantScope; onRead: (live: Live) => void }) {
  const view = useParticipantView(scope, noop);
  const { status, data, notice } = view;
  const counts = useMemo(
    () =>
      status === 'ready' && data
        ? boardingCounts({
            invitations: data.invitations,
            registrations: data.registrations,
            moreInvitations: !!data.nextInvitationAfter,
            moreRegistrations: !!data.nextRegistrationAfter,
          })
        : null,
    [status, data],
  );
  useEffect(() => onRead({ counts, notice }), [counts, notice, onRead]);
  return null;
}

export function ProgrammeRoom({
  programmeId,
  name,
  purpose,
  notes,
  scope,
  participantsEnabled,
  panels: parts,
  sharedMoneyNote = false,
  projectionsEnabled = false,
  termsEnabled = false,
  decisionsFirst = false,
  boardFirst = false,
}: {
  programmeId: string;
  name: string;
  purpose: string;
  /** The lines the programme list shows under the name, kept word for word. */
  notes: ReactNode;
  scope: ParticipantScope;
  participantsEnabled: boolean;
  panels: RoomPanels;
  /** True where fee schedules, pricing templates or series are on: they sit in the page's own tabs. */
  sharedMoneyNote?: boolean;
  /** True where the programme projections are on: the Overview then reads readiness, meetings and flags. */
  projectionsEnabled?: boolean;
  /** True where the terms panel is on: the checklist then reads terms, places and minimum from it. */
  termsEnabled?: boolean;
  /** ADR-084 S0: the next real decision first and counts out of a total. Off leaves the room as it was. */
  decisionsFirst?: boolean;
  /** ADR-084 S3: applications are answered on the people board, so that decision opens the People group at the board. */
  boardFirst?: boolean;
}) {
  // An old link to one of this programme's sections (#<programme id>-<view>) opens the group that holds it
  // (layout budget L-03); the section is then scrolled to.
  const [linked] = useState<RoomGroupKey | null>(() => {
    if (typeof window === 'undefined') return null;
    const prefix = `#${programmeId}-`;
    const hash = window.location.hash;
    if (!hash.startsWith(prefix)) return null;
    const view = hash.slice(prefix.length);
    return (
      roomGroups.find((group) => (group.members as readonly string[]).includes(view))?.key ?? null
    );
  });
  const [lens, setLens] = useState<RoomGroupKey>(linked ?? 'overview');
  const [opened, setOpened] = useState<ReadonlySet<RoomGroupKey>>(
    () => new Set<RoomGroupKey>(['overview', ...(linked ? [linked] : [])]),
  );
  useEffect(() => {
    if (!linked) return;
    document.getElementById(window.location.hash.slice(1))?.scrollIntoView();
  }, [linked]);
  const [reads, setReads] = useState(0);
  // Choosing a group moves focus to that group's heading (Wave 6, Q-01), so the person lands on what they chose.
  const [arrived, setArrived] = useState<RoomGroupKey | null>(null);
  useEffect(() => {
    if (arrived) document.getElementById(`${programmeId}-${arrived}-title`)?.focus();
  }, [arrived, programmeId]);
  const [onScreen, watch] = useOnScreen();
  // The room shows five groups. Each group holds the views it always held, mounted under their own section ids
  // (`${programmeId}-<view>`); a view that has no panel is not there, and a group with no view is not offered.
  const panels: Partial<Record<RoomGroupKey, ReactNode>> = {};
  for (const group of roomGroups) {
    const present = group.members.filter((member) => parts[member]);
    if (present.length === 0) continue;
    panels[group.key] = (
      <>
        {present.map((member) => {
          const view = (
            <>
              {parts[member]}
              {member === 'money' && sharedMoneyNote && (
                <p className="programme-note">
                  Fee schedules, pricing templates and series are shared across your programmes and
                  are in the Templates and Pricing, Series and Exports tabs of this page.
                </p>
              )}
              {member === 'results' && sharedMoneyNote && (
                <p className="programme-note">
                  Programme exports are shared across your programmes and are in the Pricing, Series
                  and Exports tab of this page.
                </p>
              )}
            </>
          );
          return member === group.key ? (
            <div key={member}>{view}</div>
          ) : (
            <section
              key={member}
              id={`${programmeId}-${member}`}
              aria-label={roomViewLabels[member]}
            >
              {view}
            </section>
          );
        })}
      </>
    );
  }
  const lenses = roomGroups;
  const available = lenses.filter((item) => item.key === 'overview' || panels[item.key]);
  const [read, setRead] = useState<Live>(nothingRead);
  const onRead = useCallback((live: Live) => setRead(live), []);
  const reading = participantsEnabled && onScreen;
  const live = reading ? read : nothingRead;
  const refresh = () => setReads((count) => count + 1);
  // The programme projection is read inside the glance; its agenda also marks the "Plan the days" stage. The
  // terms read runs here, beside it, so neither waits for the other (nor does the Overview wait for either).
  const [readProjection, setReadProjection] = useState<ProgrammeGlanceSource | null>(null);
  const onProjection = useCallback(
    (value: ProgrammeGlanceSource | null) => setReadProjection(value),
    [],
  );
  const termsOn = participantsEnabled && termsEnabled;
  const terms = useChecklistTerms(scope, termsOn && reading, reads);
  const projection = reading && projectionsEnabled ? readProjection : null;
  const onInvite = panels.people ? () => choose('people') : undefined;
  const onOpen = (target: 'people' | 'plan') => (panels[target] ? () => choose(target) : undefined);
  const glanceOn = participantsEnabled || projectionsEnabled;
  const registered = live.counts?.complete ? live.counts.registered : null;
  // Decisions-first reads the page's two application counts where this programme has a public page panel.
  const decisions = decisionsFirst && participantsEnabled;
  const applications = useApplicationCounts(scope, decisions && reading && !!parts.page, reads);
  // A decision about applications opens the group that holds the public page and goes to that section.
  const [goTo, setGoTo] = useState<{ view: string; turn: number } | null>(null);
  useEffect(() => {
    if (!goTo) return;
    const id = `${programmeId}-${goTo.view}`;
    // The board is scrolled to once it has its applications (it says so with data-settled), so the page is tall enough
    // for it to land at the top; after three seconds it is reached anyway.
    const reach = (patient: boolean) => {
      const target = document.getElementById(id);
      if (!target || (goTo.view === 'board' && patient && target.dataset.settled !== 'true'))
        return false;
      target.scrollIntoView();
      // The people board is a region that takes focus, so the decision lands on the applications it holds.
      if (goTo.view === 'board') target.focus({ preventScroll: true });
      return true;
    };
    if (reach(true) || goTo.view !== 'board') return;
    // The participants panel loads the first time People opens, so the board can arrive a moment after the click.
    const watching = new MutationObserver(() => {
      if (reach(true)) watching.disconnect();
    });
    watching.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['data-settled'],
    });
    const stop = setTimeout(() => {
      watching.disconnect();
      reach(false);
    }, 3000);
    return () => {
      watching.disconnect();
      clearTimeout(stop);
    };
  }, [goTo, programmeId]);
  const onDecision = (target: DecisionTarget) => {
    if (boardFirst && target === 'page')
      return panels.people
        ? () => {
            choose('people');
            setGoTo((last) => ({ view: 'board', turn: (last?.turn ?? 0) + 1 }));
          }
        : undefined;
    if (target !== 'page') return onOpen(target);
    return panels.people && parts.page
      ? () => {
          choose('people');
          setGoTo((last) => ({ view: 'page', turn: (last?.turn ?? 0) + 1 }));
        }
      : undefined;
  };
  function choose(key: RoomGroupKey) {
    if (key !== lens) refresh();
    if (key !== lens) setArrived(key);
    setLens(key);
    setOpened((current) => (current.has(key) ? current : new Set(current).add(key)));
  }
  return (
    <article ref={watch} className="room programme-room" aria-label={name}>
      <header className="room-head">
        <div className="room-tags">
          <span className="room-tag" data-journey="organise">
            Organising
          </span>
        </div>
        <h3>{name}</h3>
        <p className="room-meta">{purpose}</p>
        <div className="programme-notes">{notes}</div>
        <div className="room-stage room-stage--timeline">
          <Stage counts={live.counts} projection={projection} onInvite={onInvite} />
        </div>
      </header>
      {reading ? <LiveStatus key={reads} scope={scope} onRead={onRead} /> : null}
      {decisions ? (
        <Decisions
          live={live}
          projection={projection}
          applications={applications}
          onOpen={onDecision}
          onRefresh={reading ? refresh : undefined}
        />
      ) : participantsEnabled ? (
        <NextStep live={live} onOpen={onOpen} onRefresh={reading ? refresh : undefined} />
      ) : (
        // Without the participants panel there is nothing to read or do next, so the room says only that.
        <p className="programme-boarding">
          <strong>Boarding</strong> {boardingLine(null)}
        </p>
      )}
      <div className="room-lenses" role="group" aria-label="Programme views">
        {available.map((item) => (
          <button
            key={item.key}
            type="button"
            className="room-lens"
            aria-pressed={lens === item.key}
            data-count={item.key === 'people' && registered ? registered : undefined}
            // The count is decorative: the button is named by its label alone.
            aria-label={item.key === 'people' && registered ? item.label : undefined}
            aria-controls={
              opened.has(item.key)
                ? [
                    `${programmeId}-${item.key}`,
                    ...item.members
                      .filter((member) => member !== item.key && parts[member])
                      .map((member) => `${programmeId}-${member}`),
                  ].join(' ')
                : undefined
            }
            onClick={() => choose(item.key)}
          >
            {item.label}
          </button>
        ))}
      </div>
      {available.map(
        (item) =>
          opened.has(item.key) && (
            <section
              key={item.key}
              id={`${programmeId}-${item.key}`}
              aria-label={item.label}
              hidden={lens !== item.key}
              className={item.key === 'overview' && glanceOn ? 'programme-overview' : undefined}
            >
              <h4
                id={`${programmeId}-${item.key}-title`}
                className="room-group-title"
                tabIndex={-1}
              >
                {item.label}
              </h4>
              {item.key === 'overview' && glanceOn ? (
                projectionsEnabled && reading && scope.workspaceId && scope.programmeId ? (
                  <LiveGlance
                    key={reads}
                    scope={scope}
                    counts={live.counts}
                    terms={terms}
                    termsOn={termsOn}
                    onProjection={onProjection}
                    onOpen={onOpen}
                    facts={decisions ? { applications } : undefined}
                  />
                ) : decisions ? (
                  <Facts
                    counts={live.counts}
                    projection={null}
                    terms={terms}
                    applications={applications}
                    checklistOn={termsOn}
                  />
                ) : (
                  <Glance
                    counts={live.counts}
                    projection={null}
                    projectionsOn={projectionsEnabled}
                    terms={terms}
                    termsOn={termsOn}
                    onOpen={onOpen}
                  />
                )
              ) : null}
              {item.key === 'overview' && !panels.overview
                ? !glanceOn &&
                  available.length > 1 && (
                    <p className="programme-note">Choose a view above to work on this programme.</p>
                  )
                : panels[item.key]}
            </section>
          ),
      )}
    </article>
  );
}
