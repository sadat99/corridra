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

export interface ActionContract {
  id: ActionId;
  intent: {
    phrases: { en: readonly string[]; bn: readonly string[]; zh: readonly string[] };
    synonyms: readonly string[];
  };
  context: readonly ContextKey[];
  inputs: readonly { key: string; required: boolean; reuseFrom?: ContextKey; notSure?: boolean }[];
  /** Every switch and module named here must be on, or the action is hidden. */
  authority: { switches: readonly string[]; modules: readonly string[] };
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
