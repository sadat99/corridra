import type { DatabasePool, RequestContext } from '@corridra/db';

// getTeamToday (commercial readiness program, 5.2, CQ-34, CQ-40, CQ-73). Counts for the team Today
// page. Only submitted requests count as new or overdue (D6); unsent drafts never do. Wave 0 returns
// zeros; WS-D implements it on the existing tables inside withTenant. Owner after Wave 0: WS-D.
export type TeamToday = {
  newSubmittedRequests: number;
  overdueSubmittedRequests: number;
  acceptedQuotesNotStarted: number;
  repliesToReview: number;
  meetingsNextSevenDays: number;
};

export async function getTeamToday(_pool: DatabasePool, _ctx: RequestContext): Promise<TeamToday> {
  void _pool;
  void _ctx;
  return {
    newSubmittedRequests: 0,
    overdueSubmittedRequests: 0,
    acceptedQuotesNotStarted: 0,
    repliesToReview: 0,
    meetingsNextSevenDays: 0,
  };
}
