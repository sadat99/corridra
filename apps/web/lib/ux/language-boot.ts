// Before the first paint, the page takes the language and direction the person chose, so Arabic is
// right to left from the start instead of flipping after the page loads (CQ-10, CQ-48). The text
// itself is still swapped by the language provider; this only sets lang and dir on <html>.
// It reads the same browser setting as the language provider and uses only offered languages.
// Owner: WS-E.
import { languageStorageKey, localeMeta, type Locale } from '../i18n/locales';

/** The inline script for the root layout. Offered codes and their meta are fixed at build time. */
export function languageBootScript(offered: readonly Locale[]): string {
  const meta = Object.fromEntries(
    offered.map((code) => [code, [localeMeta[code].html, localeMeta[code].dir]]),
  );
  return `(function(){try{var m=${JSON.stringify(meta)},k=${JSON.stringify(
    languageStorageKey,
  )},c=null;try{c=localStorage.getItem(k)}catch(e){}if(c===null){var l=navigator.languages||[];for(var i=0;i<l.length;i++){var t=String(l[i]).toLowerCase(),p=t.split('-')[0];if(p==='zh'&&!(t==='zh'||/^zh-(cn|sg|hans)(-|$)/.test(t)))continue;if(m[p]){c=p;break}}}var v=c&&m[c];if(!v)return;var d=document.documentElement;d.lang=v[0];d.dir=v[1]}catch(e){}})();`;
}
