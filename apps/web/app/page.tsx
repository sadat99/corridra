import '../components/home-landing.css';
import '../components/home-routes.css';
import { HomeRoutes } from '../components/home-routes';
import { LegacyHashRedirect } from '../components/legacy-hash-redirect';
import { PublicShell } from '../components/public-shell';
import { supportWhatsappHref } from '../lib/ux/support-whatsapp';
import { uxSwitchOn } from '../lib/ux-switches';

// The home page as the owner's design board "Corridra Two Routes", revision 3c, in full (owner decisions of 17 and
// 18 November 2026; docs/revamp/specs/public-home.md). The words are keys in the message files
// (lib/i18n/home-words.ts); they show in the chosen language only while `CORRIDRA_LANGUAGES_PAGES` is on. The first
// action everywhere is Start a Request, to /plan or to a /plan?job=... link; the examples are labelled and send
// nothing. "Talk to a Person" and WhatsApp appear only when the owner's support number is set, as in the Help menus.
// Home page v4.2 (owner, 25 Nov 2026: "lock this v4.2", "Add a switch, off by default"): only while
// CORRIDRA_UX_HOME_V42 is exactly "true" the page is the v4.2 composition (docs/revamp/specs/ui-ux-v4-2.md). It is
// loaded only then, so with the switch off this page and its styles are exactly what they were. The switch is read when
// the page is built, so a change needs a redeploy.
export default async function Home() {
  if (uxSwitchOn('CORRIDRA_UX_HOME_V42')) {
    const { HomeV42 } = await import('../components/home-v42');
    return (
      <PublicShell className="ux-guide-home ac1-home tr-home" translated>
        <LegacyHashRedirect />
        <HomeV42 whatsapp={supportWhatsappHref()} />
      </PublicShell>
    );
  }
  return (
    <PublicShell className="ux-guide-home ac1-home tr-home" translated>
      <LegacyHashRedirect />
      <HomeRoutes whatsapp={supportWhatsappHref()} />
    </PublicShell>
  );
}
