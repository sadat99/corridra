// Mute-link tokens for mission emails. One purpose only: muting messages about one request.
// The token is a keyed hash of the request id, so it proves the link is genuine without any
// sign-in. It cannot prove the link was used. Remembering a click needs storage that does not
// exist yet; see docs/product/phase0-mission-email-proposal.md.
import { createHmac, timingSafeEqual } from 'node:crypto';

const purpose = 'mission-mail-mute-v1';
const requestIdPattern = /^[A-Za-z0-9][A-Za-z0-9-]{7,63}$/;

function assertInputs(secret: string, requestId: string) {
  if (typeof secret !== 'string' || secret.length < 32)
    throw new Error('The signing secret must be at least 32 characters');
  if (!requestIdPattern.test(requestId)) throw new Error('The request id is not usable');
}

export function signMissionMailMute(secret: string, requestId: string) {
  assertInputs(secret, requestId);
  return createHmac('sha256', secret).update(`${purpose}:${requestId}`).digest('base64url');
}

export function verifyMissionMailMute(secret: string, requestId: string, token: string) {
  assertInputs(secret, requestId);
  if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token)) return false;
  const expected = Buffer.from(signMissionMailMute(secret, requestId));
  const given = Buffer.from(token);
  return expected.length === given.length && timingSafeEqual(expected, given);
}
