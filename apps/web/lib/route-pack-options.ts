// The fixed choices of the pack lists the guided form and the pack dialogs both draw as boxes. No value imports.
export const packLanguages = [
  ['en', 'English'],
  ['bn', 'Bengali'],
  ['zh', 'Chinese'],
  ['es', 'Spanish'],
  ['ar', 'Arabic'],
  ['fr', 'French'],
  ['de', 'German'],
] as const;
export const packCurrencies = [
  ['BDT', 'Bangladeshi Taka'],
  ['USD', 'US Dollar'],
  ['EUR', 'Euro'],
  ['CNY', 'Chinese Yuan'],
  ['GBP', 'British Pound'],
] as const;
export const packZones = [
  ['Asia/Dhaka', 'Dhaka'],
  ['Europe/Madrid', 'Madrid'],
  ['Asia/Shanghai', 'Shanghai'],
  ['UTC', 'UTC'],
] as const;
export const words = (code: string) => {
  const text = code
    .replace(/[_.-]+/g, ' ')
    .trim()
    .toLowerCase();
  return text ? text[0].toUpperCase() + text.slice(1) : code;
};
