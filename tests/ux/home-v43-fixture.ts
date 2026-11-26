import type { Page } from '@playwright/test';
import {
  bundleFixture,
  mountBundle,
  webFile,
  type Bundle,
  type MountOptions,
} from './home-fixture-lib';

// Home page v4.3 with the switch on (owner, 26 Nov 2026, via the Guardian: "update as per attachment 100%
// correctly"), as a component fixture so CI keeps one production build with CORRIDRA_UX_HOME_V43 unset. The real
// HomeV43 and the real SiteFooterPack (V43 on implies it on the public pages) are bundled with their own stylesheets and mounted on the home
// page of that build (tests/ux/home-fixture-lib.ts). The header is not part of it: the layout draws it.
let bundled: Promise<Bundle> | null = null;

function bundle() {
  bundled ??= bundleFixture(`import { createRoot } from 'react-dom/client';
    import { HomeV43 } from ${webFile('components/home-v43.tsx')};
    import { SiteFooterPack } from ${webFile('components/site-footer-pack.tsx')};
    import { useSignedIn } from ${webFile('components/use-signed-in.ts')};
    const q = new URLSearchParams(location.search);
    function Page() {
      useSignedIn(true);
      return (
        <>
          <main id="main" lang="en" dir="ltr" tabIndex={-1} className="ux-public ux-guide-home ac1-home tr-home">
            <HomeV43 whatsapp={q.get('talk') === '1' ? 'https://wa.me/10000000000' : null} />
          </main>
          <SiteFooterPack realUse={true} accessDoors={q.get('doors') === '1'} />
        </>
      );
    }
    createRoot(document.getElementById('v43-app')).render(<Page />);`);
  return bundled;
}

export type HomeV43Options = MountOptions;

/** Mounts the v4.3 home and the pack footer on the live home page of the running (switch off) build. */
export async function mountHomeV43(page: Page, options: HomeV43Options) {
  await mountBundle(page, await bundle(), options, {
    id: 'v43-app',
    ready: 'main#main .hv43 .hv43-hero',
    footer: 'footer.guide-footer-pack',
  });
}
