import { CorridraIcon } from '../../components/corridra-icon';
import './refresh-button.css';

/** One quiet Refresh button for every list. The full name goes to assistive technology. */
export function RefreshButton({
  label,
  busy = false,
  disabled = false,
  onClick,
  iconOnly = false,
}: {
  /** What is refreshed, for example "workspaces". */
  label: string;
  busy?: boolean;
  disabled?: boolean;
  onClick: () => void;
  /** Draw only the icon (the accessible name stays "Refresh ..."), for a header where Refresh is not an action to lead with. */
  iconOnly?: boolean;
}) {
  return (
    <button
      type="button"
      className={iconOnly ? 'ux-refresh ux-refresh-icon' : 'ux-refresh'}
      aria-label={'Refresh ' + label}
      disabled={disabled || busy}
      onClick={onClick}
    >
      <CorridraIcon name="refresh" />
      {iconOnly ? null : busy ? 'Loading…' : 'Refresh'}
    </button>
  );
}
