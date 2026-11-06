'use client';
// The team command palette (Navigation v1, CommandPalette board): Ctrl K or the Search button in the
// sidebar opens it. Scopes All, Missions, Companies and Actions; Up and Down move, Enter opens, Tab
// changes scope, Escape closes. Missions and Companies come from one role-checked search route; Actions
// are the places the person's role may open. People is not offered: no search can answer it yet.
// "Searches only what your role may open" is true because the server reads through the same role-checked
// services as the workspace lists. Owner: S4.
import './team-nav.css';
import { useEffect, useId, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { OperatorIcon } from '../operator-icon';
import { missionPath } from '../../lib/ux/palette-paths';
import {
  filterActions,
  isPaletteShortcut,
  moveSelection,
  nextScope,
  paletteActions,
  paletteScopeList,
  type PaletteEntry,
  type PaletteScopeId,
} from '../../lib/ux/palette';
import { placeHref } from '../../lib/ux/team-map';
import {
  readServerTeamContext,
  readTeamContext,
  subscribeTeamContext,
} from '../../lib/ux/team-context';

type Found = {
  missions: { id: string; label: string; detail: string }[];
  companies: { id: string; label: string; detail: string }[];
  denied: string[];
  partial: string[];
};
type State = 'idle' | 'searching' | 'done' | 'failed';

export function TeamPalette({ urls, ownerPage }: { urls: boolean; ownerPage: boolean }) {
  const { tenant, role } = useSyncExternalStore(
    subscribeTeamContext,
    readTeamContext,
    readServerTeamContext,
  );
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [scope, setScope] = useState<PaletteScopeId>('all');
  const [found, setFound] = useState<Found | null>(null);
  const [state, setState] = useState<State>('idle');
  const [selected, setSelected] = useState(0);
  const dialog = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const listId = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const mounted = useSyncExternalStore(
    () => () => undefined,
    () => true,
    () => false,
  );

  // Ctrl K (Command K on a Mac) opens it from anywhere in the team shell.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onKey = (event: KeyboardEvent) => {
      if (!isPaletteShortcut(event)) return;
      event.preventDefault();
      opener.current =
        document.activeElement instanceof HTMLElement ? document.activeElement : null;
      setOpen(true);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) element.showModal();
    if (!open && element.open) element.close();
  }, [open, mounted]);

  // One search at a time: a newer query cancels the older, and an answer for an old query is dropped.
  useEffect(() => {
    if (!open) return;
    const text = query.trim();
    const searchable = scope !== 'actions' && text.length >= 2 && /^[0-9a-f-]{36}$/i.test(tenant);
    if (!searchable) {
      setFound(null);
      setState('idle');
      return;
    }
    const controller = new AbortController();
    setState('searching');
    const timer = setTimeout(async () => {
      try {
        const response = await fetch(
          '/api/workspace/search?' + new URLSearchParams({ tenant, q: text, scope }),
          { signal: controller.signal, cache: 'no-store' },
        );
        if (!response.ok) throw new Error('search failed');
        setFound((await response.json()) as Found);
        setState('done');
      } catch (error) {
        if ((error as { name?: string }).name === 'AbortError') return;
        setFound(null);
        setState('failed');
      }
    }, 200);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [open, query, scope, tenant]);

  const actions = paletteActions(role, urls, tenant, ownerPage);
  const entries: PaletteEntry[] = [];
  if (scope === 'all' || scope === 'missions')
    for (const hit of found?.missions ?? [])
      entries.push({
        key: 'mission:' + hit.id,
        group: 'Missions',
        label: hit.label,
        detail: hit.detail,
        href: missionPath(hit.id, tenant),
      });
  if (scope === 'all' || scope === 'companies')
    for (const hit of found?.companies ?? [])
      entries.push({
        key: 'company:' + hit.id,
        group: 'Companies',
        label: hit.label,
        detail: hit.detail ? hit.detail + ' · Opens Companies' : 'Opens Companies',
        href: placeHref('workspace-research', urls, tenant),
      });
  if (scope === 'all' || scope === 'actions')
    entries.push(...filterActions(actions, query).slice(0, scope === 'actions' ? 20 : 4));
  const active = Math.min(selected, entries.length - 1);

  function close() {
    setOpen(false);
    setQuery('');
    setScope('all');
    setFound(null);
    setState('idle');
    setSelected(0);
    const back = opener.current;
    if (back?.isConnected) back.focus();
    opener.current = null;
  }
  function go(entry: PaletteEntry | undefined) {
    if (!entry) return;
    // A full page load: the workspace reads the address once, so a soft change could show the old section.
    window.location.assign(entry.href);
  }
  function onKeyDown(event: React.KeyboardEvent) {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      setSelected(moveSelection(active, event.key, entries.length));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      go(entries[active]);
    } else if (event.key === 'Tab' && !(event.target as HTMLElement).closest('footer')) {
      event.preventDefault();
      setScope(nextScope(scope, event.shiftKey));
      setSelected(0);
    }
  }
  const groups = (['Missions', 'Companies', 'Actions'] as const).filter((name) =>
    entries.some((entry) => entry.group === name),
  );
  let message = '';
  if (state === 'searching') message = 'Searching';
  else if (state === 'failed') message = 'The search could not be completed. Try again.';
  else if (found?.denied.length)
    message = 'Your role may not search ' + found.denied.join(' or ') + '.';
  else if (query.trim().length >= 2 && state === 'done' && entries.length === 0)
    message = 'Nothing found.';
  else if (entries.length > 0)
    message = entries.length + (entries.length === 1 ? ' result' : ' results');
  const partial = found?.partial.length
    ? 'Matches are searched in the first page of ' + found.partial.join(' and ') + '.'
    : '';

  return (
    <>
      <button
        type="button"
        className="ux-palette-trigger"
        aria-haspopup="dialog"
        aria-keyshortcuts="Control+K Meta+K"
        title="Search"
        onClick={(event) => {
          opener.current = event.currentTarget;
          setOpen(true);
        }}
      >
        <OperatorIcon name="search" />
        <span>Search</span>
        <kbd>Ctrl K</kbd>
      </button>
      {mounted
        ? createPortal(
            <dialog
              ref={dialog}
              className="ux-palette"
              aria-label="Search missions, companies and actions"
              onClose={close}
              onKeyDown={onKeyDown}
              onClick={(event) => {
                if (event.target === event.currentTarget) setOpen(false);
              }}
            >
              <div className="ux-palette-body">
                <div className="ux-palette-input">
                  <OperatorIcon name="search" />
                  <input
                    type="search"
                    role="combobox"
                    aria-expanded="true"
                    aria-controls={listId}
                    aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined}
                    aria-label="Search missions, companies and actions"
                    placeholder="Search missions, companies and actions"
                    value={query}
                    autoComplete="off"
                    spellCheck={false}
                    maxLength={80}
                    onChange={(event) => {
                      setQuery(event.target.value);
                      setSelected(0);
                    }}
                    autoFocus
                  />
                  <kbd>Esc</kbd>
                </div>
                <div className="ux-palette-scopes" role="group" aria-label="Search in">
                  {paletteScopeList.map((entry) => (
                    <button
                      key={entry.id}
                      type="button"
                      tabIndex={-1}
                      aria-pressed={scope === entry.id}
                      onClick={() => {
                        setScope(entry.id);
                        setSelected(0);
                      }}
                    >
                      {entry.label}
                    </button>
                  ))}
                </div>
                <div id={listId} role="listbox" aria-label="Results" className="ux-palette-list">
                  {groups.map((name) => (
                    <div key={name} role="group" aria-label={name}>
                      <p className="ux-palette-group" aria-hidden="true">
                        {name}
                      </p>
                      {entries.map((entry, index) =>
                        entry.group === name ? (
                          <a
                            key={entry.key}
                            id={`${listId}-${index}`}
                            role="option"
                            aria-selected={index === active}
                            href={entry.href}
                            tabIndex={-1}
                            onMouseMove={() => setSelected(index)}
                          >
                            <strong>{entry.label}</strong>
                            {entry.detail ? <span>{entry.detail}</span> : null}
                          </a>
                        ) : null,
                      )}
                    </div>
                  ))}
                </div>
                <p className="ux-palette-status" role="status" aria-live="polite">
                  {message} {partial}
                </p>
                <footer>
                  <span>
                    <kbd>Up</kbd> <kbd>Down</kbd> Move · <kbd>Enter</kbd> Open · <kbd>Tab</kbd>{' '}
                    Change scope
                  </span>
                  <span>Searches only what your role may open</span>
                </footer>
              </div>
            </dialog>,
            document.body,
          )
        : null}
    </>
  );
}
