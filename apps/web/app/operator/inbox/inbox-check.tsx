'use client';
// Team desk v4.1 (staff-core-29): in the Inbox, once one list has been read (each read passes the server's fresh
// authenticator check), the list of the tab that is open loads itself, so a person passes the check once instead of
// choosing Load on every tab. Each list keeps its own read, role check and Load button; a list that fails to load
// itself says why and waits for Load as before. Outside the Inbox (Settings and Helpers draw the same lists) there
// is no provider and nothing here does anything.
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';

type InboxCheck = { passed: boolean; pass: () => void };

const Check = createContext<InboxCheck | null>(null);

/** Holds, for one Inbox page, whether a list has been read. */
export function InboxCheckProvider({ children }: { children: ReactNode }) {
  const [passed, setPassed] = useState(false);
  const [value] = useState(() => ({ pass: () => setPassed(true) }));
  return <Check.Provider value={{ passed, pass: value.pass }}>{children}</Check.Provider>;
}

const nothing = () => {};

/**
 * Loads a list once, when its tab is the open one and a list of this Inbox has been read. `anchor` is the id of an
 * element of the list; its tab panel says whether the list is shown. Returns the function a list calls after a
 * read succeeded.
 */
export function useInboxOpenLoad(anchor: string, load: () => void, loaded: boolean): () => void {
  const check = useContext(Check);
  const [open, setOpen] = useState(false);
  const tried = useRef(false);
  const latest = useRef(load);
  useEffect(() => {
    latest.current = load;
  });
  const inInbox = check !== null;
  useEffect(() => {
    if (!inInbox) return undefined;
    const panel = document.getElementById(anchor)?.closest<HTMLElement>('[data-subtab]');
    if (!panel) return undefined;
    const read = () => setOpen(!panel.hidden);
    read();
    const watch = new MutationObserver(read);
    watch.observe(panel, { attributes: true, attributeFilter: ['hidden'] });
    return () => watch.disconnect();
  }, [anchor, inInbox]);
  const passed = check?.passed ?? false;
  useEffect(() => {
    if (!passed || !open || loaded || tried.current) return;
    tried.current = true;
    latest.current();
  }, [passed, open, loaded]);
  return check?.pass ?? nothing;
}
