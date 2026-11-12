'use client';
import { useEffect } from 'react';
import { sessionChanged } from '../session-events';
import {
  setCustomerBilling,
  setCustomerCompanies,
  setCustomerIdentity,
  setCustomerMove,
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
  companies = false,
  move = false,
}: {
  text: string;
  billing?: boolean;
  notificationSettings?: boolean;
  organisationProfiles?: boolean;
  /** The approved-companies module is on: the Search dialog lists the Companies page only then. */
  companies?: boolean;
  /** Home is Your Move: the Search dialog opens the same address as the Home tab. */
  move?: boolean;
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
  useEffect(() => {
    setCustomerCompanies(companies);
    return () => setCustomerCompanies(false);
  }, [companies]);
  useEffect(() => {
    setCustomerMove(move);
    return () => setCustomerMove(false);
  }, [move]);
  return (
    <p hidden className="ux-customer-note">
      {text}
    </p>
  );
}

/**
 * Hands the header the identity the server drew the page for, so the Search button can send it back as the rejection-only
 * headers the customer routes take. It draws nothing. With no identity (signed out, or the provider could not answer) the
 * holder stays empty and Search sends none: the route answers 401 itself. Cleared when the page goes away and on a change
 * of session.
 */
export function CustomerBarIdentityNote({
  subject,
  issuer,
}: {
  subject?: string;
  issuer?: string;
}) {
  useEffect(() => {
    setCustomerIdentity(subject && issuer ? { subject, issuer } : null);
    const clear = () => setCustomerIdentity(null);
    window.addEventListener(sessionChanged, clear);
    return () => {
      window.removeEventListener(sessionChanged, clear);
      clear();
    };
  }, [subject, issuer]);
  return null;
}
