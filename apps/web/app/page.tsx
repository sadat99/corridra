import '../components/home-landing.css';
import '../components/home-routes.css';
import { HomeRoutes } from '../components/home-routes';
import { LegacyHashRedirect } from '../components/legacy-hash-redirect';
import { PublicShell } from '../components/public-shell';
import { supportWhatsappHref } from '../lib/ux/support-whatsapp';

// The home page as the owner's design board "Corridra Two Routes", revision 3c, in full (owner decisions of 17 and
// 18 November 2026; docs/revamp/specs/public-home.md). The words are keys in the message files
// (lib/i18n/home-words.ts); they show in the chosen language only while `CORRIDRA_LANGUAGES_PAGES` is on. The first
// action everywhere is Start a Request, to /plan or to a /plan?job=... link; the examples are labelled and send
// nothing. "Talk to a Person" and WhatsApp appear only when the owner's support number is set, as in the Help menus.
export default function Home() {
  return (
    <PublicShell className="ux-guide-home ac1-home tr-home" translated>
      <LegacyHashRedirect />
      <HomeRoutes whatsapp={supportWhatsappHref()} />
    </PublicShell>
  );
}
