import { notFound } from 'next/navigation';
import { z } from 'zod';
import { CustomerShell } from '../../../../components/customer-shell';
import { ServiceRequestNew } from '../service-request-new';
import { serviceRequestSession } from '../session';
import { ServiceRequestSourcePicker } from '../source-picker';
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
  const params = await searchParams;
  const parsed = query.safeParse(params);
  // CQ-27: with no source at all, ask what the help is for. A malformed source stays not found.
  if (!parsed.success && (params.kind !== undefined || params.ref !== undefined)) notFound();
  const session = await serviceRequestSession();
  if ('notice' in session) return session.notice;
  if (!parsed.success)
    return (
      <CustomerShell tab="work" eyebrow="REQUESTS" title="Request help">
        <ServiceRequestSourcePicker subject={session.subject} issuer={session.issuer} />
      </CustomerShell>
    );
  return (
    <CustomerShell tab="work" eyebrow="REQUESTS" title="Request help">
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
