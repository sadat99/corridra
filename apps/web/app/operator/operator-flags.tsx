'use client';
import { createContext, useContext, type ReactNode } from 'react';

// Which optional team screens are switched on, read on the server and handed down once, so a screen deep
// in the tree can show itself without every page between passing a prop. Off is the default everywhere.
const Flags = createContext({ replyReview: false });

export function OperatorFlags({
  replyReview,
  children,
}: {
  replyReview: boolean;
  children: ReactNode;
}) {
  return <Flags.Provider value={{ replyReview }}>{children}</Flags.Provider>;
}

export const useOperatorFlags = () => useContext(Flags);
