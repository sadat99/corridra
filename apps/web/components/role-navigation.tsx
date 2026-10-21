import { workspaceSections } from '../lib/workspace-navigation';
export const missionSections = new Set([
  'workspace-missions',
  'workspace-research',
  'workspace-meetings',
  'workspace-commercial',
  'workspace-delivery',
]);

// Five job areas for the full directory. Every section stays listed; this only groups them.
export const toolAreas = [
  { label: 'EVIDENCE AND SOURCES', ids: ['workspace-sources', 'workspace-evidence'] },
  { label: 'ASSISTANCE AND NETWORK', ids: ['workspace-ai', 'workspace-network'] },
  {
    label: 'OPERATIONS AND HEALTH',
    ids: ['workspace-operations', 'ops-dashboard', 'ops-center', 'ops-health', 'ops-gates'],
  },
  {
    label: 'SETTINGS AND ACCESS',
    ids: ['workspace-settings', 'workspace-audit', 'workspace-authenticator', 'workspace-controls'],
  },
] as const;

/** Convenience navigation, never an authorization boundary. Panels stay mounted. */
export function RoleNavigation({ role, shortcuts = false }: { role: string; shortcuts?: boolean }) {
  const available = workspaceSections.filter((section) =>
    (section.roles as readonly string[]).includes(role),
  );
  const workflow = available.filter((section) => missionSections.has(section.id));
  const tools = available.filter((section) => !missionSections.has(section.id));
  const known = new Set<string>(toolAreas.flatMap((area) => area.ids));
  const unplaced = tools.filter((section) => !known.has(section.id));
  function links(sections: typeof available) {
    return sections.map((section) => (
      <a key={section.id} href={'#' + section.id}>
        {section.label}
      </a>
    ));
  }
  return (
    <nav
      className={
        shortcuts ? 'workspace-navigation ux-tool-index' : 'workspace-navigation ux-role-navigation'
      }
      id={shortcuts ? undefined : 'workspace-navigation'}
      tabIndex={shortcuts ? undefined : -1}
      aria-label={shortcuts ? 'Mission workflow' : 'Workspace sections'}
    >
      {shortcuts ? (
        links(workflow)
      ) : (
        <details className="ux-workspace-directory">
          <summary>All workspace tools and settings</summary>
          <div>
            <div>
              <p className="label">MISSION WORK</p>
              {links(workflow)}
            </div>
            {toolAreas.map((area) => {
              const inArea = tools.filter((section) =>
                (area.ids as readonly string[]).includes(section.id),
              );
              return inArea.length ? (
                <div key={area.label}>
                  <p className="label">{area.label}</p>
                  {links(inArea)}
                </div>
              ) : null;
            })}
            {unplaced.length > 0 && (
              <div>
                <p className="label">OTHER TOOLS</p>
                {links(unplaced)}
              </div>
            )}
          </div>
        </details>
      )}
    </nav>
  );
}
