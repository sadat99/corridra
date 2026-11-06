// The sentence a route sends, with the code archived, when a new request, invitation or registration meets an archived
// workspace. Null for any other answer, so the caller keeps its own handling. The body is read from a copy.
export async function archivedRefusalText(response: Response): Promise<string | null> {
  if (response.status !== 409) return null;
  const body = (await response
    .clone()
    .json()
    .catch(() => null)) as { error?: unknown; code?: unknown } | null;
  return body?.code === 'archived' && typeof body.error === 'string' ? body.error : null;
}
