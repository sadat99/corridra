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
  links: readonly AccessOptionLink[];
  className?: string;
}) {
  return (
    <nav className={className} aria-label={label}>
      {intro && <p>{intro}</p>}
      {links.map((link) =>
        link.plainAnchor ? (
          <a key={link.href + link.text} className="text-link" href={link.href}>
            {link.text}
          </a>
        ) : (
          <Link key={link.href + link.text} prefetch={false} className="text-link" href={link.href}>
            {link.text}
          </Link>
        ),
      )}
    </nav>
  );
}
