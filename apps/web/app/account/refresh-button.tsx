import { CorridraIcon } from '../../components/corridra-icon';

/** One quiet Refresh button for every list. The full name goes to assistive technology. */
export function RefreshButton({
  label,
  busy = false,
  disabled = false,
  onClick,
}: {
  /** What is refreshed, for example "workspaces". */
  label: string;
  busy?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="ux-refresh"
      aria-label={'Refresh ' + label}
      disabled={disabled || busy}
      onClick={onClick}
    >
      <CorridraIcon name="refresh" />
      {busy ? 'Loading…' : 'Refresh'}
    </button>
  );
}
