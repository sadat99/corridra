import { withTenant, type DatabasePool, type RequestContext } from '@corridra/db';

// The read-only preview of what a customer, delegate or supplier sees. Stage 1 shows fixed sample
// content only. It reads no customer, delegate, supplier or mission row and starts no session.
export const viewAsRoles = ['customer', 'delegate', 'supplier'] as const;
export type ViewAsRole = (typeof viewAsRoles)[number];
/** Stage 1 builds the customer preview only. The others are refused, and not logged, until built. */
export const viewAsAvailableRoles: readonly ViewAsRole[] = ['customer'];
export function viewAsAvailable(role: ViewAsRole) {
  return viewAsAvailableRoles.includes(role);
}
/** Bumped when the preview's content or rules change, so an audit row says which preview was seen. */
export const viewAsPreviewVersion = 1;

export function viewAsEnabled(env: NodeJS.ProcessEnv = process.env) {
  return env.CORRIDRA_VIEW_AS_ENABLED === 'true';
}
/** Exact match against the fixed list. Anything else is not a preview. */
export function viewAsRole(value: unknown): ViewAsRole | null {
  return typeof value === 'string' && (viewAsRoles as readonly string[]).includes(value)
    ? (value as ViewAsRole)
    : null;
}

export class ViewAsService {
  constructor(private pool: DatabasePool) {}

  /**
   * The audit record is written in the same transaction as the permission and fresh-authenticator
   * checks. If it cannot be written, this throws and nothing is shown.
   */
  open(ctx: RequestContext, role: ViewAsRole) {
    return withTenant(this.pool, ctx, 'viewas.open', async ({ db }) => {
      const result = await db.query('SELECT app.record_view_as_open($1,$2) AS id', [
        role,
        viewAsPreviewVersion,
      ]);
      return result.rows[0].id as string;
    });
  }
}
