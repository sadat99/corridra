export const maximumBranches = 9;
export function assertBranchBudget(existingCount: number) {
  if (!Number.isSafeInteger(existingCount) || existingCount < 0 || existingCount >= maximumBranches)
    throw new Error(
      'Branch budget reached: keep at most nine branches. Retire completed work before creating another branch.',
    );
}
