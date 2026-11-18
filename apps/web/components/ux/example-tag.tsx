import type { ReactNode } from 'react';
import './example-tag.css';

// The tag on every invented example (companies, quotes, amounts, programmes, histories), "Example" by default, and the
// section eyebrow (a short mono label above a section title with the copper rule; copper is ornament only). Both keep
// the home's earlier class names as hooks, and carry their own styles so any page can use them.
export function ExampleTag({ children }: { children: ReactNode }) {
  return <span className="ux-example-tag ac1-example-tag">{children}</span>;
}

export function Eyebrow({ children }: { children: ReactNode }) {
  return <p className="label ux-eyebrow ac1-rule">{children}</p>;
}
