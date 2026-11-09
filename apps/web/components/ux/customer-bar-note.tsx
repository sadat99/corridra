'use client';
import { useEffect } from 'react';
import {
  setCustomerBilling,
  setCustomerNote,
  setCustomerNotificationSettings,
  setCustomerOrganisationProfiles,
} from './customer-bar-store';

/**
 * Puts one quiet line in the customer header's account menu while the page is on screen. The same line is
 * also in the page markup, hidden, so the mode the frame is in (sample or real use) is part of the page.
 */
export function CustomerBarNote({
  text,
  billing = false,
  notificationSettings = false,
  organisationProfiles = false,
}: {
  text: string;
  billing?: boolean;
  notificationSettings?: boolean;
  organisationProfiles?: boolean;
}) {
  useEffect(() => {
    setCustomerNote(text);
    return () => setCustomerNote('');
  }, [text]);
  useEffect(() => {
    setCustomerBilling(billing);
    return () => setCustomerBilling(false);
  }, [billing]);
  useEffect(() => {
    setCustomerNotificationSettings(notificationSettings);
    return () => setCustomerNotificationSettings(false);
  }, [notificationSettings]);
  useEffect(() => {
    setCustomerOrganisationProfiles(organisationProfiles);
    return () => setCustomerOrganisationProfiles(false);
  }, [organisationProfiles]);
  return (
    <p hidden className="ux-customer-note">
      {text}
    </p>
  );
}
