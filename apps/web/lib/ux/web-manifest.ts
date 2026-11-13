/**
 * What the web manifest says, as plain data, so it can be read by a test without pulling the framework's
 * types into that program. `app/manifest.ts` returns exactly this object and adds nothing.
 *
 * One installed application for the whole product (owner, 13 November 2026): Sell, Source and Organise are
 * areas inside Corridra, never separate installs, so `id` and `start_url` stay at the root of the owned
 * address and carry no query. `display: standalone` is what makes an install open in its own window; the
 * website itself is unchanged and installing is never required to use it. Colours are the AC/1 primitives
 * Porcelain (#f6f8fb) and Midnight Navy (#142438).
 */
export const webManifest = {
  id: '/',
  name: 'Corridra',
  short_name: 'Corridra',
  description: 'Cross-border market access.',
  lang: 'en',
  dir: 'ltr' as const,
  start_url: '/',
  scope: '/',
  display: 'standalone' as const,
  background_color: '#f6f8fb',
  theme_color: '#142438',
  icons: [
    {
      src: '/brand/android-chrome-192.png',
      sizes: '192x192',
      type: 'image/png',
      purpose: 'any' as const,
    },
    {
      src: '/brand/android-chrome-512.png',
      sizes: '512x512',
      type: 'image/png',
      purpose: 'any' as const,
    },
    {
      src: '/brand/maskable-512.png',
      sizes: '512x512',
      type: 'image/png',
      purpose: 'maskable' as const,
    },
  ],
};
