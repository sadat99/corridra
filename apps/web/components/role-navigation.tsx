import { workspaceSections } from '../lib/workspace-navigation';
const missionSections = new Set([
  'workspace-missions',
  'workspace-research',
  'workspace-meetings',
  'workspace-commercial',
  'workspace-delivery',
]);

/** Convenience navigation, never an authorization boundary. Panels stay mounted. */
export function RoleNavigation({ role, shortcuts = false }: { role: string; shortcuts?: boolean }) {
  const available = workspaceSections.filter((section) =>
    (section.roles as readonly string[]).includes(role),
  );
  const workflow = available.filter((section) => missionSections.has(section.id));
  const tools = available.filter((section) => !missionSections.has(section.id));
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
            <p className="label">MISSION WORK</p>
            {links(workflow)}
            <p className="label">EVIDENCE, ASSISTANCE AND ADMINISTRATION</p>
            {links(tools)}
          </div>
        </details>
      )}
    </nav>
  );
}
