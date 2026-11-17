import 'server-only';
// CI-U2: the read-only commercial facts service. For the signed-in person and ONE workspace they chose for this
// call, it returns the facts they may reuse, each with its source, provenance and time, and names what is missing
// instead of inventing it. It reads only through the existing session-checked services (the workspace list, the
// organisation profile view and the work-item adapter), so the database's own membership and row-security checks
// decide what is visible. It adds no table, route or write, keeps nothing between calls and does not use the
// intelligence package. Keep PERSON, ACCOUNT, WORKSPACE and REPRESENTATION apart: a verified email is not a verified
// person, a self-reported profile is not a verified company and a role is not authority to represent.
import { readNeonAuthConfig } from '@corridra/config';
import { customerOrganisationProfilesEnabled } from '@corridra/auth/customer-organisation-profiles';
import { customerWorkspacesEnabled } from '@corridra/auth/customer-workspaces';
import { foundations } from '../foundations';
import { neonAuth } from '../neon-auth';
import { loadWorkItems } from '../work-items/load';
import type { WorkFamily } from '../work-items/types';
import type {
  AbsentFact,
  AbsentReason,
  CommercialFact,
  CommercialFactsRefusal,
  CommercialFactsRefusalCode,
  CommercialFactsResult,
  ProfileFactKey,
  RepresentableWorkspace,
  RepresentableWorkspacesResult,
} from './types';

export type * from './types';

// Only readCommercialActor holds this token, so an actor cannot be built from a request body, a header or a
// hand-made object. It is a constant, not a cache: it holds no data.
const fromSessionToken = Symbol('commercial-actor');

/**
 * The signed-in person as the provider reported them on this server, for this request. Its subject and issuer
 * are still only expectations: every read re-checks them against a fresh provider session and refuses on a change.
 */
export class CommercialActor {
  readonly #fromSession: true;
  constructor(
    token: symbol,
    readonly subject: string,
    readonly issuer: string,
    /** Display name as the account holder typed it; unchecked. */
    readonly name: string | null,
    /** Present only when the provider marked the address verified. Proves the address, not the person. */
    readonly verifiedEmail: string | null,
    readonly readAt: string,
  ) {
    if (token !== fromSessionToken)
      throw new Error('A commercial actor comes only from the server-side session');
    this.#fromSession = true;
    Object.freeze(this);
  }
  static issued(value: unknown): value is CommercialActor {
    return typeof value === 'object' && value !== null && #fromSession in value;
  }
}

/** Reads the current provider session on the server. Null when nobody verified is signed in or it cannot be read. */
export async function readCommercialActor(): Promise<CommercialActor | null> {
  const issuer = readNeonAuthConfig()?.NEON_AUTH_BASE_URL;
  const auth = neonAuth();
  if (!issuer || !auth) return null;
  let user: { id?: unknown; name?: unknown; email?: unknown; emailVerified?: unknown } | undefined;
  try {
    const session = await auth.getSession({ query: { disableCookieCache: true } });
    if (!session || session.error) return null;
    user = session.data?.user ?? undefined;
  } catch {
    return null;
  }
  if (!user || typeof user.id !== 'string' || !user.id || user.emailVerified !== true) return null;
  const name = typeof user.name === 'string' ? user.name.trim() || null : null;
  const email = typeof user.email === 'string' ? user.email.trim() || null : null;
  return new CommercialActor(
    fromSessionToken,
    user.id,
    issuer,
    name,
    email,
    new Date().toISOString(),
  );
}

const refusalWords: Record<CommercialFactsRefusalCode, string> = {
  actor_not_from_session: 'These details can only be read for the person signed in on this server.',
  invalid_request: 'Choose one company workspace.',
  not_a_member: 'You are not a current member of that workspace.',
  session_changed: 'Your account changed. Reload before continuing.',
  signed_out: 'Sign in with a verified email to continue.',
  unavailable: 'Company details cannot be read right now.',
};
const refuse = (
  code: CommercialFactsRefusalCode,
  workspaceId: string | null,
): CommercialFactsRefusal => ({ ok: false, code, message: refusalWords[code], workspaceId });

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// A refusal from the session boundary keeps its meaning; anything else is an unreadable source.
function refusalFor(error: unknown): CommercialFactsRefusalCode {
  const status = (error as { status?: unknown } | null)?.status;
  if (status === 409) return 'session_changed';
  if (status === 401 || status === 403) return 'signed_out';
  return 'unavailable';
}

// PostgreSQL insufficient_privilege: the customer functions raise it when the person has no current access.
const accessDenied = (error: unknown) => (error as { code?: unknown } | null)?.code === '42501';

type Services = NonNullable<ReturnType<typeof foundations>>;
async function readyServices(): Promise<Services | null> {
  if (!customerWorkspacesEnabled()) return null;
  const services = foundations();
  if (!services) return null;
  try {
    await services.ready;
  } catch {
    return null;
  }
  return services;
}

type Membership = {
  id: string;
  name: string;
  role: RepresentableWorkspace['role'];
  archived: boolean;
};
async function memberships(
  services: Services,
  actor: CommercialActor,
): Promise<Membership[] | CommercialFactsRefusalCode> {
  try {
    const rows = await services.customerWorkspaces.list(actor.subject, actor.issuer);
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      role: row.role,
      archived: row.archived === true,
    }));
  } catch (error) {
    return refusalFor(error);
  }
}

/** The workspaces the person may choose from, with their role only. Ask "which company?" from this list. */
export async function listRepresentableWorkspaces(
  actor: CommercialActor,
): Promise<RepresentableWorkspacesResult> {
  const fail = (code: CommercialFactsRefusalCode) => {
    const { workspaceId: _omit, ...refusal } = refuse(code, null);
    void _omit;
    return refusal;
  };
  if (!CommercialActor.issued(actor)) return fail('actor_not_from_session');
  const services = await readyServices();
  if (!services) return fail('unavailable');
  const listed = await memberships(services, actor);
  if (typeof listed === 'string') return fail(listed);
  return {
    ok: true,
    workspaces: listed.map((m) => ({
      workspaceId: m.id,
      name: m.name,
      role: m.role,
      archived: m.archived,
    })),
  };
}

const profileKeys: readonly (readonly [ProfileFactKey, string])[] = [
  ['organisation.legalName', 'legalName'],
  ['organisation.countryCode', 'countryCode'],
  ['organisation.website', 'website'],
  ['organisation.commercialRoles', 'commercialRoles'],
  ['organisation.sectors', 'sectors'],
  ['organisation.sizeBand', 'sizeBand'],
  ['organisation.summary', 'summary'],
];
const familyOrder: readonly WorkFamily[] = ['ORGANISE', 'SELL', 'SOURCE'];

/**
 * The facts the signed-in person may reuse for one workspace they chose for this call. The workspace is never
 * remembered: every call names it, and every call re-checks current membership.
 */
export async function loadCommercialFacts(input: {
  actor: CommercialActor;
  workspaceId: string;
}): Promise<CommercialFactsResult> {
  const { actor, workspaceId } = (input ?? {}) as Partial<typeof input>;
  if (!CommercialActor.issued(actor)) return refuse('actor_not_from_session', null);
  const keys = Object.keys(input).sort();
  if (
    keys.length !== 2 ||
    keys[0] !== 'actor' ||
    keys[1] !== 'workspaceId' ||
    typeof workspaceId !== 'string' ||
    !uuid.test(workspaceId)
  )
    return refuse('invalid_request', null);

  const services = await readyServices();
  if (!services) return refuse('unavailable', workspaceId);
  const listed = await memberships(services, actor);
  if (typeof listed === 'string') return refuse(listed, workspaceId);
  // Current membership only (ADR-033, 11 November amendment). A missing workspace and a foreign one look the same.
  const membership = listed.find((m) => m.id === workspaceId);
  if (!membership) return refuse('not_a_member', workspaceId);

  const readAt = new Date().toISOString();
  const facts: CommercialFact[] = [];
  const absent: AbsentFact[] = [];
  const missing = (key: AbsentFact['key'], reason: AbsentReason) =>
    absent.push({ key, reason, workspaceId });

  // Membership: the role as a role. Nothing here establishes authority to represent the company.
  facts.push({
    key: 'membership.role',
    value: membership.role,
    source: { kind: 'workspace_membership', id: workspaceId, version: null },
    provenance: 'MEMBERSHIP',
    asOf: readAt,
    workspaceId,
  });
  missing('representation.authority', 'not_established');

  // Account: as the provider returned it on this server. The email is a verified address, never a verified person.
  const account = { kind: 'account_session' as const, id: actor.subject, version: null };
  if (actor.name)
    facts.push({
      key: 'account.name',
      value: actor.name,
      source: account,
      provenance: 'ACCOUNT_SESSION',
      asOf: actor.readAt,
      workspaceId,
    });
  else missing('account.name', 'not_provided');
  if (actor.verifiedEmail)
    facts.push({
      key: 'account.email',
      value: actor.verifiedEmail,
      source: account,
      provenance: 'VERIFIED_EMAIL',
      asOf: actor.readAt,
      workspaceId,
    });
  else missing('account.email', 'not_provided');
  missing('person.identity', 'not_verified');

  // Organisation profile: the newest self-reported revision of this workspace only (ADR-044). Never verified.
  if (!customerOrganisationProfilesEnabled()) {
    for (const [key] of profileKeys) missing(key, 'module_off');
  } else {
    let view: Awaited<ReturnType<Services['customerOrganisationProfiles']['view']>> | null = null;
    try {
      view = await services.customerOrganisationProfiles.view(
        { workspaceId },
        actor.subject,
        actor.issuer,
      );
    } catch (error) {
      // Lost access between the two reads: fail closed rather than serve facts for a former member. The profile
      // view raises SQLSTATE 42501 when the membership is gone (or changed) at read time.
      const code = refusalFor(error);
      if (code === 'session_changed') return refuse(code, workspaceId);
      const status = (error as { status?: unknown } | null)?.status;
      if (code === 'signed_out' || status === 404 || accessDenied(error))
        return refuse('not_a_member', workspaceId);
    }
    if (view && view.workspaceId !== workspaceId) return refuse('unavailable', workspaceId);
    const profile = view?.profile ?? null;
    if (!view) for (const [key] of profileKeys) missing(key, 'unreadable');
    else if (!profile) for (const [key] of profileKeys) missing(key, 'not_provided');
    else {
      const record = profile as unknown as Record<string, unknown>;
      for (const [key, field] of profileKeys) {
        const value = record[field];
        const text =
          typeof value === 'string' && value.trim()
            ? value
            : Array.isArray(value) && value.length > 0 && value.every((v) => typeof v === 'string')
              ? (value as string[]).slice()
              : null;
        if (text === null) missing(key, 'not_provided');
        else
          facts.push({
            key,
            value: text,
            source: {
              kind: 'organisation_profile_revision',
              id: workspaceId,
              version: profile.version,
            },
            provenance: 'SELF_REPORTED',
            asOf: profile.updatedAt,
            workspaceId,
          });
      }
    }
  }

  // Derived: which of Sell, Source and Organise this workspace's own records belong to. Only the family names
  // are kept; no title, status, id, amount or counterparty leaves the adapter through this service.
  try {
    const list = await loadWorkItems(actor.subject, actor.issuer);
    const own = list.items.filter((item) => item.workspaceId === workspaceId);
    const families = familyOrder.filter((family) => own.some((item) => item.family === family));
    // An own item left UNCLASSIFIED may be one whose detail could not be read (the adapter does not flag it), so
    // its family is unknown: the known families are then a lower bound, and none known is unreadable, not absent.
    const unknownOwn = own.some((item) => item.family === 'UNCLASSIFIED');
    const incomplete =
      unknownOwn || list.partial || list.requestsIncomplete === true || list.skippedWorkspaces > 0;
    if (list.unreadable.length > 0) missing('work.families', 'unreadable');
    else if (families.length === 0)
      missing('work.families', incomplete ? 'unreadable' : 'not_provided');
    else
      facts.push({
        key: 'work.families',
        value: families,
        source: { kind: 'work_items', id: workspaceId, version: null },
        provenance: 'DERIVED',
        asOf: readAt,
        workspaceId,
        ...(incomplete ? { complete: false as const } : {}),
      });
  } catch {
    missing('work.families', 'unreadable');
  }

  return { ok: true, workspaceId, readAt, facts, absent };
}
