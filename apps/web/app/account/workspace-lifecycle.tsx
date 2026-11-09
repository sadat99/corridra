'use client';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { CustomerWorkspace } from '@corridra/auth/customer-workspaces';
import { Dialog } from '../../components/ux/dialog';
import { MenuButton } from '../../components/ux/overflow-menu';
import { SegmentedFilter } from '../../components/ux/segmented-filter';
import {
  AnswerBody,
  ArchiveBody,
  CancelBody,
  RenameBody,
  RestoreBody,
  TransferBody,
} from './workspace-lifecycle-dialogs';
import {
  readLifecycleList,
  readLifecycleState,
  sessionHeaders,
  lifecycleWords,
  useLifecycleCommand,
  whenWords,
  type LifecycleState,
} from './workspace-lifecycle-client';

type Kind = 'rename' | 'archive' | 'restore' | 'transfer' | 'cancel' | 'accept' | 'decline';
type Filter = 'active' | 'archived';
export const archivedBannerWords =
  'This workspace is archived. New private requests, invitations and registrations are paused. Existing records stay readable.';

const openOffer = (state: LifecycleState) =>
  state.offer && Date.parse(state.offer.expiresAt) > Date.now() ? state.offer : null;

function titleFor(kind: Kind, name: string) {
  return {
    rename: 'Rename Workspace',
    archive: `Archive ${name}?`,
    restore: `Restore ${name}?`,
    transfer: 'Transfer Ownership',
    cancel: 'Cancel Ownership Offer?',
    accept: `Accept Ownership of ${name}?`,
    decline: 'Decline Ownership?',
  }[kind];
}

/** Undo for ten seconds after an archive; Restore Workspace stays in the row menu afterwards. */
function UndoLine({
  name,
  state,
  headers,
  onRestored,
  onFailed,
}: {
  name: string;
  state: LifecycleState | undefined;
  headers: Record<string, string>;
  onRestored: () => void;
  onFailed: (message: string) => void;
}) {
  const { send, busy } = useLifecycleCommand(headers);
  return (
    <p role="status" className="ux-undo">
      {name} was archived.{' '}
      <button
        type="button"
        className="text-link"
        disabled={busy || !state}
        onClick={() => {
          if (!state) return;
          void send({
            action: 'restore',
            workspaceId: state.workspaceId,
            expectedVersion: state.version,
          }).then((result) => {
            if (result?.kind === 'done') onRestored();
            else if (result?.kind === 'stale') onFailed(lifecycleWords.changed);
            else if (result?.kind === 'archived') onFailed(lifecycleWords.archived);
            else if (result?.kind === 'failed') onFailed(result.message);
          });
        }}
      >
        Undo
      </button>
    </p>
  );
}

/** What one workspace has to say: an ownership offer, or the archived banner. Nothing else is drawn. */
function WorkspaceLifecycleCard({
  state,
  name,
  onOpen,
}: {
  state: LifecycleState;
  name: string;
  onOpen: (kind: Kind) => void;
}) {
  const offer = state.offer;
  const live = openOffer(state);
  return (
    <div className="ux-draft-notice" role="group" aria-label={`Workspace notices for ${name}`}>
      <p>
        <strong>{name}</strong>
        {state.archived && <span className="ux-badge"> Archived</span>}
      </p>
      {state.archived && <p role="status">{archivedBannerWords}</p>}
      {offer && state.role === 'owner' && offer.byYou && (
        <p role="status">
          {live
            ? `Ownership offer sent. It stays open until ${whenWords(offer.expiresAt)}. `
            : `The offer expired on ${whenWords(offer.expiresAt)}. You are still the owner. `}
          {live ? (
            <button type="button" className="text-link" onClick={() => onOpen('cancel')}>
              Cancel Offer
            </button>
          ) : (
            state.open && (
              <button type="button" className="text-link" onClick={() => onOpen('transfer')}>
                Transfer Ownership
              </button>
            )
          )}
        </p>
      )}
      {offer && offer.toYou && (
        <p role="status">
          {live
            ? `The owner wants to make you the owner of ${name}. This offer is open until ${whenWords(offer.expiresAt)}. If you accept, they become an admin. `
            : `This offer expired on ${whenWords(offer.expiresAt)}. Ask the owner to send a new one.`}
          {live && !state.open && 'Accepting is paused right now. '}
          {live && (
            <>
              <button type="button" className="text-link" onClick={() => onOpen('decline')}>
                Decline
              </button>
              {state.open && (
                <>
                  {' '}
                  <button type="button" className="primary-link" onClick={() => onOpen('accept')}>
                    Accept Ownership
                  </button>
                </>
              )}
            </>
          )}
        </p>
      )}
    </div>
  );
}

/**
 * Owner actions for each workspace (rename, hand over, archive, restore) and the member's answer to an
 * ownership offer. When the server does not offer the control the hook has nothing to show and the page is
 * as it was: no menu items, no notices, no dead buttons.
 */
export function useWorkspaceLifecycle({
  subject,
  issuer,
  rows,
  enabled,
  refreshRows,
  focusBack,
}: {
  subject: string;
  issuer: string;
  rows: CustomerWorkspace[];
  enabled: boolean;
  refreshRows: () => Promise<boolean>;
  focusBack: (name?: string) => () => HTMLElement | null;
}) {
  const headers = useMemo(() => sessionHeaders(subject, issuer), [subject, issuer]);
  const [states, setStates] = useState<Record<string, LifecycleState>>({});
  const [filter, setFilter] = useState<Filter>('active');
  const [dialog, setDialog] = useState<{ kind: Kind; id: string } | null>(null);
  const [working, setWorking] = useState(false);
  const [announce, setAnnounce] = useState<string | null>(null);
  const [undo, setUndo] = useState<{ id: string; name: string } | null>(null);
  const [reloadTick, setReloadTick] = useState(0);
  const [problem, setProblem] = useState<string | null>(null);
  const [refreshFailed, setRefreshFailed] = useState(false);
  const key = rows.map((row) => row.id).join(',');

  useEffect(() => {
    if (!enabled || !key) return;
    const controller = new AbortController();
    // A read that fails keeps what was last known for that workspace and says so: an archived workspace must never
    // be drawn as active because a refresh did not arrive. Only an answer that the control is absent clears it.
    void (async () => {
      try {
        if (!(await readLifecycleList(headers, controller.signal))) {
          if (!controller.signal.aborted) {
            setStates({});
            setRefreshFailed(false);
          }
          return;
        }
        const read = await Promise.all(
          key.split(',').map(async (id) => {
            try {
              return { id, state: await readLifecycleState(id, headers, controller.signal) };
            } catch {
              return { id, state: undefined };
            }
          }),
        );
        if (controller.signal.aborted) return;
        setRefreshFailed(read.some((entry) => entry.state === undefined));
        setStates((before) =>
          Object.fromEntries(
            read.flatMap((entry) => {
              const next = entry.state === undefined ? before[entry.id] : entry.state;
              return next ? [[entry.id, next] as const] : [];
            }),
          ),
        );
      } catch {
        if (!controller.signal.aborted) setRefreshFailed(true);
      }
    })();
    return () => controller.abort();
  }, [enabled, key, headers, reloadTick]);

  useEffect(() => {
    if (!undo) return;
    const timer = setTimeout(() => setUndo(null), 10_000);
    return () => clearTimeout(timer);
  }, [undo]);

  const archivedCount = rows.filter((row) => states[row.id]?.archived).length;
  const showFilter = archivedCount > 0;
  const mode: Filter = showFilter ? filter : 'active';
  const visibleRows = rows.filter((row) => !!states[row.id]?.archived === (mode === 'archived'));
  const nameOf = (id: string) => rows.find((row) => row.id === id)?.name ?? states[id]?.name ?? '';
  const onBusyChange = useCallback((busy: boolean) => setWorking(busy), []);
  const finished = (message: string, undoId?: string) => {
    const id = dialog?.id;
    setDialog(null);
    // The Undo line says an archive happened, so it is not announced twice.
    setAnnounce(undoId ? null : message);
    setProblem(null);
    setUndo(undoId && id ? { id, name: nameOf(id) } : null);
    setReloadTick((tick) => tick + 1);
    void refreshRows();
  };

  const filterControl = showFilter ? (
    <SegmentedFilter
      label="Show workspaces"
      value={mode}
      onChange={setFilter}
      options={[
        { value: 'active', label: 'Active', count: rows.length - archivedCount },
        { value: 'archived', label: 'Archived', count: archivedCount },
      ]}
    />
  ) : null;

  const menuItems = (row: CustomerWorkspace): ReactNode => {
    const state = states[row.id];
    if (!state || state.role !== 'owner') return null;
    const open = (kind: Kind) => () => setDialog({ kind, id: row.id });
    // Restore works while the control is paused, so a pause never traps an archive.
    if (state.archived)
      return (
        <MenuButton data-menu-close="" onClick={open('restore')}>
          Restore Workspace
        </MenuButton>
      );
    // A paused control offers no new changes; an open offer can still be cancelled from its notice.
    if (!state.open) return null;
    return (
      <>
        <MenuButton data-menu-close="" onClick={open('rename')}>
          Rename Workspace
        </MenuButton>
        {openOffer(state)?.byYou ? (
          <MenuButton data-menu-close="" onClick={open('cancel')}>
            Cancel Ownership Offer
          </MenuButton>
        ) : (
          <MenuButton data-menu-close="" onClick={open('transfer')}>
            Transfer Ownership
          </MenuButton>
        )}
        <MenuButton data-menu-close="" onClick={open('archive')}>
          Archive Workspace
        </MenuButton>
      </>
    );
  };

  const cards = rows.filter((row) => {
    const state = states[row.id];
    return state && ((state.archived && mode === 'archived') || state.offer);
  });
  const current = dialog ? states[dialog.id] : undefined;
  const shared = {
    headers,
    onFinished: (message: string, change?: { undoId?: string }) =>
      finished(message, change?.undoId),
    onCancel: () => setDialog(null),
    onBusyChange,
    onReload: () => {
      setDialog(null);
      setReloadTick((tick) => tick + 1);
      void refreshRows();
    },
  };
  const kinds: Kind[] = ['rename', 'archive', 'restore', 'transfer', 'cancel', 'accept', 'decline'];
  const panel = (
    <>
      {filterControl}
      {announce && (
        <p role="status" className="ux-draft-notice">
          {announce}
        </p>
      )}
      {refreshFailed && (
        <p role="status" className="ux-hint">
          Could not refresh workspace status. Showing the last known status.
        </p>
      )}
      {problem && (
        <p role="alert" className="ux-error-summary">
          {problem}
        </p>
      )}
      {undo && (
        <UndoLine
          name={undo.name}
          state={states[undo.id]}
          headers={headers}
          onFailed={setProblem}
          onRestored={() => {
            setUndo(null);
            setProblem(null);
            setAnnounce(`${undo.name} was restored.`);
            setReloadTick((tick) => tick + 1);
            void refreshRows();
          }}
        />
      )}
      {cards.map((row) => (
        <WorkspaceLifecycleCard
          key={'notice:' + row.id}
          state={states[row.id]!}
          name={row.name}
          onOpen={(kind) => setDialog({ kind, id: row.id })}
        />
      ))}
      {kinds.map((kind) => {
        const here = dialog?.kind === kind;
        const name = dialog ? nameOf(dialog.id) : '';
        return (
          <Dialog
            key={kind}
            open={here && !!current}
            onClose={() => setDialog((d) => (d?.kind === kind ? null : d))}
            title={titleFor(kind, name)}
            locked={working}
            returnFocusTo={focusBack(name)}
          >
            {here && current && (
              <>
                {kind === 'rename' && (
                  <RenameBody key={current.workspaceId} state={current} {...shared} />
                )}
                {kind === 'archive' && (
                  <ArchiveBody key={current.workspaceId} state={current} {...shared} />
                )}
                {kind === 'restore' && (
                  <RestoreBody key={current.workspaceId} state={current} {...shared} />
                )}
                {kind === 'transfer' && (
                  <TransferBody key={current.workspaceId} state={current} {...shared} />
                )}
                {kind === 'cancel' && (
                  <CancelBody key={current.workspaceId} state={current} {...shared} />
                )}
                {(kind === 'accept' || kind === 'decline') && (
                  <AnswerBody key={current.workspaceId} state={current} answer={kind} {...shared} />
                )}
              </>
            )}
          </Dialog>
        );
      })}
    </>
  );

  return {
    /** Rows to draw for the chosen filter. */
    visibleRows,
    isArchived: (id: string) => !!states[id]?.archived,
    /** The status of this workspace could not be read, so it is not known to accept new requests. */
    statusUnknown: (id: string) => refreshFailed && !states[id],
    ownerMemberId: (id: string) => states[id]?.ownerMemberId ?? null,
    menuItems,
    panel,
  };
}
