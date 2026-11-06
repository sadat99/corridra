import { formatDateTime } from '../../../lib/ux/format';

/**
 * A plain label for each request, from what the request list really returns: an id and when it was sent (the list
 * carries no title). Two requests are told apart by their sent time. Never an id.
 */
export function mutedRequestLabels(
  requests: { id: string; createdAt?: string | null; title?: string | null }[],
): Record<string, string> {
  const labels: Record<string, string> = {};
  for (const request of requests) {
    if (request.title) labels[request.id] = request.title;
    else if (request.createdAt)
      labels[request.id] = 'Request sent ' + formatDateTime(request.createdAt);
  }
  return labels;
}
