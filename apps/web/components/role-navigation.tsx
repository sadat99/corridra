import { OperatorIcon } from './operator-icon';
import { workspaceSections } from '../lib/workspace-navigation';
const sectionIcons: Record<string, string> = {
  'workspace-missions': 'mission',
  'workspace-research': 'company',
  'workspace-meetings': 'people',
  'workspace-commercial': 'progress',
  'workspace-delivery': 'document',
  'workspace-sources': 'document',
  'workspace-evidence': 'search',
  'workspace-ai': 'spark',
  'workspace-network': 'network',
  'workspace-operations': 'globe',
  'ops-dashboard': 'progress',
  'ops-center': 'settings',
  'ops-health': 'shield',
  'ops-gates': 'shield',
  'workspace-settings': 'shield',
  'workspace-audit': 'people',
  'workspace-authenticator': 'lock',
  'workspace-controls': 'people',
};
const descriptions: Record<string, string> = {
  'workspace-missions': 'Create and manage missions from intake to delivery.',
  'workspace-research': 'Find, assess and track companies.',
  'workspace-meetings': 'Arrange and track conversations.',
  'workspace-commercial': 'Track progress and outcomes.',
  'workspace-delivery': 'Prepare and deliver approved views.',
};
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
      <a
        key={section.id}
        href={'#' + section.id}
        aria-label={section.label}
        aria-describedby={shortcuts ? `operator-hint-${section.id}` : undefined}
      >
        <OperatorIcon name={sectionIcons[section.id]} />
        <span className="operator-nav-copy">
          <span>{section.label}</span>
          {shortcuts && (
            <small id={`operator-hint-${section.id}`}>{descriptions[section.id]}</small>
          )}
        </span>
        <OperatorIcon
          name={shortcuts && section.id === 'workspace-missions' ? 'arrow' : 'chevron'}
          className="operator-nav-arrow"
        />
        {shortcuts && section.id === 'workspace-missions' && (
          <span className="operator-primary-label" aria-hidden="true">
            Primary destination
          </span>
        )}
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
          <summary>
            <OperatorIcon name="grid" />
            <span>All workspace tools and settings</span>
            <OperatorIcon name="chevron" className="operator-disclosure-arrow" />
          </summary>
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
