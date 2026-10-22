import { CorridraIcon } from './corridra-icon';

/** Decorative only: the adjacent words are always the control's accessible name. */
export function OperatorIcon({ name, className = '' }: { name: string; className?: string }) {
  return <CorridraIcon name={name} className={`operator-icon ${className}`.trim()} />;
}
