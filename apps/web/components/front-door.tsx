import Link from 'next/link';
import { CorridraIcon } from './corridra-icon';
import './front-door.css';
import type { DoorItem } from '../lib/front-doors';

/**
 * A short list of cards, each one a link to a page that already exists. One card may be the primary
 * way in; it is drawn as the filled action and the rest are quiet. A card is a whole link, 44 px or
 * more tall, and the list is a navigation landmark with a name. UI/UX.v4.1 L2: a door that names an icon draws
 * it in a soft square before its words; a door without one is the markup it always was.
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
              data-icon={item.icon ? 'true' : undefined}
              href={item.href}
              prefetch={false}
            >
              {item.icon ? (
                <span className="front-door-tile" aria-hidden="true">
                  <CorridraIcon name={item.icon} size={20} />
                </span>
              ) : null}
              <b>{item.title}</b>
              <span>{item.line}</span>
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
