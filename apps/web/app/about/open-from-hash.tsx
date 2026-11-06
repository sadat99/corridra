'use client';
// A link to a place on the About page lands open: the disclosures that hold the target, and the ones inside
// it, open before the reader arrives. Without JavaScript every summary is still a working native control, and
// the browser itself opens a closed disclosure that holds the target of a fragment link.
import { useEffect } from 'react';
import { safeDecode } from '../../lib/ux/sub-tabs';

function openTarget() {
  const id = safeDecode(window.location.hash);
  const target = id ? document.getElementById(id) : null;
  if (!target) return;
  let revealed = false;
  for (
    let holder = target.parentElement?.closest('details');
    holder;
    holder = holder.parentElement?.closest('details')
  ) {
    if (!holder.open) revealed = true;
    holder.open = true;
  }
  if (target instanceof HTMLDetailsElement) target.open = true;
  for (const inner of target.querySelectorAll('details')) inner.open = true;
  // The target was inside a closed disclosure, so the browser could not scroll to it.
  if (revealed) target.scrollIntoView();
}

export function OpenFromHash() {
  useEffect(() => {
    openTarget();
    window.addEventListener('hashchange', openTarget);
    return () => window.removeEventListener('hashchange', openTarget);
  }, []);
  return null;
}
