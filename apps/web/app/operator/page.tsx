import './operator-overview.css';
import { OperatorEntry } from './operator-entry';
export const dynamic = 'force-dynamic';
export const metadata = {
  title: 'Operator workspace | Corridra',
  robots: { index: false, follow: false },
};
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ workspace?: string }>;
}) {
  return <OperatorEntry requested={(await searchParams).workspace} />;
}
