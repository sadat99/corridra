import type { MetadataRoute } from 'next';
import { webManifest } from '../lib/ux/web-manifest';

/** The web app manifest. Its words and colours are in `lib/ux/web-manifest.ts`, which this returns as it is. */
export default function manifest(): MetadataRoute.Manifest {
  return webManifest;
}
