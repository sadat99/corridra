import type { Page } from '@playwright/test';
import {
  bundleFixture,
  mountBundle,
  webFile,
  type Bundle,
  type MountOptions,
} from './home-fixture-lib';

// /how-it-works, /trust and the summarised home with CORRIDRA_UX_HOW_TRUST_V43 on (owner, 26 Nov 2026, first hand to
// Guardian G66: "yes to all three, build it"), as component fixtures so CI keeps one production build with the switch
// unset. The real compositions and the real pack footer are bundled with their own stylesheets and mounted on the home
// page of that build (tests/ux/home-fixture-lib.ts), the way home-v43-fixture.ts does it. The header is not part of it:
// the layout draws it. The real-build proofs (server HTML, links, a build with the switch on) are in
// how-trust-v43-server.spec.ts.
export type DeepKind = 'how-it-works' | 'trust' | 'home';

const entries: Record<DeepKind, { component: string; file: string; ready: string }> = {
  'how-it-works': {
    component: 'HowItWorksV43',
    file: 'components/how-it-works-v43.tsx',
    ready: 'main#main .htv43 .htv43-hero',
  },
  trust: {
    component: 'TrustV43',
    file: 'components/trust-v43.tsx',
    ready: 'main#main .htv43 .htv43-hero',
  },
  home: {
    component: 'HomeV43Summarised',
    file: 'components/home-v43-summarised.tsx',
    ready: 'main#main .hv43 .hv43-hero',
  },
};

const bundles = new Map<DeepKind, Promise<Bundle>>();

function bundle(kind: DeepKind) {
  const { component, file } = entries[kind];
  if (!bundles.has(kind))
    bundles.set(
      kind,
      bundleFixture(`import { createRoot } from 'react-dom/client';
        import { ${component} as Page } from ${webFile(file)};
        import { SiteFooterPack } from ${webFile('components/site-footer-pack.tsx')};
        import { useSignedIn } from ${webFile('components/use-signed-in.ts')};
        function App() {
          useSignedIn(true);
          return (
            <>
              <main id="main" lang="en" dir="ltr" tabIndex={-1} className="ux-public ux-guide-home ac1-home tr-home">
                <Page${kind === 'home' ? ' whatsapp={null}' : ''} />
              </main>
              <SiteFooterPack realUse={true} accessDoors={false} />
            </>
          );
        }
        createRoot(document.getElementById('ht-app')).render(<App />);`),
    );
  return bundles.get(kind)!;
}

/** Mounts one of the three on the live home page of the running (switch off) build. */
export async function mountDeep(page: Page, kind: DeepKind, options: MountOptions) {
  await mountBundle(page, await bundle(kind), options, {
    id: 'ht-app',
    ready: entries[kind].ready,
    footer: 'footer.guide-footer-pack',
  });
}
