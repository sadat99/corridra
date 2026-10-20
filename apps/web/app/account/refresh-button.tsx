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
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M20 12a8 8 0 1 1-2.3-5.6M20 4v5h-5" />
      </svg>
      {busy ? 'Loading…' : 'Refresh'}
    </button>
  );
}
