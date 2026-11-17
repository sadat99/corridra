'use client';

import '../components/home-landing.css';
import '../components/home-routes.css';
import { HomeRoutes } from '../components/home-routes';
import { LegacyHashRedirect } from '../components/legacy-hash-redirect';
import { PublicShell } from '../components/public-shell';

// The home page, Two Routes (owner decision of 17 November 2026, design board "Corridra Two Routes", revision 3c;
// it replaces concept G of 6 November 2026, docs/revamp/specs/public-home.md). The words are keys in the message
// files (lib/i18n/home-words.ts). They show in the chosen language only while `CORRIDRA_LANGUAGES_PAGES` is on;
// until then every key shows its English words. The first action everywhere is Start a Request, to /plan or to a
// /plan?job=... link; the examples are labelled and send nothing.
export default function Home() {
  return (
    <PublicShell className="ux-guide-home ac1-home tr-home" translated>
      <LegacyHashRedirect />
      <HomeRoutes />
    </PublicShell>
  );
}
