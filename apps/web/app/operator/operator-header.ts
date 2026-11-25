// The words of the workspace header (/operator and /operator/<section>), kept apart from the page so they are
// tested without a server and shared with the test fixture. Team desk v4.1, unit D4.
import { deskPattern, isDeskPlace, type DeskPlaceId } from '../../lib/ux/page-pattern';
import { teamSectionTitle } from '../../lib/ux/shells';

/**
 * The words of the workspace header for an address, in one place for the page and for the test fixture. With
 * the pattern off (or the team shell off) they are exactly what the header always had: the label above the
 * title, the section's own title with the shell and section addresses on, and "Your workspace." otherwise.
 * With the pattern on there is no label; `place` is set when the page gets the full pattern (title, purpose
 * line and segments), which needs section addresses so that the server knows the page.
 */
export function operatorHeaderWords(options: {
  shellsV2: boolean;
  urls: boolean;
  teamDeskV41: boolean;
  section?: string;
}): { eyebrow: string | undefined; title: string; className: string; place: DeskPlaceId | null } {
  const { shellsV2, urls, section } = options;
  const on = shellsV2 && options.teamDeskV41;
  // With the shells switch and section addresses on, each section has its own heading (CQ-36).
  const heading = shellsV2 && urls ? teamSectionTitle(section) : null;
  const asked = section ?? 'home';
  const place = on && heading && isDeskPlace(asked) ? asked : null;
  return {
    eyebrow: on ? undefined : shellsV2 ? 'TEAM WORKSPACE' : 'OPERATOR WORKSPACE',
    title: place ? deskPattern(place).title : (heading ?? 'Your workspace.'),
    // When the page heading already says Today, the Today panel keeps its heading for screen readers only.
    // The same holds for a section whose own heading says the title (ux-titled-<section id>, operator-overview.css):
    // decided here on the server, so the first paint is right and no panel reads the page.
    className:
      (heading === 'Today' ? 'ux-operator-home ux-titled-today' : 'ux-operator-home') +
      (heading && section && !place ? ` ux-titled-${section}` : '') +
      (place ? ' ux-desk-frame' : ''),
    place,
  };
}
