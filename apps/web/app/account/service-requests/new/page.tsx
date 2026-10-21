import { notFound } from 'next/navigation';
import { z } from 'zod';
import { CustomerShell } from '../../../../components/customer-shell';
import { ServiceRequestNew } from '../service-request-new';
import { serviceRequestSession } from '../session';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const metadata = {
  title: 'Paid-service requests | Corridra',
  robots: { index: false, follow: false },
};
const query = z.object({
  kind: z.enum(['request', 'programme', 'company']),
  ref: z.string().regex(/^([a-f0-9-]{36}|[a-f0-9]{64})$/),
  workspace: z.uuid().optional(),
});
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const parsed = query.safeParse(await searchParams);
  if (!parsed.success) notFound();
  const session = await serviceRequestSession();
  if ('notice' in session) return session.notice;
  return (
    <CustomerShell tab="work" eyebrow="YOUR WORKSPACE" title="Request help">
      <ServiceRequestNew
        subject={session.subject}
        issuer={session.issuer}
        kind={parsed.data.kind}
        contextRef={parsed.data.ref}
        workspaceId={parsed.data.workspace ?? null}
      />
    </CustomerShell>
  );
}
