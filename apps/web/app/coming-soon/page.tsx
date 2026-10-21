import { permanentRedirect } from 'next/navigation';

/** The original launch page is retired. Old links and bookmarks go to the current home page. */
export default function ComingSoon() {
  permanentRedirect('/');
}
