'use client';
import { useSyncExternalStore } from 'react';

// Home's greeting. The server cannot know the person's local time, so it says "Welcome back" and the browser
// changes it to the part of the day on the person's own clock. The first name comes from the account's display
// name; an email address is never shown here.
const noop = () => () => undefined;
function partOfDay(): string {
  const hour = new Date().getHours();
  return hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
}

export function Greeting({ name }: { name: string | null }) {
  const first = name && !name.includes('@') ? name.split(/\s+/)[0] : null;
  const opening = useSyncExternalStore(noop, partOfDay, () => 'Welcome back');
  return <>{first ? `${opening}, ${first}` : opening}</>;
}
