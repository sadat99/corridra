import { offeredLanguages } from '../../lib/i18n/locales';
import { comfortBootScript } from '../../lib/ux/comfort';
import { languageBootScript } from '../../lib/ux/language-boot';

// The pre-paint script as a same-origin file (CQ-10, CQ-48): first the language script, then the saved
// reading comfort choices (text size, Less Movement). Served from here instead of an inline script so no
// HTML is injected into the page (security rule corridra-no-raw-html). Its body is built only from the
// offered language codes, their fixed meta and fixed storage keys, never from request data.
export const dynamic = 'force-dynamic';

export function GET() {
  const language = languageBootScript(offeredLanguages().map((item) => item.code));
  return new Response(`${language}\n${comfortBootScript()}`, {
    headers: {
      'Content-Type': 'text/javascript; charset=utf-8',
      'Cache-Control': 'public, max-age=300',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
