'use client';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { CorridraIcon } from '../../../components/corridra-icon';
import { mrLabels } from '../../../components/mr/labels';
import {
  boardingCounts,
  boardingLine,
  meetingCoverage,
  programmeAttention,
  programmeGlance,
  programmeNextStep,
  programmeRoadSteps,
  programmeStage,
  roomGroups,
  roomViewLabels,
  type BoardingCounts,
  type RoomGroupKey,
  type RoomLensKey,
} from '../../../lib/programme-room';
import { useParticipantView, type ParticipantScope } from './participant-client';
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
function Stage({ counts, onInvite }: { counts: BoardingCounts | null; onInvite?: () => void }) {
  const { states, current } = programmeStage(counts);
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
  onOpen,
  host,
}: {
  counts: BoardingCounts | null;
  projection: Parameters<typeof programmeGlance>[1];
  projectionsOn: boolean;
  onOpen: (target: 'people' | 'plan') => (() => void) | undefined;
  /** Where the projection read watches whether the Overview is on screen. */
  host?: (node: HTMLElement | null) => void;
}) {
  const tiles = programmeGlance(counts, projection, projectionsOn);
  const coverage = meetingCoverage(projection);
  const attention = programmeAttention(projection);
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

function LiveGlance(props: {
  scope: ParticipantScope;
  counts: BoardingCounts | null;
  onOpen: (target: 'people' | 'plan') => (() => void) | undefined;
}) {
  const { subject, issuer, workspaceId, programmeId } = props.scope;
  const { host, ...view } = useProgrammeGlance(
    { subject, issuer },
    workspaceId ?? '',
    programmeId ?? '',
  );
  return (
    <>
      <Glance
        counts={props.counts}
        projection={view.data}
        projectionsOn
        onOpen={props.onOpen}
        host={host}
      />
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
  const onInvite = panels.people ? () => choose('people') : undefined;
  const onOpen = (target: 'people' | 'plan') => (panels[target] ? () => choose(target) : undefined);
  const glanceOn = participantsEnabled || projectionsEnabled;
  const registered = live.counts?.complete ? live.counts.registered : null;
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
        <div className="room-stage">
          <Stage counts={live.counts} onInvite={onInvite} />
        </div>
      </header>
      {reading ? <LiveStatus key={reads} scope={scope} onRead={onRead} /> : null}
      {participantsEnabled ? (
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
                  <LiveGlance key={reads} scope={scope} counts={live.counts} onOpen={onOpen} />
                ) : (
                  <Glance
                    counts={live.counts}
                    projection={null}
                    projectionsOn={projectionsEnabled}
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
