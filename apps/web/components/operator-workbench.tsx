'use client';
import { useRef, useState, type FormEvent } from 'react';
export function OperatorWorkbench({
  label,
  sections,
}: {
  label: string;
  sections: { label: string; heading: string }[];
}) {
  const nav = useRef<HTMLElement>(null);
  const [notice, setNotice] = useState('');
  function open(heading: string) {
    const root = nav.current?.closest('[data-operator-workbench]');
    const target = Array.from(root?.querySelectorAll<HTMLElement>('h2,h3,h4,summary') ?? []).find(
      (node) => node.textContent?.trim().toLowerCase().startsWith(heading.toLowerCase()),
    );
    if (!target) {
      setNotice(
        'Load the relevant record or open its existing review control first. Only sections available in your current view can be opened.',
      );
      return;
    }
    for (
      let parent = target.parentElement;
      parent && parent !== root;
      parent = parent.parentElement
    )
      if (parent instanceof HTMLDetailsElement) parent.open = true;
    if (target instanceof HTMLElement) {
      if (!target.matches('summary,a,button,input,select,textarea,[tabindex]'))
        target.tabIndex = -1;
      target.scrollIntoView({ block: 'start', behavior: 'instant' });
      target.focus({ preventScroll: true });
    }
    setNotice('');
  }
  return (
    <nav ref={nav} className="ux-operator-workbench" aria-label={label}>
      <p className="label">WORKFLOW SECTIONS</p>
      <div>
        {sections.map((s) => (
          <button className="text-link" type="button" key={s.label} onClick={() => open(s.heading)}>
            {s.label}
          </button>
        ))}
      </div>
      <p>
        Move between sections without losing your entries. Available actions depend on your current
        access and approved scope.
      </p>
      {notice && <p aria-live="polite">{notice}</p>}
    </nav>
  );
}
export function useFormChangeGuard<T extends HTMLElement = HTMLElement>() {
  const ref = useRef<T>(null);
  function onChangeCapture(event: FormEvent<T>) {
    const form = (event.target as Element).closest('form');
    if (form && ref.current?.contains(form)) form.dataset.uxDirty = 'true';
  }
  function onResetCapture(event: FormEvent<T>) {
    const form = event.target as HTMLFormElement;
    delete form.dataset.uxDirty;
  }
  function confirmChange() {
    return (
      !ref.current?.querySelector('form[data-ux-dirty="true"]') ||
      window.confirm(
        'Changing this view may remove unsaved form entries. Cancel to keep working, or continue to change the visible records.',
      )
    );
  }
  return { ref, onChangeCapture, onResetCapture, confirmChange };
}
export function formAcknowledged(form: HTMLFormElement) {
  delete form.dataset.uxDirty;
}
