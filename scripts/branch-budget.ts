export const maximumBranches = 10;
export function assertBranchBudget(existingCount: number) {
  if (!Number.isSafeInteger(existingCount) || existingCount < 0 || existingCount >= maximumBranches)
    throw new Error(
      'Branch budget reached: keep at most ten branches. Retire completed work before creating another branch.',
    );
}
