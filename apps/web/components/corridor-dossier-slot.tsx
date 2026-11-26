'use client';

import dynamic from 'next/dynamic';

// The sample counterparty dossier is a lazy chunk with its own stylesheet, so /corridors with CORRIDRA_UX_HOME_V43 off
// ships neither (owner, 26 Nov 2026, via the Guardian). The page passes this as the dossier slot only while the switch is on.
const CorridorDossier = dynamic(() => import('./corridor-dossier').then((m) => m.CorridorDossier));

export function CorridorDossierSlot() {
  return <CorridorDossier />;
}
