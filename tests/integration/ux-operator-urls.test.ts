import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  fragmentFor,
  operatorPlaceFor,
  operatorSectionPath,
  operatorSlugs,
  reservedOperatorSegments,
  sectionForSlug,
} from '../../apps/web/lib/operator-urls';
import {
  operatorReturnTo,
  operatorSignInPage,
  operatorSignInPath,
  workspaceSections,
} from '../../apps/web/lib/workspace-navigation';
import { switchRegistry } from '../../apps/web/lib/owner-switches';

// Operator section addresses and view as stage 2 (Lane 9 of the UX update): the closed list of
// addresses, the rule that a `#` part wins, and every switch-off path.
const read = (path: string) => readFileSync(resolve(path), 'utf8');

describe('the closed list of section addresses', () => {
  it('gives each of the 18 workspace sections exactly one address word', () => {
    expect(workspaceSections).toHaveLength(18);
    expect(Object.keys(operatorSlugs).sort()).toEqual(workspaceSections.map((s) => s.id).sort());
    const words = Object.values(operatorSlugs);
    expect(new Set(words).size).toBe(18);
    for (const word of words) expect(word).toMatch(/^[a-z]+(?:-[a-z]+)*$/);
  });
  it('never uses a word that is already a page under /operator', () => {
    for (const reserved of reservedOperatorSegments)
      expect(Object.values(operatorSlugs)).not.toContain(reserved);
    // Those pages are real folders, so they are matched before the section address.
    const folders = readdirSync(resolve('apps/web/app/operator'), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
    for (const reserved of reservedOperatorSegments) {
      expect(folders).toContain(reserved);
      expect(existsSync(resolve(`apps/web/app/operator/${reserved}`))).toBe(true);
    }
    expect(folders).toContain('[section]');
    // Every other folder under /operator is also off limits for a section word.
    for (const folder of folders.filter((name) => !name.startsWith('[')))
      expect(Object.values(operatorSlugs)).not.toContain(folder);
  });
  it('round trips every section and refuses everything else', () => {
    for (const section of workspaceSections) {
      const path = operatorSectionPath(section.id)!;
      expect(path).toMatch(/^\/operator\/[a-z-]+$/);
      expect(sectionForSlug(path.slice('/operator/'.length))).toBe(section.id);
    }
    for (const junk of [
      '',
      'owner',
      'view-as',
      'Missions',
      'missions ',
      'missions/extra',
      '../missions',
      '%6dissions',
      '__proto__',
      'constructor',
      'toString',
      'workspace-missions',
      'ops-gates',
    ])
      expect(sectionForSlug(junk), junk).toBeNull();
    for (const junk of ['', 'main', 'workspace-navigation', '__proto__', 'constructor', 'owner'])
      expect(operatorSectionPath(junk), junk).toBeNull();
  });
});

describe('what the workspace shows for an address', () => {
  it('a # part always wins, so old links keep working', () => {
    expect(fragmentFor('#workspace-research', 'workspace-missions')).toBe('workspace-research');
    expect(fragmentFor('#main', 'workspace-missions')).toBe('main');
  });
  it('with no # part the section of the address shows; with neither it is as before', () => {
    expect(fragmentFor('', 'workspace-missions')).toBe('workspace-missions');
    expect(fragmentFor('#', 'ops-gates')).toBe('ops-gates');
    expect(fragmentFor('', '')).toBe('');
    expect(fragmentFor('#workspace-audit', '')).toBe('workspace-audit');
  });
  it('the sign-in return list is not widened', () => {
    expect(operatorReturnTo('/operator/missions')).toBe('/operator');
    expect(operatorReturnTo('/operator#workspace-missions')).toBe('/operator#workspace-missions');
    expect(
      operatorReturnTo('/operator?workspace=11111111-1111-4111-8111-111111111111#ops-gates'),
    ).toBe('/operator?workspace=11111111-1111-4111-8111-111111111111#ops-gates');
  });
});

describe('the error page signs in again to the workspace and section it was showing', () => {
  const workspace = '11111111-1111-4111-8111-111111111111';
  const at = (address: string) => operatorPlaceFor(new URL(address, 'http://127.0.0.1:3200'));
  const returnOf = (address: string) => {
    const place = at(address);
    return decodeURIComponent(
      (place ? operatorSignInPath(place.workspace, place.section) : operatorSignInPage).split(
        '?next=',
      )[1] ?? '',
    );
  };
  it('reads the workspace and the # part on /operator', () => {
    expect(at('/operator?workspace=' + workspace + '#workspace-sources')).toEqual({
      workspace,
      section: 'workspace-sources',
    });
    expect(at('/operator?workspace=' + workspace)).toEqual({ workspace, section: '' });
    expect(at('/operator#workspace-sources')).toEqual({
      workspace: '',
      section: 'workspace-sources',
    });
  });
  it('reads the section from a section address, and a # part wins', () => {
    expect(at('/operator/sources?workspace=' + workspace)).toEqual({
      workspace,
      section: 'workspace-sources',
    });
    expect(at('/operator/sources?workspace=' + workspace + '#workspace-evidence')).toEqual({
      workspace,
      section: 'workspace-evidence',
    });
  });
  it('gives nothing with neither a workspace nor a section, or on any other operator page', () => {
    expect(at('/operator')).toBeNull();
    expect(at('/operator#')).toBeNull();
    for (const reserved of reservedOperatorSegments)
      expect(
        at('/operator/' + reserved + '?workspace=' + workspace + '#workspace-sources'),
        reserved,
      ).toBeNull();
    for (const other of ['/operator/unknown', '/operator/sources/extra', '/workspace', '/'])
      expect(at(other + '?workspace=' + workspace), other).toBeNull();
    // Nothing to come back to, so the link stays the plain sign-in page, not a ?next=/operator.
    expect(returnOf('/operator')).toBe('');
  });
  it('a bad workspace or section falls back exactly as the sign-in path already does', () => {
    expect(returnOf('/operator?workspace=' + workspace + '#workspace-sources')).toBe(
      '/operator?workspace=' + workspace + '#workspace-sources',
    );
    expect(returnOf('/operator?workspace=' + workspace + '#nonexistent')).toBe(
      '/operator?workspace=' + workspace,
    );
    expect(returnOf('/operator?workspace=not-a-workspace#workspace-sources')).toBe(
      '/operator#workspace-sources',
    );
    expect(returnOf('/operator?workspace=not-a-workspace')).toBe('/operator');
    expect(returnOf('/operator#//example.invalid')).toBe('/operator');
    for (const address of [
      '/operator?workspace=' + workspace + '#workspace-sources?token=x',
      '/operator?workspace=' + workspace + '&next=//evil.test#workspace-sources',
      '/operator/sources?workspace=' + workspace + '#main',
    ])
      expect(operatorReturnTo(returnOf(address)), address).toBe(returnOf(address));
  });
  it('the error page link is a plain anchor read from the address store, and no Link goes to sign-in', () => {
    const page = read('apps/web/app/operator/error.tsx');
    expect(page).toMatch(
      /useSyncExternalStore\(\s*subscribeToHash,\s*\(\) => window\.location\.href,\s*\(\) => '',\s*\)/,
    );
    expect(page).toContain(
      'href={place ? operatorSignInPath(place.workspace, place.section) : operatorSignInPage}',
    );
    for (const [element] of page.matchAll(/<Link\b[\s\S]*?(?:<\/Link>|\/>)/g))
      expect(element).not.toMatch(/operatorSignIn|\/operator\/signin/);
    expect(read('apps/web/app/operator/workspace.tsx')).toContain(
      "import { subscribeToHash } from '../../lib/address-store';",
    );
  });
});

describe('every switch-off path', () => {
  it('is a real owner switch', () => {
    expect(switchRegistry.find((s) => s.name === 'CORRIDRA_UX_OPERATOR_URLS')?.kind).toBe('flag');
  });
  it('the section page answers not found with the switch off, before it reads anything', () => {
    const page = read('apps/web/app/operator/[section]/page.tsx');
    const off = page.indexOf("if (!uxSwitchOn('CORRIDRA_UX_OPERATOR_URLS')) notFound();");
    expect(off).toBeGreaterThan(-1);
    expect(off).toBeLessThan(page.indexOf('(await params)'));
    expect(off).toBeLessThan(page.indexOf('<OperatorEntry'));
    expect(page).toContain('if (!section) notFound();');
  });
  it('the operator page is the same workspace through the same entry, with no section', () => {
    const page = read('apps/web/app/operator/page.tsx');
    expect(page).toContain('<OperatorEntry requested={(await searchParams).workspace} />');
    const entry = read('apps/web/app/operator/operator-entry.tsx');
    // Without a section the sign-in redirect is the address it always was.
    expect(entry).toContain("+ (section ? '#' + section : '')");
    expect(entry).toContain('initialSection={section}');
    // The text of every unavailable state is the text it always was.
    for (const line of [
      'The protected workspace is not configured in this environment.',
      'Your session needs a current authenticator check and an active membership.',
      'Invited contributors use their assigned-task link, which does not grant workspace',
    ])
      expect(entry).toContain(line);
  });
  it('the workspace keeps its tenant switch on /operator unless the address is a section', () => {
    const workspace = read('apps/web/app/operator/workspace.tsx');
    expect(workspace).toContain(
      "(initialSection && operatorSectionPath(initialSection)) || '/operator'",
    );
    expect(workspace).toContain('initialSection = ');
  });
  it('the view-as samples show only with the switch on, and are inside the inert stage', () => {
    const page = read('apps/web/app/operator/view-as/[role]/page.tsx');
    expect(page).toContain("{uxSwitchOn('CORRIDRA_UX_OPERATOR_URLS') && <SampleScreens />}");
    expect(page.indexOf('<SampleScreens />')).toBeGreaterThan(
      page.indexOf('className="view-as-content" inert'),
    );
    expect(page.indexOf('<SampleScreens />')).toBeLessThan(page.indexOf('</main>'));
    const samples = read('apps/web/app/operator/view-as/[role]/sample-screens.tsx');
    // A plain server component with fixed invented data: the preview folder holds no client code.
    expect(samples).not.toMatch(/['"]use (client|server)['"]/);
    expect(samples).not.toMatch(/fetch\(|XMLHttpRequest|sendBeacon|localStorage|cookie/);
    // The protected preview rule: nothing that can act, so no link, no button and no form, and no
    // reading of this browser (the real Your Move screen has links and a "forget" button, so it is not used).
    expect(samples).not.toMatch(/<(Link|a|button|form|input)\b|href=|MoveView/);
    expect(samples).toContain('<MoveCard');
  });
  it('the Operations panel loads from the section it is shown for, so a section address loads it as a # part does', () => {
    const operations = read('apps/web/app/operator/operations.tsx');
    expect(operations).toContain('}, [section, load]);');
    expect(operations).not.toMatch(/window\.location\.hash|hashchange/);
    // The workspace hands it the section that follows the # part and, with the switch on, the address.
    expect(read('apps/web/app/operator/workspace.tsx')).toContain('section={fragment}');
  });
});

describe('signing in again from the workspace comes back to the same workspace and section', () => {
  const workspace = '11111111-1111-4111-8111-111111111111';
  const back = (hash: string, initialSection: string) =>
    decodeURIComponent(
      operatorSignInPath(workspace, fragmentFor(hash, initialSection)).split('?next=')[1]!,
    );
  it('a section address with no # part returns to that section as a # part', () => {
    expect(back('', 'workspace-sources')).toBe(
      '/operator?workspace=' + workspace + '#workspace-sources',
    );
  });
  it('a # part on a section address wins, as it does for what the workspace shows', () => {
    expect(back('#workspace-evidence', 'workspace-sources')).toBe(
      '/operator?workspace=' + workspace + '#workspace-evidence',
    );
  });
  it('a # part that is not a section keeps only the workspace, also on a section address', () => {
    for (const hash of [
      '#nonexistent',
      '#main',
      '#workspace-sources?token=x',
      '#//example.invalid',
    ])
      expect(back(hash, 'workspace-sources'), hash).toBe('/operator?workspace=' + workspace);
    expect(back('', '')).toBe('/operator?workspace=' + workspace);
  });
  it('the workspace link follows the # part through a store that reads nothing on the server', () => {
    const workspaceSource = read('apps/web/app/operator/workspace.tsx');
    expect(workspaceSource).toContain(
      'href={operatorSignInPath(tenant, fragmentFor(hash, initialSection))}',
    );
    expect(workspaceSource).toMatch(
      /useSyncExternalStore\(\s*subscribeToHash,\s*\(\) => window\.location\.hash,\s*\(\) => '',\s*\)/,
    );
    expect(workspaceSource).not.toContain('href="/operator/signin"');
    // Signing out is a full page load to the plain sign-in page, with no address to come back to.
    expect(workspaceSource).toContain('window.location.replace(operatorSignInPage);');
    expect(workspaceSource).not.toContain("router.replace('/operator/signin')");
    expect(workspaceSource).not.toMatch(/location\.replace\(operatorSignInPath/);
    expect(read('apps/web/app/operator/authenticator-check.tsx')).toContain(
      "operatorSignInPath(tenant, 'workspace-authenticator')",
    );
  });
  it('contributor sign-out is a full page load to the contributor page, never a router call', () => {
    const signOut = read('apps/web/app/contributor/signout.tsx');
    expect(signOut).toContain("window.location.replace('/contributor');");
    expect(signOut).not.toMatch(/\brouter\./);
    expect(signOut).not.toContain('useRouter');
  });
  it('the page for someone with no membership keeps the workspace and section address asked for', () => {
    const entry = read('apps/web/app/operator/operator-entry.tsx');
    expect(entry).toContain('href={operatorSignInPath(requested, section)}');
    expect(entry).not.toContain('href="/operator/signin"');
    // The same address the signed-out redirect above it builds from the request.
    expect(operatorSignInPath(workspace, 'workspace-sources')).toBe(
      '/operator/signin?next=' +
        encodeURIComponent('/operator?workspace=' + workspace + '#workspace-sources'),
    );
    expect(decodeURIComponent(operatorSignInPath(undefined, undefined).split('?next=')[1]!)).toBe(
      '/operator',
    );
  });
  it('every link into sign-in is a full page load, never a client-side Link', () => {
    // Next 16.4.3 doubles the # part when a soft navigation returns to a page first loaded with one.
    for (const path of [
      'apps/web/app/operator/workspace.tsx',
      'apps/web/app/operator/authenticator-check.tsx',
      'apps/web/app/operator/operator-entry.tsx',
    ]) {
      const source = read(path);
      expect(source, path).toMatch(/<a\s+className="text-link"\s+href=\{operatorSignInPath\(/);
      expect(source, path).not.toMatch(/<Link[^>]*operatorSignInPath/);
    }
    expect(read('apps/web/app/operator/authenticator-check.tsx')).not.toContain("from 'next/link'");
  });
  it('every other link into operator sign-in is a full page load to the same address', () => {
    const links: [string, string][] = [
      [
        'apps/web/components/account-form.tsx',
        '<a className="text-link" href={operatorSignInPage}>\n            Invited operator sign-in\n          </a>',
      ],
      [
        'apps/web/app/operator/forgot-password/page.tsx',
        '<a className="text-link" href={operatorSignInPage}>\n          Back to operator sign-in\n        </a>',
      ],
      [
        'apps/web/app/operator/error.tsx',
        '<a\n          className="text-link"\n          href={place ? operatorSignInPath(place.workspace, place.section) : operatorSignInPage}\n        >\n          Verify operator access\n        </a>',
      ],
      [
        'apps/web/app/operator/reset-password/page.tsx',
        '<a className="text-link" href={operatorSignInPage}>\n        Back to operator sign-in\n      </a>',
      ],
      [
        'apps/web/app/operator/recovery-form.tsx',
        '<a className="primary-link" href={operatorSignInPage}>\n          Return to operator sign-in\n        </a>',
      ],
      [
        'apps/web/app/operator/setup/page.tsx',
        '<a className="text-link" href={operatorSignInPage}>\n          Operator sign-in and authenticator\n        </a>',
      ],
      [
        'apps/web/app/operator/opportunities.tsx',
        "<a href={operatorSignInPath(tenant, 'workspace-commercial')}>\n            Sign in and verify your authenticator again\n          </a>",
      ],
      [
        'apps/web/app/operator/setup/setup-form.tsx',
        "<a\n          className=\"primary-link\"\n          href={\n            contributor && invite?.workspaceId\n              ? '/operator/signin?next=' +\n                encodeURIComponent('/contributor?workspace=' + invite.workspaceId)\n              : '/operator/signin'\n          }\n        >\n          Sign in and set up authenticator\n        </a>",
      ],
    ];
    for (const [path, link] of links) expect(read(path), path).toContain(link);
    expect(read('apps/web/app/operator/reset-password/page.tsx')).not.toContain("from 'next/link'");
  });
  it('no client-side Link anywhere in the web app goes into operator sign-in', () => {
    const sources = (dir: string): string[] =>
      readdirSync(resolve(dir), { withFileTypes: true }).flatMap((entry) =>
        entry.isDirectory()
          ? ['node_modules', '.next'].includes(entry.name)
            ? []
            : sources(`${dir}/${entry.name}`)
          : /\.tsx?$/.test(entry.name)
            ? [`${dir}/${entry.name}`]
            : [],
      );
    for (const path of sources('apps/web')) {
      const source = read(path);
      // Each whole <Link ...> element, so an href on a later line or inside a ternary is still seen.
      for (const [element] of source.matchAll(/<Link\b[\s\S]*?(?:<\/Link>|\/>)/g))
        // A new tab is a fresh document, and Next Link does not intercept a target other than
        // _self (node_modules/next/dist/client/app-dir/link.js), so target="_blank" is exempt.
        if (!/target="_blank"/.test(element))
          expect(element, path).not.toMatch(/\/operator\/signin|operatorSignIn/);
      expect(source, path).not.toContain('href="/operator/signin"');
    }
  });
});
