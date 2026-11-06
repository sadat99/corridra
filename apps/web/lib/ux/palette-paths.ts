/** The address of a mission page, with the chosen workspace kept. */
export function missionPath(id: string, workspace: string): string {
  const query = /^[0-9a-f-]{36}$/i.test(workspace)
    ? '?workspace=' + encodeURIComponent(workspace)
    : '';
  return '/operator/missions/' + encodeURIComponent(id) + query;
}
