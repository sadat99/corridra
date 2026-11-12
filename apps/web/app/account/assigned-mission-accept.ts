// The one way a person saves a delivered report: the Library's Delivered list and the Room both call this, so the
// headers, the error words and the receipt check live in one place. The server checks the account, the request and
// the assignment again on every save; nothing here grants access. A save is confirmed only by a receipt that says
// the report is available and not removed; anything else is an error and the screen does not move on.
import { z } from 'zod';
import { savedMissionHeaders, savedMissionRead, type SavedMissionScope } from './saved-missions';

/** One explicit save. Sending the same command again is the same save, never a second one. */
export type AcceptCommand = { commandId: string; assignmentId: string; acknowledged: true };

const receiptSchema = z
  .object({
    id: z.uuid(),
    available: z.boolean(),
    removed: z.boolean(),
    title: z.string().optional(),
    expiresAt: z.string().optional(),
  })
  .strict();

/** A new command for one report, with the acknowledgement the person just gave. */
export function acceptCommand(assignmentId: string): AcceptCommand {
  return { commandId: crypto.randomUUID(), assignmentId, acknowledged: true };
}

/**
 * Sends the save and returns the saved report's id once the receipt confirms it. Throws `denied`, `unavailable`,
 * `limit` or `failed` (as `savedMissionRead` names them); a receipt that is not available, or is removed, is
 * `denied`, and a receipt that does not parse is `failed`.
 */
export async function acceptAssignedMission(
  command: AcceptCommand,
  scope: SavedMissionScope,
  signal?: AbortSignal,
): Promise<string> {
  const raw = await fetch('/api/customer-assigned-missions', {
    method: 'POST',
    cache: 'no-store',
    signal,
    headers: savedMissionHeaders(scope),
    body: JSON.stringify(command),
  }).then(savedMissionRead);
  const parsed = receiptSchema.safeParse(raw);
  if (!parsed.success) throw Error('failed');
  if (!parsed.data.available || parsed.data.removed) throw Error('denied');
  return parsed.data.id;
}
