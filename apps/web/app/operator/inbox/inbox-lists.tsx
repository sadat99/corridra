'use client';
// The Inbox page body (team desk v4.1, decision 5 and unit D18): the four lists the desk already has, each in its
// own tab, in one row. Nothing about a list changes here: each one is the component Settings and Helpers drew,
// with its own reads, its own role check and the server's fresh authenticator check. A list that is not offered
// in this environment gets no tab. Helper interest gets its tab once its register answers that it is installed.
import { useEffect, useRef, useState } from 'react';
import { SubTabs, type SubTab } from '../../../components/ux/sub-tabs';
import { helperInterestInstalled } from '../../../lib/helper-interest-client';
import { ErasureQueue } from '../erasure-queue';
import { HelperInterestList } from '../helper-interest-list';
import { ProblemReportQueue } from '../problem-report-queue';
import { ProgrammeApplicationQueue } from '../programme-application-queue';
import { InboxCheckProvider } from './inbox-check';
import './inbox.css';

export function InboxLists({
  tenant,
  role,
  problemReports,
  programmeApplications,
}: {
  tenant: string;
  role: string;
  /** Report a Problem is offered, so its list exists. */
  problemReports: boolean;
  /** Programme applications are offered, so their list exists. */
  programmeApplications: boolean;
}) {
  const [helpers, setHelpers] = useState(false);
  useEffect(() => {
    let live = true;
    void helperInterestInstalled(tenant).then((yes) => {
      if (live) setHelpers(yes);
    });
    return () => {
      live = false;
    };
  }, [tenant]);
  // A list that is drawn as a closed disclosure is opened once, when it is first drawn: its tab already names
  // it, so nobody opens the same thing twice. Opening reads nothing; each list still waits for its own Load button
  // and the code check. A list the person closes stays closed.
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const holder = root.current;
    if (!holder) return undefined;
    const opened = new WeakSet<HTMLDetailsElement>();
    const openNew = () =>
      holder.querySelectorAll<HTMLDetailsElement>('.ux-subtabs-panel > details').forEach((list) => {
        if (opened.has(list)) return;
        opened.add(list);
        list.open = true;
      });
    openNew();
    const watch = new MutationObserver(openNew);
    watch.observe(holder, { childList: true, subtree: true });
    return () => watch.disconnect();
  }, []);
  const tabs: SubTab[] = [
    ...(problemReports
      ? [
          {
            id: 'reports',
            label: 'Problem reports',
            aliases: ['settings-reports'],
            panel: <ProblemReportQueue tenant={tenant} role={role} tabbed />,
          },
        ]
      : []),
    {
      id: 'erasure',
      label: 'Erasure requests',
      aliases: ['settings-erasure', 'erasure-queue-title'],
      panel: <ErasureQueue tenant={tenant} role={role} problemReports={problemReports} tabbed />,
    },
    ...(programmeApplications
      ? [
          {
            id: 'applications',
            label: 'Programme applications',
            aliases: ['settings-applications'],
            panel: <ProgrammeApplicationQueue tenant={tenant} role={role} tabbed />,
          },
        ]
      : []),
    ...(helpers
      ? [
          {
            id: 'helpers',
            label: 'Helper interest',
            // The register already answered that it is installed, so the list does not ask again.
            panel: <HelperInterestList tenant={tenant} role={role} installed tabbed />,
          },
        ]
      : []),
  ];
  return (
    <div ref={root} className="inbox-page">
      <InboxCheckProvider>
        <SubTabs className="inbox-lists" label="Inbox lists" tabs={tabs} />
      </InboxCheckProvider>
    </div>
  );
}
