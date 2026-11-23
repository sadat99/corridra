import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import * as pageMetadataModule from '../../apps/web/lib/ux/page-metadata';

// D-013 (commercial-ready run, 23 Nov 2026): a page that sets its own share title used to lose the share image,
// because Next replaces the whole `openGraph` block of the root layout instead of merging it.
const web = resolve('apps/web');
const load = async (path: string) => await import(/* @vite-ignore */ `../../apps/web/${path}`);
const siteImage = {
  url: '/opengraph-image.png',
  width: 1200,
  height: 630,
  alt: 'Corridra, cross-border market access.',
  type: 'image/png',
};

const ownTitlePages = [
  'how-it-works',
  'trust',
  'institutions',
  'sell',
  'source',
  'enter-market',
  'trade-missions',
] as const;

/** A page that still sets a share title with no image. Fix the page, then delete its line here. */
const pending = ['app/network/page.tsx'];

function tsxFiles(directory: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) out.push(...tsxFiles(path));
    else if (entry.endsWith('.tsx')) out.push(path);
  }
  return out;
}

describe('share image on public pages', () => {
  it('builds a share block that always carries the site image the root layout uses', () => {
    const { pageOpenGraph } = pageMetadataModule as unknown as {
      pageOpenGraph: (title: string, description: string) => unknown;
    };
    expect(pageOpenGraph('T', 'D')).toEqual({
      title: 'T',
      description: 'D',
      type: 'website',
      locale: 'en_GB',
      images: [siteImage],
    });
    // The image, its size and its words are the files the root layout serves.
    const png = readFileSync(join(web, 'app/opengraph-image.png'));
    expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([
      siteImage.width,
      siteImage.height,
    ]);
    expect(readFileSync(join(web, 'app/opengraph-image.alt.txt'), 'utf8').trim()).toBe(
      siteImage.alt,
    );
    const layout = readFileSync(join(web, 'app/layout.tsx'), 'utf8');
    expect(layout).toContain("type: 'website'");
    expect(layout).toContain("locale: 'en_GB'");
  });

  it.each(ownTitlePages)('/%s keeps its own share title and gains the image', async (slug) => {
    const { metadata } = await load(`app/${slug}/page.tsx`);
    const content = (await load('content/public-pages.ts')).publicPages[slug];
    expect(metadata.description).toBe(content.description);
    expect(metadata.openGraph).toMatchObject({
      title: content.title,
      description: content.description,
      images: [siteImage],
    });
  });

  it('gives the access pages the image too', async () => {
    const { accessDoorMetadata } = await load('components/access-page.tsx');
    expect(accessDoorMetadata('team', 'H', 'L').openGraph).toMatchObject({
      title: 'H',
      description: 'L',
      images: [siteImage],
    });
  });

  it('lets no page or shared component set a share title without an image', () => {
    const sources = [...tsxFiles(join(web, 'app')), ...tsxFiles(join(web, 'components'))]
      .map((path) => ({ file: relative(web, path), text: readFileSync(path, 'utf8') }))
      .filter(({ text }) => /\bopenGraph:/.test(text));
    const without = sources
      .filter(({ text }) => !/\bimages:/.test(text) && !/\bpageOpenGraph\(/.test(text))
      // The root layout takes its image from the file beside it.
      .filter(
        ({ file }) =>
          file !== 'app/layout.tsx' || !existsSync(join(web, 'app/opengraph-image.png')),
      )
      .map(({ file }) => file);
    expect(without.sort()).toEqual(pending);
    expect(sources.length).toBeGreaterThan(2);
  });
});
