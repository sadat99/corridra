import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  customerGroupHere,
  customerGroupLinks,
  customerJourneyLinks,
  customerNavigation,
} from '../../apps/web/lib/ux/customer-navigation';
import { journeys as moveJourneys } from '../../apps/web/app/account/move/journeys';

// The customer sidebar, owner-approved mockups revision 2 (12 Nov 2026): below the five destinations, Your Journeys
// (the Move page filtered by ?journey=) and Groups (Programmes and Registrations), which were reachable only from
// links inside pages. Each appears only under the switch or gate its page and its account-page link already use; a
// group with no visible item is not drawn; nothing above them changes.
const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');

describe('the customer sidebar groups', () => {
  it('Your Journeys is Sourcing (the lead), Organising, Selling, each the Move page filtered to a real journey value', () => {
    const links = customerJourneyLinks(true);
    expect(links.map((link) => link.label)).toEqual(['Sourcing', 'Organising', 'Selling']);
    expect(links.map((link) => link.href)).toEqual([
      '/account/move?journey=source',
      '/account/move?journey=organise',
      '/account/move?journey=sell',
    ]);
    expect(links.filter((link) => link.lead).map((link) => link.label)).toEqual(['Sourcing']);
    // Every value is one the Move page accepts as a filter (anything else would silently show everything).
    for (const link of links)
      expect(moveJourneys as readonly string[]).toContain(
        new URL(link.href, 'https://x').searchParams.get('journey'),
      );
  });

  it('without the Move page (CORRIDRA_UX_MOVE off) there are no journey links, so the group is not drawn', () => {
    expect(customerJourneyLinks(false)).toEqual([]);
  });

  it('Groups follows the account page gates: Programmes and Registrations each only where their module is on', () => {
    expect(customerGroupLinks({ programmes: true, registrations: true })).toEqual([
      expect.objectContaining({ label: 'Programmes', href: '/account/delegations/organise' }),
      expect.objectContaining({ label: 'Registrations', href: '/account/delegations' }),
    ]);
    expect(
      customerGroupLinks({ programmes: false, registrations: true }).map((l) => l.label),
    ).toEqual(['Registrations']);
    expect(
      customerGroupLinks({ programmes: true, registrations: false }).map((l) => l.label),
    ).toEqual(['Programmes']);
    expect(customerGroupLinks({ programmes: false, registrations: false })).toEqual([]);
  });

  it('the shell reads the same gates as the account page links', () => {
    const shell = read('apps/web/components/customer-shell.tsx');
    const account = read('apps/web/app/account/page.tsx');
    for (const gate of [
      'customerProgrammesEnabled()',
      'customerParticipantsEnabled()',
      'customerWorkspacesEnabled()',
    ]) {
      expect(account).toContain(gate);
      expect(shell).toContain(gate);
    }
    expect(shell).toContain('NEON_AUTH_BASE_URL');
  });

  it('a Groups link is current only on its own page', () => {
    expect(customerGroupHere('/account/delegations/organise')).toBe('programmes');
    expect(customerGroupHere('/account/delegations')).toBe('registrations');
    expect(
      customerGroupHere('/account/delegations/0f8fad5b-d9cb-469f-a165-70867728950e'),
    ).toBeNull();
    expect(customerGroupHere('/account')).toBeNull();
  });

  it('the new links are reachable from the model only when their gates are on, and each group holds five at most', () => {
    const base = {
      companies: true,
      move: true,
      billing: true,
      notificationSettings: true,
      organisationProfiles: true,
      workspaces: [],
    };
    const on = customerNavigation({ ...base, programmes: true, registrations: true });
    for (const href of [
      '/account/move?journey=source',
      '/account/move?journey=organise',
      '/account/move?journey=sell',
      '/account/delegations/organise',
      '/account/delegations',
    ])
      expect(on.reachable).toContain(href);
    expect(on.journeys.length).toBeLessThanOrEqual(5);
    expect(on.groups.length).toBeLessThanOrEqual(5);
    const off = customerNavigation({ ...base, move: false });
    expect(off.journeys).toEqual([]);
    expect(off.groups).toEqual([]);
    expect(off.reachable).not.toContain('/account/delegations');
  });
});
