import 'server-only';
import { start } from 'workflow/api';
import type { DurableOrchestrator } from '@corridra/workflows';
import { deliverCommunication } from '../workflows/communications';
export const communicationOrchestrator: DurableOrchestrator = {
  async start(messageId) {
    return (await start(deliverCommunication, [messageId])).runId;
  },
};
