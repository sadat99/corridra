/**
 * CRUD G12: the one control for a paged list. It says how many rows are shown of the exact total and
 * offers the next page only when there is one. `label` names the rows, for example "Meetings".
 */
export function ShowMore({
  shown,
  total,
  next,
  busy,
  label,
  onMore,
}: {
  shown: number;
  total: number | null | undefined;
  next: string | null | undefined;
  busy: boolean;
  label: string;
  onMore: () => void;
}) {
  if (!next) return null;
  return (
    <p className="ux-show-more">
      Showing {shown} of {total ?? shown} {label.toLowerCase()}.{' '}
      <button className="text-link" type="button" disabled={busy} onClick={onMore}>
        Show More {label}
      </button>
    </p>
  );
}
