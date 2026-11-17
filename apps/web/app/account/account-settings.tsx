import type { ReactNode } from 'react';
import { SubTabs, type SubTab } from '../../components/ux/sub-tabs';
import './account-settings.css';

/**
 * The tab ids and the old names that still land. ?tab=notifications opens Preferences; ?tab=billing and ?tab=team
 * open Workspaces; #account-closure opens Privacy through the panel's anchor. Navigation only.
 */
export const accountTabKeys = [
  { id: 'profile' },
  { id: 'security' },
  { id: 'privacy' },
  { id: 'preferences', aliases: ['notifications'] },
  { id: 'workspaces', aliases: ['billing', 'team'] },
] as const;

/**
 * The Account page as a settings layout on the shared sub-tabs, in five groups: Profile, Security, Privacy,
 * Preferences and Workspaces. The tab is kept in ?tab=. A group appears only when its area is on, and a single one
 * is shown without a tab list. Nothing is removed and no access is added.
 */
export function AccountSettings({
  profile,
  security,
  privacy,
  preferences,
  workspaces,
}: {
  profile?: ReactNode;
  security?: ReactNode;
  privacy?: ReactNode;
  preferences?: ReactNode;
  workspaces?: ReactNode;
}) {
  const tabs: SubTab[] = [];
  const add = (id: string, label: string, panel: ReactNode, anchor?: string) => {
    const key = accountTabKeys.find((tab) => tab.id === id);
    if (!panel || !key) return;
    const aliases = 'aliases' in key ? key.aliases : undefined;
    tabs.push({ id, label, panel, aliases, anchor });
  };
  add('profile', 'Profile', profile);
  add('security', 'Security', security);
  add('privacy', 'Privacy', privacy, 'account-closure');
  add('preferences', 'Preferences', preferences);
  add('workspaces', 'Workspaces', workspaces);
  if (tabs.length === 0) return null;
  if (tabs.length === 1) return <div className="ux-account-tabs">{tabs[0]!.panel}</div>;
  return (
    <SubTabs
      tabs={tabs}
      label="Account sections"
      className="ux-account-tabs ux-subtabs-segmented"
    />
  );
}
