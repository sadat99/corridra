import type { MetadataRoute } from 'next';

/** Web app manifest. Colours are the AC/1 primitives Porcelain (#f6f8fb) and Midnight Navy (#142438). */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Corridra',
    short_name: 'Corridra',
    description: 'Cross-border market access. Starting with Bangladesh and Spain/EU.',
    start_url: '/',
    display: 'browser',
    background_color: '#f6f8fb',
    theme_color: '#142438',
    icons: [
      { src: '/brand/android-chrome-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/brand/android-chrome-512.png', sizes: '512x512', type: 'image/png' },
      { src: '/brand/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
