'use client';
import type { Ref } from 'react';
import { CorridraIcon } from '../../components/corridra-icon';
import { MenuButton, OverflowMenu } from '../../components/ux/overflow-menu';
import { moreWords } from '../../lib/route-pack-editor-words';

// ADR-093 Phase 3, PR 2c: the More menu of the route header (spec 8.1). It draws the rows it is given and reports a choice; the
// page decides which rows exist (owner only, section view, staged changes) and what each one does. With no row the whole menu is
// absent, never disabled. When Discard Changes is the only row it carries data-only-discard, so the stylesheet can hide the menu
// from 40rem, where the unsaved bar already has the same button.

export type MoreMenuProps = {
  /** The route's name, for the accessible name "More actions for {route name}". */
  routeName: string;
  /** The section the view is on, for the names "Mark Section Not Applicable, {section name}". */
  sectionName?: string;
  /** Present on a section view. */
  onAddCustom?: () => void;
  /** Present on a section view that is not marked. */
  onMark?: () => void;
  /** Present on a section view that is marked. */
  onUnmark?: () => void;
  /** Present while anything is staged. */
  onDiscard?: () => void;
  /** The wrapper, so the page can find the More button again (`moreButtonOf`) for returnFocusTo. */
  wrapperRef?: Ref<HTMLDivElement>;
};

/** The More button inside the wrapper: where a dialog opened from a row returns focus, the row itself being gone. */
export const moreButtonOf = (wrapper: HTMLElement | null) =>
  wrapper?.querySelector<HTMLElement>('.ux-menu-button') ?? null;

export function RouteMoreMenu({
  routeName,
  sectionName = '',
  onAddCustom,
  onMark,
  onUnmark,
  onDiscard,
  wrapperRef,
}: MoreMenuProps) {
  const mark = onMark ?? null;
  const unmark = onUnmark ?? null;
  const count = [onAddCustom, mark, unmark, onDiscard].filter(Boolean).length;
  if (count === 0) return null;
  const onlyDiscard = count === 1 && !!onDiscard;
  return (
    <div className="route-more" data-only-discard={onlyDiscard ? '' : undefined} ref={wrapperRef}>
      <OverflowMenu
        label={moreWords.buttonLabel(routeName)}
        align="end"
        trigger={
          <>
            <CorridraIcon name="more" />
            <span>{moreWords.button}</span>
          </>
        }
      >
        {onAddCustom ? (
          <MenuButton data-menu-close onClick={onAddCustom}>
            {moreWords.addCustom}
          </MenuButton>
        ) : null}
        {mark ? (
          <MenuButton
            data-menu-close
            aria-label={sectionName ? moreWords.markName(sectionName) : undefined}
            onClick={mark}
          >
            {moreWords.mark}
          </MenuButton>
        ) : null}
        {unmark ? (
          <MenuButton
            data-menu-close
            aria-label={sectionName ? moreWords.unmarkName(sectionName) : undefined}
            onClick={unmark}
          >
            {moreWords.unmark}
          </MenuButton>
        ) : null}
        {onDiscard ? (
          <MenuButton data-menu-close onClick={onDiscard}>
            {moreWords.discard}
          </MenuButton>
        ) : null}
      </OverflowMenu>
    </div>
  );
}
