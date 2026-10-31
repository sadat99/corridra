// Page header with the one H1 of the route, an optional breadcrumb and one primary action, and the
// status chip (commercial readiness program, 5.2). Owner after Wave 0: WS-E.
import './ux-kit.css';
import Link from 'next/link';
import type { ReactNode } from 'react';

export function PageHeader({
  title,
  breadcrumb,
  primaryAction,
  description,
}: {
  title: string;
  breadcrumb?: { label: string; href?: string }[];
  primaryAction?: ReactNode;
  description?: ReactNode;
}) {
  return (
    <header className="ux-kit-header">
      {breadcrumb?.length ? (
        <nav className="ux-kit-crumbs" aria-label="Breadcrumb">
          <ol>
            {breadcrumb.map((item, index) => (
              <li key={`${item.label}-${index}`}>
                {item.href && index < breadcrumb.length - 1 ? (
                  <Link href={item.href}>{item.label}</Link>
                ) : (
                  <span aria-current={index === breadcrumb.length - 1 ? 'page' : undefined}>
                    {item.label}
                  </span>
                )}
              </li>
            ))}
          </ol>
        </nav>
      ) : null}
      <div className="ux-kit-row" style={{ justifyContent: 'space-between' }}>
        <h1>{title}</h1>
        {primaryAction}
      </div>
      {description ? <div className="ux-kit-hint">{description}</div> : null}
    </header>
  );
}

export { StatusChip } from './status-chip';
