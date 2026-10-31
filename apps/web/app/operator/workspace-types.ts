// Shared record shapes of the team workspace snapshot (moved from workspace.tsx unchanged).
export type OperatorRecordRow = {
  id: string;
  statement?: string;
  locator?: string;
  status?: string;
  scan_status?: string;
  mime?: string;
  role?: string;
  user_id?: string;
  name?: string | null;
  revoked_at?: string | null;
  type?: string;
  occurred_at?: string;
  aggregate_type?: string;
  aggregate_id?: string;
  actor_id?: string;
  correlation_id?: string;
  version?: number;
  key?: string;
  value?: { enabled: boolean };
};
export type OperatorSnapshot = {
  purpose?: string;
  uploadsConfigured: boolean;
  scanMode: 'required' | 'bypass';
  role: string;
  sources: OperatorRecordRow[];
  claims: OperatorRecordRow[];
  evidence: OperatorRecordRow[];
  facts: OperatorRecordRow[];
};
