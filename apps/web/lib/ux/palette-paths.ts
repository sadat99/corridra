/** The address of a mission page, with the chosen workspace kept. */
export function missionPath(id: string, workspace: string): string {
  const query = /^[0-9a-f-]{36}$/i.test(workspace)
    ? '?workspace=' + encodeURIComponent(workspace)
    : '';
  return '/operator/missions/' + encodeURIComponent(id) + query;
}

/**
 * Where a mission hit opens. The mission page exists only while CORRIDRA_UX_MISSIONS_V2 is on (it answers 404 otherwise);
 * while that is off or not yet known the hit opens the Missions section, whose list always works.
 */
export function missionHitHref(
  missionPages: boolean,
  id: string,
  workspace: string,
  sectionHref: string,
): string {
  return missionPages ? missionPath(id, workspace) : sectionHref;
}
