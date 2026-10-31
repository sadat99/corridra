// Reference kinds a ReferencePicker can search (commercial readiness program, 5.2).
export const pickerKinds = [
  'contributor',
  'source',
  'mission',
  'route',
  'reviewer',
  'publication',
] as const;
export type PickerKind = (typeof pickerKinds)[number];
