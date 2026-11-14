'use client';
// The rare action of one series row (UI/UX.v3 action hierarchy): Retire, or Restore once retired, sits in a "More
// actions" menu one tap deeper. Retiring asks to confirm first; restoring changes nothing that cannot be undone, so it
// does not. The series name is in every accessible name and not repeated in the visible words of the menu. Edit and the
// repeat revenue switch stay where they were, in the row of actions this component sits in.
import { useState } from 'react';
import { MenuButton, OverflowMenu } from '../../../components/ux/overflow-menu';
import { CorridraIcon } from '../../../components/corridra-icon';

export function SeriesRowActions({
  name,
  retired,
  busy,
  onToggleRetired,
}: {
  name: string;
  retired: boolean;
  busy: boolean;
  onToggleRetired: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  return (
    <>
      <OverflowMenu
        label={'More actions for ' + name}
        trigger={<CorridraIcon name="more" />}
        className="ux-series-more"
        align="start"
      >
        {retired ? (
          <MenuButton
            data-menu-close=""
            disabled={busy}
            aria-label={'Restore Series ' + name}
            onClick={onToggleRetired}
          >
            Restore Series
          </MenuButton>
        ) : (
          <MenuButton
            data-menu-close=""
            disabled={busy}
            aria-label={'Retire Series ' + name}
            onClick={() => setConfirming(true)}
          >
            Retire Series
          </MenuButton>
        )}
      </OverflowMenu>
      {confirming && !retired && (
        <span role="group" aria-label={'Confirm retiring ' + name} className="ux-series-confirm">
          <span>Retire this series? You can restore it later.</span>
          <button
            type="button"
            className="primary-link"
            disabled={busy}
            onClick={() => {
              setConfirming(false);
              onToggleRetired();
            }}
          >
            Retire {name}
          </button>
          <button type="button" className="text-link" onClick={() => setConfirming(false)}>
            Keep {name}
          </button>
        </span>
      )}
    </>
  );
}
