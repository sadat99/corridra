import { describe, expect, it } from 'vitest';
import { webManifest } from '../../apps/web/lib/ux/web-manifest';
import {
  offlineCacheName,
  offlinePagePath,
  offlineServiceWorkerScript,
  retiredServiceWorkerScript,
  serviceWorkerOn,
} from '../../apps/web/lib/ux/service-worker';

// The installable application (owner directive, 13 November 2026). The website is unchanged; what is new is
// that a supporting browser can install it, that the installed window stands alone, and that it tells the
// truth when it cannot connect. These checks fail on the code before that work: the manifest said
// `display: browser` with no id or scope, and no service worker existed at all.

describe('the web manifest makes one installable application', () => {
  const value = webManifest;

  it('asks for a standalone window with one stable identity on the owned address', () => {
    expect(value.display).toBe('standalone');
    expect(value.id).toBe('/');
    expect(value.start_url).toBe('/');
    expect(value.scope).toBe('/');
    // No tracking address as the identity or the launch address (nothing to say which campaign opened it).
    for (const address of [value.id, value.start_url, value.scope])
      expect(address).not.toMatch(/[?#]/);
  });

  it('is Corridra, in the approved AC/1 colours and the launch language', () => {
    expect(value.name).toBe('Corridra');
    expect(value.short_name).toBe('Corridra');
    expect(value.background_color).toBe('#f6f8fb');
    expect(value.theme_color).toBe('#142438');
    expect(value.lang).toBe('en');
    expect(value.dir).toBe('ltr');
  });

  it('describes the product without reducing it to one corridor, and invents nothing', () => {
    expect(value.description).toBe('Cross-border market access.');
    expect(value.description).not.toMatch(/Bangladesh|Spain|EU/);
    expect(value.description).not.toMatch(/—/);
  });

  it('offers the existing approved icons, including a maskable one', () => {
    const icons = value.icons ?? [];
    expect(icons.map((icon) => icon.src)).toEqual([
      '/brand/android-chrome-192.png',
      '/brand/android-chrome-512.png',
      '/brand/maskable-512.png',
    ]);
    for (const icon of icons) expect(icon.type).toBe('image/png');
    expect(icons.filter((icon) => icon.purpose === 'any').map((icon) => icon.sizes)).toEqual([
      '192x192',
      '512x512',
    ]);
    expect(icons.filter((icon) => icon.purpose === 'maskable')).toHaveLength(1);
  });

  it('declares no separate application for Sell, Source or Organise and no app store', () => {
    const text = JSON.stringify(value);
    expect(text).not.toMatch(/related_applications|"play"|itunes|app store|google play/i);
    expect(text).not.toMatch(/shortcuts/);
  });
});

describe('the owner setting that governs the worker', () => {
  it('is on in a production build and off everywhere else', () => {
    expect(serviceWorkerOn({ NODE_ENV: 'production' } as NodeJS.ProcessEnv)).toBe(true);
    expect(serviceWorkerOn({ NODE_ENV: 'development' } as NodeJS.ProcessEnv)).toBe(false);
    expect(serviceWorkerOn({ NODE_ENV: 'test' } as NodeJS.ProcessEnv)).toBe(false);
  });

  it('is the recovery path: exactly "false" retires it, any other value leaves it on', () => {
    const production = { NODE_ENV: 'production' } as NodeJS.ProcessEnv;
    expect(serviceWorkerOn({ ...production, CORRIDRA_PWA_SERVICE_WORKER: 'false' })).toBe(false);
    for (const value of ['true', 'FALSE', '0', '', 'off'])
      expect(serviceWorkerOn({ ...production, CORRIDRA_PWA_SERVICE_WORKER: value })).toBe(true);
  });
});

describe('the service worker keeps nothing of the product', () => {
  const script = offlineServiceWorkerScript();

  it('holds one public page and its own stylesheets, in one owned cache', () => {
    expect(offlineCacheName).toBe('corridra-offline-v1');
    expect(offlinePagePath).toBe('/offline');
    // Exactly two things are ever put into the cache: the offline page and a stylesheet of that page.
    const puts = [...script.matchAll(/cache\.put\(([^,]+),/g)].map((match) => match[1].trim());
    expect(puts).toEqual(['OFFLINE', 'href']);
    expect(script).toMatch(/credentials: 'omit'/);
    expect(script).toMatch(/startsWith\('\/_next\/static\/'\)/);
  });

  it('answers only a page the person asked for, and never a request for data', () => {
    expect(script).toMatch(/request\.method !== 'GET'\) return;/);
    expect(script).toMatch(/request\.mode === 'navigate'/);
    expect(script).toMatch(/url\.origin !== self\.location\.origin\) return;/);
    // Nothing else is intercepted: not an API answer, not a page's own data request, not a form being sent.
    expect(script).toMatch(
      /if \(!page && !url\.pathname\.startsWith\('\/_next\/static\/'\)\) return;/,
    );
    expect(script).not.toMatch(/\bPOST\b|background-?sync|SyncManager|indexedDB/i);
  });

  it('stores no answer it receives while someone is using Corridra', () => {
    // The only writes are the two precache puts above; the fetch handler returns the network answer as it is.
    const handler = script.slice(script.indexOf("addEventListener('fetch'"));
    expect(handler).not.toMatch(/cache\.put|caches\.open\(.*\)\.then\(.*put/);
    expect(handler).toMatch(/return await fetch\(request\);/);
  });

  it('retires older caches it owns and never touches another application’s', () => {
    expect(script).toMatch(/key\.startsWith\('corridra-'\) && key !== CACHE/);
  });

  it('can be removed from a browser that already installed it', () => {
    const retired = retiredServiceWorkerScript();
    expect(retired).toMatch(/registration\.unregister\(\)/);
    expect(retired).toMatch(/caches\.delete\(key\)/);
    expect(retired).toMatch(/key\.startsWith\('corridra-'\)/);
    // It does not reload anyone's window, so unsaved work is not discarded by the recovery itself.
    expect(retired).not.toMatch(/client\.navigate|location\.reload/);
    expect(retired).not.toMatch(/addEventListener\('fetch'/);
  });
});
