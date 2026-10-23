import 'server-only';
import { start } from 'workflow/api';
import type { MissionMailJob } from '@corridra/auth/mission-mail';
import { deliverMissionMail } from '../workflows/mission-mail';
export const missionMailOrchestrator = {
  async start(job: MissionMailJob) {
    return (await start(deliverMissionMail, [job])).runId;
  },
};
