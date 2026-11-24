import { OperatorIcon } from '../../components/operator-icon';
import { useOperatorFlags } from './operator-flags';

export function PanelHeading({
  title,
  description,
  icon,
  eyebrow = 'Workspace tools',
}: {
  title: string;
  description: string;
  icon: string;
  eyebrow?: string;
}) {
  // Team desk v4.1: no label above a heading. Every caller is a client screen inside the workspace.
  const { deskV41 } = useOperatorFlags();
  return (
    <header className="ux-panel-heading">
      <span className="ux-panel-heading-icon">
        <OperatorIcon name={icon} />
      </span>
      <div>
        {deskV41 ? null : <p className="eyebrow">{eyebrow}</p>}
        <h2>{title}</h2>
        <p>{description}</p>
      </div>
    </header>
  );
}
