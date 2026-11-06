'use client';
// The customer sidebar's top and foot (navigation v1, CustomerDesktop board). The top is the one primary action,
// New Request. The foot says Help on WhatsApp is Coming soon: there is no owner-configured number yet, so it is
// plain text with a tag and not a link. The workspace choice, the person and Help moved to the header menus
// (utility-menus.tsx). It reads only the person's workspaces; nothing here decides access, and every page and
// action still checks on the server.
import './customer-rail.css';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { CorridraIcon } from '../corridra-icon';
import { newRequestHref } from '../../lib/ux/customer-navigation';
import { useWorkspaces } from './customer-bar';

/** New Request: a person with a workspace goes to where requests are made, otherwise to the plan page. */
export function NewRequestLink({ className = 'ux-rail-new' }: { className?: string }) {
  const pathname = usePathname() ?? '';
  const workspaces = useWorkspaces(pathname.startsWith('/account'));
  return (
    <Link
      prefetch={false}
      className={className}
      href={newRequestHref(!!workspaces && workspaces.length > 0)}
    >
      <CorridraIcon name="draft" className="ux-rail-new-icon" />
      <span>New Request</span>
    </Link>
  );
}

export function CustomerRailTop() {
  return <NewRequestLink />;
}

export function CustomerRailFoot() {
  return (
    <div className="ux-rail-foot">
      <p className="ux-rail-soon">
        <CorridraIcon name="help" />
        <span>Help on WhatsApp</span>
        <span className="ux-soon-tag">Coming soon</span>
      </p>
    </div>
  );
}
