import Link from 'next/link';

export type AccessOptionLink = { href: string; text: string; plainAnchor?: boolean };

/**
 * The short list of "other ways in" links under a sign-in or setup page. It is the markup those pages
 * always had: a labelled nav, an optional sentence, then text links (a plain anchor where the page used one).
 */
export function AccessOptions({
  label,
  intro,
  links,
  className = 'access-options',
}: {
  label: string;
  intro?: string;
  /** The text of each link is its key and is unique in a list, so a link whose address changes keeps its element (and its focus). */
  links: readonly AccessOptionLink[];
  className?: string;
}) {
  return (
    <nav className={className} aria-label={label}>
      {intro && <p>{intro}</p>}
      {links.map((link) =>
        link.plainAnchor ? (
          <a key={link.text} className="text-link" href={link.href}>
            {link.text}
          </a>
        ) : (
          <Link key={link.text} prefetch={false} className="text-link" href={link.href}>
            {link.text}
          </Link>
        ),
      )}
    </nav>
  );
}
