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

/**
 * The single line on the customer door and the customer sign-in, in place of the bar (owner board, screen 03, and the
 * owner's 18 November "unsolicited redundancy"): "Not a customer?" and a link to each of the other two doors. The links
 * sit inside a paragraph, so they keep the quiet inline look.
 */
export function AccessNotCustomer({ current = 'customer' }: { current?: AccessDoorId }) {
  const doors = otherAccessDoors(current);
  return (
    <nav className="access-not-customer" aria-label={accessElsewhereWords.notCustomer}>
      <p>
        <span>{accessElsewhereWords.notCustomer}</span>
        {doors.map((door, index) => (
          <span key={door.id} className="access-not-customer-item">
            {index > 0 && <span aria-hidden="true">·</span>}
            <Link prefetch={false} className="text-link" href={door.href}>
              {door.title}
            </Link>
          </span>
        ))}
      </p>
    </nav>
  );
}
