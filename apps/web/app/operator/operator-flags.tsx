'use client';
import { createContext, useContext, type ReactNode } from 'react';

// Which optional team screens are switched on, read on the server and handed down once, so a screen deep
// in the tree can show itself without every page between passing a prop. Off is the default everywhere.
const Flags = createContext({ replyReview: false, supplySources: false });

export function OperatorFlags({
  replyReview,
  supplySources = false,
  children,
}: {
  replyReview: boolean;
  /** CORRIDRA_SUPPLY_SOURCES: the Companies panel then offers a link to the supply source screens. */
  supplySources?: boolean;
  children: ReactNode;
}) {
  return <Flags.Provider value={{ replyReview, supplySources }}>{children}</Flags.Provider>;
}

export const useOperatorFlags = () => useContext(Flags);
