import 'server-only';
import { start } from 'workflow/api';
import type { PulseJob } from '@corridra/auth/customer-notifications';
import { deliverPulse } from '../workflows/pulse';
export const pulseOrchestrator = {
  async start(job: PulseJob) {
    return (await start(deliverPulse, [job])).runId;
  },
};
