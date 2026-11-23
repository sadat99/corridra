// The error box of a form that judges what was typed before it sends anything. The box must not stay once the person
// starts fixing the field it names (D-040).

/** The fields each problem's words name. Words that name no field, such as a refusal from the server, are left out. */
export type NamedFields<Field extends string> = Readonly<Record<string, readonly Field[]>>;

/**
 * The error box after one field changed: empty when its words name that field, unchanged otherwise. Words that name no
 * field stay until the next submit, so a refusal from the server is not lost on the next keystroke.
 */
export function errorAfterChange<Field extends string>(
  named: NamedFields<Field>,
  error: string,
  changed: Field,
): string {
  return named[error]?.includes(changed) ? '' : error;
}
