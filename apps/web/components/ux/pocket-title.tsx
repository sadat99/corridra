'use client';
// Pocket (phone): the page's own title, quietly, in the short phone header. It copies the words of the page's h1 and is
// hidden from assistive technology, so the page keeps exactly one heading and nothing reads twice. It is drawn only on
// a phone and only on a page that has the Pocket button (components/ux/pocket-button.css).
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';

export function PocketTitle() {
  const pathname = usePathname();
  const [text, setText] = useState('');
  useEffect(() => {
    let frame = 0;
    const read = () => {
      frame = 0;
      setText(document.querySelector('#main h1')?.textContent?.trim() ?? '');
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(read);
    };
    schedule();
    const main = document.getElementById('main');
    if (!main) return () => cancelAnimationFrame(frame);
    // The heading can arrive after the frame (a streamed section) or change with the page.
    const observer = new MutationObserver(schedule);
    observer.observe(main, { childList: true, subtree: true, characterData: true });
    return () => {
      observer.disconnect();
      if (frame) cancelAnimationFrame(frame);
    };
  }, [pathname]);
  return (
    <span className="ux-pocket-title" aria-hidden="true">
      {text}
    </span>
  );
}
