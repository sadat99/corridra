// The page frame for signed-in account pages (UI/UX.v3, consistency pass). One order on every page:
// back link, status chips, the page title, one 14 px helper line, at most one primary action, then the tabs.
// CustomerShell takes a `frame` prop and places the pieces around its one h1 through `pageFrameSlots`; a page
// supplies only words and links. Plain anchors and no Next.js import, so the fixture bundles can render it.
import './page-frame.css';
import type { ReactNode } from 'react';
import type { ChipTone } from '../../lib/ux/customer-road';
import { StatusChip } from './status-chip';

export type PageFrameProps = {
  /** The parent page, shown above the title. A full page load, like the links it replaces. */
  back?: { label: string; href: string };
  /** Status words above the title. The words carry the meaning; the tone only supports them. */
  chips?: { label: string; tone: ChipTone }[];
  /** One short line under the title. Plain words; a link may sit inside it. */
  helper?: ReactNode;
  /** The one primary action of the view (cobalt). Never more than one. */
  primary?: ReactNode;
  /** Tabs for the page's sections, drawn under the title. */
  tabs?: ReactNode;
};

/** Back link and status chips: the header content that sits above the h1. */
export function PageFrameAbove({ back, chips }: Pick<PageFrameProps, 'back' | 'chips'>) {
  if (!back && !chips?.length) return null;
  return (
    <div className="ux-frame-above">
      {back ? (
        <a className="text-link ux-back" href={back.href}>
          {back.label}
        </a>
      ) : null}
      {chips?.length ? (
        <ul className="ux-frame-chips" aria-label="Status">
          {chips.map((chip) => (
            <li key={chip.label}>
              <StatusChip status={chip} />
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/** The helper line and the one primary action: the header content that sits under the h1. */
export function PageFrameLead({ helper, primary }: Pick<PageFrameProps, 'helper' | 'primary'>) {
  if (!helper && !primary) return null;
  return (
    <div className="ux-frame-lead">
      {helper ? <p className="ux-frame-helper">{helper}</p> : null}
      {primary ? <div className="ux-frame-primary">{primary}</div> : null}
    </div>
  );
}

/** The three places a shell puts the frame: above the h1, under it, and the tab row. */
export function pageFrameSlots(frame: PageFrameProps | undefined): {
  above: ReactNode;
  lead: ReactNode;
  tabs: ReactNode;
} {
  if (!frame) return { above: null, lead: null, tabs: null };
  return {
    above: <PageFrameAbove back={frame.back} chips={frame.chips} />,
    lead: <PageFrameLead helper={frame.helper} primary={frame.primary} />,
    tabs: frame.tabs ?? null,
  };
}
