import Link from 'next/link';
import './front-door.css';
import type { DoorItem } from '../lib/front-doors';

/**
 * A short list of cards, each one a link to a page that already exists. One card may be the primary
 * way in; it is drawn as the filled action and the rest are quiet. A card is a whole link, 44 px or
 * more tall, and the list is a navigation landmark with a name.
 */
export function FrontDoor({ label, items }: { label: string; items: readonly DoorItem[] }) {
  return (
    <nav className="front-door" aria-label={label}>
      <ul>
        {items.map((item) => (
          <li key={item.id}>
            <Link
              className="front-door-card"
              data-primary={item.primary ? 'true' : undefined}
              href={item.href}
              prefetch={false}
            >
              <b>{item.title}</b>
              <span>{item.line}</span>
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
