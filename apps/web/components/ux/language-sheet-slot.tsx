'use client';
// A page's own language help for the language sheet (UI/UX.v4 row "Language chooser"). The sheet lives in the top bar
// and the page lives in the main region, so they only share the provider above both. A page puts its help in the
// sheet with <LanguageSheetExtra>...</LanguageSheetExtra>; the sheet shows it under the language rows while the page
// is open and the help goes away when the page does. Pass a stable element (memoise it): a new element on every render
// would update the header on every render of the page.
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

const Content = createContext<ReactNode>(null);
const Register = createContext<(node: ReactNode) => void>(() => {});

export function LanguageSheetSlotProvider({ children }: { children: ReactNode }) {
  const [node, setNode] = useState<ReactNode>(null);
  return (
    <Register.Provider value={setNode}>
      <Content.Provider value={node}>{children}</Content.Provider>
    </Register.Provider>
  );
}

/** What the open page put in the sheet, or nothing. */
export function useLanguageSheetSlot() {
  return useContext(Content);
}

/** Puts its children in the language sheet while this component is on the page. Renders nothing itself. */
export function LanguageSheetExtra({ children }: { children: ReactNode }) {
  const register = useContext(Register);
  useEffect(() => {
    register(children);
    return () => register(null);
  }, [register, children]);
  return null;
}
