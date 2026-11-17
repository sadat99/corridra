// The one action contract that AI and non-AI modes share. Types only: no imports beyond the state types.
import type { StateCopyKey } from './states';

export type { ActionState, StateCopyKey } from './states';

export type ActionId =
  | 'find_request'
  | 'start_sell'
  | 'start_source'
  | 'start_organise'
  | 'continue_draft'
  | 'explain_next'
  | 'explain_blocked'
  | 'ask_team'
  | 'report_problem';

/** What an action may read from the person's situation. */
export type ContextKey = 'workspace' | 'request' | 'draft' | 'page' | 'locale';

/** The switches an action may name. Each has one mapping in gates.ts to the gate that already exists. */
export type ActionSwitchKey = 'delegations';
/** The modules an action may name. Each has one mapping in gates.ts. */
export type ActionModuleKey = 'problem_reports' | 'support_case';

export interface ActionContract {
  id: ActionId;
  /** What the row says and what following it really does, in plain Title Case words. */
  label: string;
  /** True while the destination does not exist yet: the action is never matched or shown until it is built. */
  planned?: true;
  intent: {
    phrases: { en: readonly string[]; bn: readonly string[]; zh: readonly string[] };
    synonyms: readonly string[];
  };
  context: readonly ContextKey[];
  inputs: readonly { key: string; required: boolean; reuseFrom?: ContextKey; notSure?: boolean }[];
  /** Every switch and module named here must be on, or the action is hidden. */
  authority: { switches: readonly ActionSwitchKey[]; modules: readonly ActionModuleKey[] };
  /** The route is a fixed table value, never built from typed text. Empty until the destination exists. */
  service: { kind: 'navigate' | 'command'; route: string };
  confirm: 'none' | 'review' | 'approval';
  persisted: string;
  idempotency: 'commandId' | 'deterministic' | 'none';
  receipt: 'request_ref' | 'case_ref' | 'none';
  failure: Partial<Record<import('./states').ActionState, StateCopyKey>>;
  escalation: { to: 'problem_report' | 'support_case' | 'service_request' | 'none'; paid: boolean };
  ai: { selectable: boolean; fillable: readonly string[] };
}
