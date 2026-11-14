// ADR-084 slice S3 (CORRIDRA_DELEGATION_BOARD): ordering for the compact money view. Amounts are exact integer
// strings of minor units; every comparison uses BigInt, never a Number, and nothing is ever added or compared
// across two currencies. A participant "owes" when, in some one currency, the amount due is more than the amount
// the organiser recorded.
export type OwedAmount = { currency: string; due: string; recorded: string };

export function owesInAnyCurrency(amounts: readonly OwedAmount[]): boolean {
  return amounts.some((amount) => BigInt(amount.due) > BigInt(amount.recorded));
}

/** Who still owes something first; the order of everyone else, and within each group, is kept as read. */
export function owesFirst<T extends { amounts: readonly OwedAmount[] }>(people: readonly T[]): T[] {
  const owing = people.filter((person) => owesInAnyCurrency(person.amounts));
  return [...owing, ...people.filter((person) => !owing.includes(person))];
}
