import { workspaceSections } from '../lib/workspace-navigation';
import { missionSections, toolAreas } from './role-navigation';

const areas = [
  { key: 'work', label: 'Mission work', ids: [...missionSections] as string[] },
  { key: 'evidence', label: 'Evidence', ids: [...toolAreas[0].ids] as string[] },
  { key: 'assist', label: 'Assistance', ids: [...toolAreas[1].ids] as string[] },
  { key: 'operations', label: 'Operations', ids: [...toolAreas[2].ids] as string[] },
  { key: 'settings', label: 'Settings and access', ids: [...toolAreas[3].ids] as string[] },
];

/** The panel that owns a fragment: the four ops-* anchors live inside the operations panel. */
export function panelFor(fragment: string): string {
  return fragment.startsWith('ops-') ? 'workspace-operations' : fragment;
}

/** Navigation convenience only. Every link still resolves through the closed section list. */
export function WorkspaceAreaBar({ role, fragment }: { role: string; fragment: string }) {
  const available = new Set(
    workspaceSections
      .filter((section) => (section.roles as readonly string[]).includes(role))
      .map((section) => section.id as string),
  );
  const current = panelFor(fragment);
  const visible = areas
    .map((area) => ({ ...area, ids: area.ids.filter((id) => available.has(id)) }))
    .filter((area) => area.ids.length > 0);
  const active = visible.find((area) => area.ids.includes(fragment) || area.ids.includes(current));
  const label = (id: string) => workspaceSections.find((section) => section.id === id)!.label;
  return (
    <div className="ux-area-bar">
      <nav aria-label="Workspace areas">
        <a className="ux-area-home" href="#workspace-navigation">
          Overview
        </a>
        {visible.map((area) => (
          <a
            key={area.key}
            href={'#' + area.ids[0]}
            aria-current={area === active ? 'true' : undefined}
          >
            {area.label}
          </a>
        ))}
      </nav>
      {active && active.ids.length > 1 && (
        <nav aria-label={active.label + ' sections'} className="ux-area-sections">
          {active.ids.map((id) => (
            <a
              key={id}
              href={'#' + id}
              aria-current={
                id === fragment || (id === current && !fragment.startsWith('ops-'))
                  ? 'location'
                  : undefined
              }
            >
              {label(id)}
            </a>
          ))}
        </nav>
      )}
    </div>
  );
}
