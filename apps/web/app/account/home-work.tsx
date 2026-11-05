import Link from 'next/link';
import { StageBar } from '../../components/mr/stage-bar';
import { RowLink, RowList } from '../../components/ux/row-list';
import { loadWorkItems } from '../../lib/work-items/load';
import {
  contentLang,
  incomplete,
  kindWords,
  workDateWords,
  workState,
  workStatusWords,
} from '../../lib/work-items/view';
import type { WorkList } from '../../lib/work-items/types';
import { formatDate } from '../../lib/ux/format';

/** Home shows the newest few; the whole list is one link away. */
export const homeWorkRows = 5;

/**
 * Active work on Home: up to five rows, each one link to the record, then the stage of the newest request as a
 * slim bar. Every state has its own words, the same as the Work list; a list that could not be read in full
 * says so, and an empty one says it is empty.
 */
export function HomeWorkView({ list }: { list: WorkList }) {
  const state = workState(list, 'all');
  const names = new Map(list.workspaces.map((workspace) => [workspace.id, workspace.name]));
  const shown = list.items.slice(0, homeWorkRows);
  const newest = list.items.find((item) => item.kind === 'request' && item.status !== '');
  return (
    <section aria-labelledby="home-work-title" className="guide-area home-work">
      <h2 id="home-work-title">Active work</h2>
      {state === 'unreadable' && (
        <p role="status">
          We could not check everything just now. Something may be waiting for you that this page
          could not read. Your work is safe.
        </p>
      )}
      {state === 'empty' && <p>You have no work here yet.</p>}
      {state === 'list' && (
        <>
          <RowList
            label="Active work"
            title="Request"
            columns={[{ name: 'Kind' }, { name: 'Status' }, { name: 'Date' }]}
          >
            {shown.map((item) => {
              const heading = item.title ?? kindWords[item.kind];
              const date = item.at ? formatDate(item.at) : '';
              const workspace = names.get(item.workspaceId);
              return (
                <RowLink
                  key={item.key}
                  href={item.href}
                  title={heading}
                  titleLang={contentLang(heading)}
                  cells={[
                    {
                      name: 'Kind',
                      value: workspace
                        ? `${kindWords[item.kind]}, ${workspace}`
                        : kindWords[item.kind],
                    },
                    { name: 'Status', value: workStatusWords(item), status: true },
                    { name: 'Date', value: date && `${workDateWords(item)} ${date}` },
                  ]}
                />
              );
            })}
          </RowList>
          {newest && (
            <div className="home-stage">
              <p>
                Newest request:{' '}
                <span dir="auto" lang={contentLang(newest.title ?? '')}>
                  {newest.title ?? kindWords[newest.kind]}
                </span>
              </p>
              <StageBar status={newest.status} name={newest.title ?? kindWords[newest.kind]} />
            </div>
          )}
          {incomplete(list) && <p role="note">This list may not show everything.</p>}
        </>
      )}
      <p>
        <Link prefetch={false} className="text-link" href="/account?view=work">
          See all your work
        </Link>
      </p>
    </section>
  );
}

/** Server side: reads with the person's own session proof, then shows the newest rows. */
export async function HomeWork({
  subject,
  issuer,
  rooms,
}: {
  subject: string;
  issuer: string;
  rooms: boolean;
}) {
  return <HomeWorkView list={await loadWorkItems(subject, issuer, { rooms })} />;
}
