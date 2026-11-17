// One place that says which existing gate each action key stands for. Pure: the caller reads the real gates
// (server side) and passes the answers in, so this folder imports no server code and reads no environment.
import type { MatchContext } from './match';

/** The real gate behind each key, for the reader and for the UI unit that wires it. */
export const gateSources = {
  delegations: 'customerProgrammesEnabled() from @corridra/auth/customer-programmes',
  problem_reports: 'problemReportsOffered() from apps/web/lib/problem-reports-offered.ts',
  support_case: 'none yet: the support-case module does not exist, so this is always false',
} as const;

export type GateKey = keyof typeof gateSources;

export type GateAnswers = {
  /** customerProgrammesEnabled(). */
  programmesEnabled: boolean;
  /** await problemReportsOffered(). */
  problemReportsOffered: boolean;
  hasWorkspace: boolean;
};

/** Builds the matcher context from the real gate answers. support_case is false until C1-U4 builds that module. */
export function contextFromGates(answers: GateAnswers): MatchContext {
  return {
    switches: { delegations: answers.programmesEnabled },
    modules: { problem_reports: answers.problemReportsOffered, support_case: false },
    hasWorkspace: answers.hasWorkspace,
  };
}
