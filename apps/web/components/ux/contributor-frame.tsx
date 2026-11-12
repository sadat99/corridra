'use client';
// The contributor shell frame: the shared left navigation with two items, Your tasks and How
// assigned work works. Sign-out stays where it is on the page. Navigation only: the page and the
// server still decide who sees what. Owner: WS-E.
import './shells.css';
import './contributor-frame.css';
import { usePathname, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, type ReactNode } from 'react';
import { useLanguage } from '../language-provider';
import { localeMeta } from '../../lib/i18n/locales';
import { contributorTasksHref } from '../../lib/ux/contributor-nav';
import {
  currentFieldTab,
  fieldTabs,
  fieldTabsShown,
  fieldWorkspace,
} from '../../lib/ux/field-helper';
import { FieldTabs } from './field-tabs';
import { LeftNavFrame, LeftNavList } from './left-nav';
import { setLeftNavOpen } from './left-nav-store';
import { useMarkedWord } from './marked-word';

function ContributorList({ tasksHref }: { tasksHref: string }) {
  const { t } = useLanguage();
  const word = useMarkedWord();
  return (
    <LeftNavList
      id="contributor-navigation"
      label={t('wse.contributor.nav')}
      current="tasks"
      items={[
        { key: 'tasks', label: t('wse.shell.contributor'), href: tasksHref, icon: 'home' },
        { key: 'how', label: word('wse.contributor.how'), href: '/network', icon: 'chevron' },
      ]}
    />
  );
}

function ContributorNav() {
  return <ContributorList tasksHref={contributorTasksHref(useSearchParams().get('workspace'))} />;
}

/**
 * Phone and tablet: for a helper who opened the task page with a workspace link, four labelled bottom tabs replace the
 * drawer (Today, Tasks, Messages, Me). Wide screens keep the left bar; the invitation steps keep the drawer.
 */
function FieldTabBar() {
  const pathname = usePathname() ?? '';
  const params = useSearchParams();
  const workspace = fieldWorkspace(params.get('workspace'));
  if (!workspace || !fieldTabsShown(pathname)) return null;
  return (
    <FieldTabs
      tabs={fieldTabs(workspace)}
      current={currentFieldTab(pathname, params.get('view'))}
    />
  );
}

function useFieldTabsOn() {
  const pathname = usePathname() ?? '';
  const params = useSearchParams();
  return fieldTabsShown(pathname) && !!fieldWorkspace(params.get('workspace'));
}

function FramedContributor({ children, tabs }: { children: ReactNode; tabs: boolean }) {
  const pathname = usePathname();
  const { locale, t } = useLanguage();
  const word = useMarkedWord();
  // A new page closes the drawer.
  useEffect(() => setLeftNavOpen(false), [pathname]);
  const meta = localeMeta[locale];
  return (
    <LeftNavFrame
      navId="contributor-navigation"
      narrow={tabs ? 'tabs' : 'drawer'}
      lang={meta.html}
      dir={meta.dir}
      words={{
        navLabel: t('wse.contributor.nav'),
        menuLabel: t('wse.shell.menu'),
        closeLabel: word('wse.shell.closeMenu'),
        collapseLabel: word('wse.shell.collapseMenu'),
        expandLabel: word('wse.shell.expandMenu'),
      }}
      nav={
        <Suspense fallback={<ContributorList tasksHref="/contributor" />}>
          <ContributorNav />
        </Suspense>
      }
    >
      {children}
      {tabs ? (
        <Suspense fallback={null}>
          <FieldTabBar />
        </Suspense>
      ) : null}
    </LeftNavFrame>
  );
}

function Switch({ children }: { children: ReactNode }) {
  return <FramedContributor tabs={useFieldTabsOn()}>{children}</FramedContributor>;
}

export function ContributorFrame({ children }: { children: ReactNode }) {
  // The address (its workspace) decides between the tabs and the drawer; the search params need a boundary.
  return (
    <Suspense fallback={<FramedContributor tabs={false}>{children}</FramedContributor>}>
      <Switch>{children}</Switch>
    </Suspense>
  );
}
