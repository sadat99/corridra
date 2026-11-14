'use client';
// The actions of one fee schedule row (UI/UX.v3 action hierarchy): Edit stays visible, the rare one (Retire, or Restore
// once retired) sits in a "More actions" menu. Retiring asks to confirm first; restoring changes nothing that cannot be
// undone, so it does not. The record name is in every accessible name and not repeated in the visible words of the menu.
import { useState } from 'react';
import { MenuButton, OverflowMenu } from '../../../components/ux/overflow-menu';
import { CorridraIcon } from '../../../components/corridra-icon';
import './fee-schedule-actions.css';

export function FeeScheduleActions({
  name,
  retired,
  busy,
  onEdit,
  onToggleRetired,
}: {
  name: string;
  retired: boolean;
  busy: boolean;
  onEdit: () => void;
  onToggleRetired: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  return (
    <span className="ux-fee-actions">
      <button type="button" className="text-link" disabled={busy} onClick={onEdit}>
        Edit Fee Schedule {name}
      </button>
      <OverflowMenu
        label={'More actions for ' + name}
        trigger={<CorridraIcon name="more" />}
        className="ux-fee-more"
        align="start"
      >
        {retired ? (
          <MenuButton
            data-menu-close=""
            disabled={busy}
            aria-label={'Restore Fee Schedule ' + name}
            onClick={onToggleRetired}
          >
            Restore Fee Schedule
          </MenuButton>
        ) : (
          <MenuButton
            data-menu-close=""
            disabled={busy}
            aria-label={'Retire Fee Schedule ' + name}
            onClick={() => setConfirming(true)}
          >
            Retire Fee Schedule
          </MenuButton>
        )}
      </OverflowMenu>
      {confirming && !retired && (
        <span role="group" aria-label={'Confirm retiring ' + name} className="ux-fee-confirm">
          <span>Retire this fee schedule? You can restore it later.</span>
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
    </span>
  );
}
