import Link from 'next/link';
import { accessElsewhereWords, otherAccessDoors, type AccessDoorId } from '../lib/access-doors';

/** The "Not what you need?" bar at the end of each access page: a link to each of the other two doors. */
export function AccessElsewhere({ current }: { current: AccessDoorId }) {
  return (
    <nav className="access-elsewhere" aria-label={accessElsewhereWords.heading}>
      <h2>{accessElsewhereWords.heading}</h2>
      {otherAccessDoors(current).map((door) => (
        <Link key={door.id} prefetch={false} className="text-link" href={door.href}>
          {door.title}
        </Link>
      ))}
    </nav>
  );
}
