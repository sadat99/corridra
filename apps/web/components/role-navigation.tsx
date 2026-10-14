import { workspaceSections } from '../lib/workspace-navigation';

/** Convenience navigation, never an authorization boundary. Panels stay mounted. */
export function RoleNavigation({ role, shortcuts = false }: { role: string; shortcuts?: boolean }) {
  return (
    <nav
      className={
        shortcuts ? 'workspace-navigation ux-tool-index' : 'workspace-navigation ux-role-navigation'
      }
      id={shortcuts ? undefined : 'workspace-navigation'}
      tabIndex={shortcuts ? undefined : -1}
      aria-label={shortcuts ? 'V2 tool shortcuts' : 'Workspace sections'}
    >
      {workspaceSections
        .filter((section) => (section.roles as readonly string[]).includes(role))
        .map((section) => (
          <a key={section.id} href={'#' + section.id}>
            {section.label}
            {shortcuts && <span className="tool-part">{section.part}</span>}
          </a>
        ))}
    </nav>
  );
}
