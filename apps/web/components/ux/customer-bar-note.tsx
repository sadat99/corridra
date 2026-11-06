'use client';
import { useEffect } from 'react';
import { setCustomerBilling, setCustomerNote } from './customer-bar-store';

/**
 * Puts one quiet line in the customer header's account menu while the page is on screen. The same line is
 * also in the page markup, hidden, so the mode the frame is in (sample or real use) is part of the page.
 */
export function CustomerBarNote({ text, billing = false }: { text: string; billing?: boolean }) {
  useEffect(() => {
    setCustomerNote(text);
    return () => setCustomerNote('');
  }, [text]);
  useEffect(() => {
    setCustomerBilling(billing);
    return () => setCustomerBilling(false);
  }, [billing]);
  return (
    <p hidden className="ux-customer-note">
      {text}
    </p>
  );
}
