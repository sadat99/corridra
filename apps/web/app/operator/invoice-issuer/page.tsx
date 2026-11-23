import Link from 'next/link';
import { headers } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { invoiceIssuerEnabled } from '@corridra/auth/customer-invoicing-real-issuer';
import { AccessState } from '../../../components/access-state';
import { WorkspaceShell } from '../../../components/workspace-shell';
import { foundations } from '../../../lib/foundations';
import { InvoiceIssuerForm } from './invoice-issuer-form';
import { chooseIssuerTenant } from './issuer-access';

export const dynamic = 'force-dynamic';
export const metadata = {
  title: 'Invoice issuer | Corridra',
  robots: { index: false, follow: false },
};

function Denied({ children }: { children: string }) {
  return (
    <WorkspaceShell eyebrow="OWNER ONLY" title="Invoice issuer">
      <AccessState kind="denied">
        <p>{children}</p>
      </AccessState>
      <Link prefetch={false} className="text-link" href="/operator">
        Back To Your Workspace
      </Link>
    </WorkspaceShell>
  );
}

/**
 * ADR-091 (unit B8). Owner only. With CORRIDRA_INVOICE_ISSUER off the page does not exist. The page itself reads
 * nothing about the issuer: the form asks the route, and the database decides again who may read and who may save.
 */
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ workspace?: string }>;
}) {
  if (!invoiceIssuerEnabled()) notFound();
  const s = foundations();
  if (!s) return <Denied>The protected workspace is not configured in this environment.</Denied>;
  await s.ready;
  const identity = await s.provider.getSession(await headers());
  if (!identity)
    redirect('/operator/signin?next=' + encodeURIComponent('/operator/invoice-issuer'));
  const tenant = chooseIssuerTenant(
    await s.access.tenants(identity.token),
    (await searchParams).workspace,
  );
  if (!tenant)
    return (
      <Denied>
        This page is for the workspace owner. Ask the owner to enter the issuer details.
      </Denied>
    );
  return (
    <WorkspaceShell
      eyebrow="OWNER ONLY"
      title="Invoice issuer"
      className="ux-invoice-issuer"
      lead={
        <p>
          The company details printed on every real invoice. You type them here and confirm with
          your authenticator code.
        </p>
      }
    >
      <InvoiceIssuerForm tenant={tenant.id} />
      <Link prefetch={false} className="text-link" href="/operator">
        Back To Your Workspace
      </Link>
    </WorkspaceShell>
  );
}
