import { sendWithStepUp } from '../../lib/ux/step-up';
import {
  checkOutcome,
  exportFileName,
  exportRoutes,
  sheetOutcome,
  type CheckOutcome,
  type SaveOutcome,
  type SheetBody,
} from '../../lib/route-pack-editor-sheet';

// ADR-093 Phase 3, PR 4: the requests of Import Route Data and Export Route Data. Every import request (the check and the
// save) runs inside sendWithStepUp: a save needs a fresh authenticator check (config.manage), so a 401 STEP_UP_REQUIRED opens
// the check in place and the same body, with the same save id, is sent once more after the code is accepted. The refused send
// wrote nothing, so sending it again cannot save twice. A check closed without a code comes back as `stepUp`, and the dialog
// keeps the file, its save id and the reason. The export is a plain read (missions.read).
const base = '/api/team-control';
const send = (tenant: string, body: SheetBody) =>
  sendWithStepUp(() =>
    fetch(`${base}/route-pack-import?${new URLSearchParams({ tenant })}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );
async function jsonOf(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

/** The check (dry run): writes nothing. */
export async function checkSheet(
  tenant: string,
  body: Extract<SheetBody, { mode: 'dry-run' }>,
): Promise<CheckOutcome> {
  try {
    const response = await send(tenant, body);
    return checkOutcome(response.status, await jsonOf(response));
  } catch {
    return { kind: 'failed' };
  }
}

/** The save: one request with one save id; the answer lists each route. */
export async function saveSheet(
  tenant: string,
  body: Extract<SheetBody, { mode: 'save' }>,
): Promise<SaveOutcome> {
  try {
    const response = await send(tenant, body);
    return sheetOutcome(response.status, await jsonOf(response));
  } catch {
    return { kind: 'offline' };
  }
}

/** Puts a text in the person's downloads under a name, through a link that is clicked once and removed. */
export function downloadText(name: string, text: string) {
  downloadBlob(name, new Blob([text], { type: 'text/csv;charset=utf-8' }));
}
/** The same for bytes as they came: nothing is decoded, so the byte order mark and every character stay exactly. */
function downloadBlob(name: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** The export: the file the server makes, under the name it gives (route-packs-YYYY-MM-DD.csv). */
export async function downloadExport(
  tenant: string,
  keys: readonly string[],
): Promise<{ ok: true; name: string } | { ok: false }> {
  try {
    const response = await fetch(
      `${base}/route-pack-export?${new URLSearchParams({ tenant, routes: exportRoutes(keys) })}`,
      { cache: 'no-store' },
    );
    if (!response.ok || !(response.headers.get('content-type') ?? '').startsWith('text/csv'))
      return { ok: false };
    const name = exportFileName(response.headers.get('content-disposition'));
    if (!name) return { ok: false };
    // The bytes as the server sent them: text() would drop the byte order mark spreadsheets need to read UTF-8.
    downloadBlob(
      name,
      new Blob([await response.arrayBuffer()], { type: 'text/csv;charset=utf-8' }),
    );
    return { ok: true, name };
  } catch {
    return { ok: false };
  }
}
