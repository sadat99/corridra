'use client';
// Team desk v4.1: the Supply pages carry the same workspace picker at the top of the menu as every other team page.
// The menu draws the control; this hands it the workspaces the person belongs to and how to change between them.
// A page of one mission or one candidate belongs to its workspace, so choosing another opens that workspace's
// Supply page; the Supply page and Do Not Contact stay where they are. Convenience only: the server reads the
// workspace and the role again on every page and every request.
import { useEffect } from 'react';
import { supplyBase, withWorkspace } from '../../../lib/supply-screens';
import { publishTeamSwitcher } from '../../../lib/ux/team-desk-v41';

export function SupplySwitcher({
  workspaces,
  current,
}: {
  workspaces: readonly { id: string; name: string }[];
  current: string;
}) {
  useEffect(() => {
    publishTeamSwitcher({
      workspaces,
      current,
      busy: false,
      choose: (id) => {
        if (id === current) return;
        const here = window.location.pathname.replace(/\/$/, '');
        const stays = here === supplyBase || here === `${supplyBase}/do-not-contact`;
        window.location.assign(withWorkspace(stays ? here : supplyBase, id));
      },
    });
    return () => publishTeamSwitcher(null);
  }, [workspaces, current]);
  return null;
}
