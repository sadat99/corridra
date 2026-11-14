// ADR-084 slice S3 (CORRIDRA_DELEGATION_BOARD): ordering for the compact money view. Amounts are exact integer
// strings of minor units and nothing is ever added or compared across two currencies. Whether someone still owes is
// the server's own word for each currency (the status it computed from the exact amounts), never a comparison made
// here, so there is one source for it. Only people who are still active are put first; a participant who withdrew or
// was removed keeps the label and the order read, after the active ones.
export type OwedAmount = {
  currency: string;
  due: string;
  recorded: string;
  status: 'NO_FEE' | 'UNPAID' | 'PART_PAID' | 'PAID' | 'OVERPAID';
};

/** True when, in some one currency, the server says the amount due is not yet fully recorded. */
export function owesInAnyCurrency(amounts: readonly Pick<OwedAmount, 'status'>[]): boolean {
  return amounts.some((amount) => amount.status === 'UNPAID' || amount.status === 'PART_PAID');
}

/**
 * Active participants who still owe first, then the other active participants, then participants who withdrew or were
 * removed; inside each group the order read is kept.
 */
export function owesFirst<
  T extends {
    state: 'ACTIVE' | 'WITHDRAWN' | 'REMOVED';
    amounts: readonly Pick<OwedAmount, 'status'>[];
  },
>(people: readonly T[]): T[] {
  const active = people.filter((person) => person.state === 'ACTIVE');
  const owing = active.filter((person) => owesInAnyCurrency(person.amounts));
  return [
    ...owing,
    ...active.filter((person) => !owing.includes(person)),
    ...people.filter((person) => person.state !== 'ACTIVE'),
  ];
}
