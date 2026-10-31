import { offeredLanguages } from '../../lib/i18n/locales';
import { languageBootScript } from '../../lib/ux/language-boot';

// The pre-paint language script as a same-origin file (CQ-10, CQ-48). Served from here instead of an
// inline script so no HTML is injected into the page (security rule corridra-no-raw-html). Its body
// is built only from the offered language codes and their fixed meta, never from request data.
export const dynamic = 'force-dynamic';

export function GET() {
  return new Response(languageBootScript(offeredLanguages().map((item) => item.code)), {
    headers: {
      'Content-Type': 'text/javascript; charset=utf-8',
      'Cache-Control': 'public, max-age=300',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
