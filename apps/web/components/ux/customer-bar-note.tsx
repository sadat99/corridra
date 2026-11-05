'use client';
import { useEffect } from 'react';
import { setCustomerNote } from './customer-bar-store';

/** Puts one quiet line in the customer header's account menu while the page is on screen. Renders nothing. */
export function CustomerBarNote({ text }: { text: string }) {
  useEffect(() => {
    setCustomerNote(text);
    return () => setCustomerNote('');
  }, [text]);
  return null;
}
