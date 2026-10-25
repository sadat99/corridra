'use client';
import { useCallback, useState, type ReactNode } from 'react';
import { mrLabels } from '../../../components/mr/labels';
import { emblemFor } from '../../../lib/room';
import {
  boardingCounts,
  boardingLine,
  programmeRoadLegend,
  programmeRoadStates,
  programmeRoadSteps,
  roomLenses,
  type BoardingCounts,
  type RoomLensKey,
} from '../../../lib/programme-room';
import { useParticipantView, type ParticipantScope } from './participant-client';

// The Programme Room (Lane 10): one programme in one place. Its styles come from programme-room-styles.tsx,
// which the page mounts with the switch, so this file (and the delegation screens that import it) imports
// no stylesheet of its own. It wraps panels that already exist and
// changes none of them: the same components, the same props, the same data. Each view mounts its panel
// the first time it is opened and keeps it mounted afterwards, so anything typed in a panel is still
// there when the person comes back to it. The room reads nothing the participants panel does not
// already read, and shows only counts and states, never a participant's own answers.
export type RoomPanels = Partial<Record<RoomLensKey, ReactNode>>;

const noop = () => {};

const marks = {
  done: () => '✓',
  now: (index: number) => String(index + 1),
  later: (index: number) => String(index + 1),
  notTracked: () => '–',
};

// The same list, shapes and words as the request Road (components/mr/road.tsx), with the programme's
// own steps. Each state is worked out from a record or it is "not tracked yet".
function Road({ counts }: { counts: BoardingCounts | null }) {
  const states = programmeRoadStates(counts);
  const labels = mrLabels.road;
  return (
    <div className="mr-road-wrap">
      <ol className="mr-road" aria-label="Where this programme stands">
        {programmeRoadSteps.map((step, index) => {
          const state = states[step.key];
          return (
            <li
              key={step.key}
              data-state={state}
              aria-current={state === 'now' ? 'step' : undefined}
            >
              <span className="mr-road-dot" aria-hidden="true">
                {marks[state](index)}
              </span>
              <span className="mr-road-text">
                <b>{step.label}</b>
                <span className="mr-road-state">{labels.states[state]}</span>
              </span>
            </li>
          );
        })}
      </ol>
      <p className="mr-road-legend">{programmeRoadLegend}</p>
    </div>
  );
}

function Status({
  counts,
  notice = '',
  onRefresh,
}: {
  counts: BoardingCounts | null;
  notice?: string;
  onRefresh?: () => void;
}) {
  return (
    <>
      <Road counts={counts} />
      <p className="programme-boarding">
        <strong>Boarding</strong> {boardingLine(counts)}
        {onRefresh && (
          <button type="button" className="text-link programme-refresh" onClick={onRefresh}>
            Refresh counts
          </button>
        )}
      </p>
      {!counts && notice && <p className="programme-note">{notice}</p>}
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
// own copy of the same read, so the room reads again whenever the person changes view or asks for it.
function LiveStatus({ scope, onRefresh }: { scope: ParticipantScope; onRefresh: () => void }) {
  const view = useParticipantView(scope, noop);
  const counts =
    view.status === 'ready' && view.data
      ? boardingCounts({
          invitations: view.data.invitations,
          registrations: view.data.registrations,
          moreInvitations: !!view.data.nextInvitationAfter,
          moreRegistrations: !!view.data.nextRegistrationAfter,
        })
      : null;
  return <Status counts={counts} notice={view.notice} onRefresh={onRefresh} />;
}

export function ProgrammeRoom({
  programmeId,
  name,
  purpose,
  notes,
  scope,
  participantsEnabled,
  panels,
  sharedMoneyNote = false,
}: {
  programmeId: string;
  name: string;
  purpose: string;
  /** The lines the programme list shows under the name, kept word for word. */
  notes: ReactNode;
  scope: ParticipantScope;
  participantsEnabled: boolean;
  panels: RoomPanels;
  /** True where fee schedules, pricing templates or series are on: they sit below the programme list. */
  sharedMoneyNote?: boolean;
}) {
  const [lens, setLens] = useState<RoomLensKey>('overview');
  const [opened, setOpened] = useState<ReadonlySet<RoomLensKey>>(new Set(['overview']));
  const [reads, setReads] = useState(0);
  const [onScreen, watch] = useOnScreen();
  const available = roomLenses.filter((item) => item.key === 'overview' || panels[item.key]);
  const emblem = emblemFor(name);
  const refresh = () => setReads((count) => count + 1);
  function choose(key: RoomLensKey) {
    if (key !== lens) refresh();
    setLens(key);
    setOpened((current) => (current.has(key) ? current : new Set(current).add(key)));
  }
  return (
    <article ref={watch} className="room programme-room" aria-label={name}>
      <header className="room-head">
        <span className="room-emblem" data-tone={emblem.tone} aria-hidden="true">
          {emblem.initials}
        </span>
        <div>
          <h3>{name}</h3>
          <p>{purpose}</p>
          {notes}
        </div>
      </header>
      {participantsEnabled && onScreen ? (
        <LiveStatus key={reads} scope={scope} onRefresh={refresh} />
      ) : (
        <Status counts={null} />
      )}
      <div className="room-lenses" role="group" aria-label="Programme views">
        {available.map((item) => (
          <button
            key={item.key}
            type="button"
            className="room-lens"
            aria-pressed={lens === item.key}
            aria-controls={opened.has(item.key) ? `${programmeId}-${item.key}` : undefined}
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
            >
              {item.key === 'overview' && !panels.overview
                ? available.length > 1 && (
                    <p className="programme-note">Choose a view above to work on this programme.</p>
                  )
                : panels[item.key]}
              {item.key === 'money' && sharedMoneyNote && (
                <p className="programme-note">
                  Fee schedules, pricing templates and series are shared across your programmes and
                  stay below the programme list, exactly as before.
                </p>
              )}
            </section>
          ),
      )}
    </article>
  );
}
