import { OperatorIcon } from '../../components/operator-icon';

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
  return (
    <header className="ux-panel-heading">
      <span className="ux-panel-heading-icon">
        <OperatorIcon name={icon} />
      </span>
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h2>{title}</h2>
        <p>{description}</p>
      </div>
    </header>
  );
}
