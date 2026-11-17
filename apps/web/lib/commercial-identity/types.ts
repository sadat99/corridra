// Shapes of the read-only commercial facts service (CI-U2). A fact is one value the signed-in person may reuse for
// ONE workspace they chose, with where it came from and how it is known. Nothing here is a verification: a
// self-reported profile stays self-reported, a verified email proves the address only, and a membership role is not
// authority to represent the company.

/**
 * How a value is known. There is deliberately no plain "VERIFIED".
 * - SELF_REPORTED: typed by a member of the workspace (organisation profile, ADR-044).
 * - VERIFIED_EMAIL: the provider confirmed this email address. It says nothing about the person.
 * - ACCOUNT_SESSION: read from the signed-in account as the provider returns it, unchecked.
 * - MEMBERSHIP: the person's current role in the workspace. A role is not authority to represent.
 * - DERIVED: computed by Corridra from the workspace's own records.
 */
export type FactProvenance =
  'SELF_REPORTED' | 'VERIFIED_EMAIL' | 'ACCOUNT_SESSION' | 'MEMBERSHIP' | 'DERIVED';

export type FactSourceKind =
  'organisation_profile_revision' | 'workspace_membership' | 'account_session' | 'work_items';

/** The record a fact was read from: its kind, its id and, when the record is versioned, the version read. */
export type FactSource = { kind: FactSourceKind; id: string; version: number | null };

export type ProfileFactKey =
  | 'organisation.legalName'
  | 'organisation.countryCode'
  | 'organisation.website'
  | 'organisation.commercialRoles'
  | 'organisation.sectors'
  | 'organisation.sizeBand'
  | 'organisation.summary';

export type CommercialFactKey =
  ProfileFactKey | 'membership.role' | 'account.name' | 'account.email' | 'work.families';

/** Keys that are always reported absent by this service, so no caller mistakes silence for a yes. */
export type UnestablishedKey = 'person.identity' | 'representation.authority';

export type CommercialFact = {
  key: CommercialFactKey;
  value: string | readonly string[];
  source: FactSource;
  provenance: FactProvenance;
  /** ISO time the value is known from: the revision time for a profile, otherwise the read time. */
  asOf: string;
  /** The one workspace the facts were requested for. */
  workspaceId: string;
  /** Set when the value was computed from a list longer than the pages read: a lower bound, not the whole. */
  partial?: true;
};

/**
 * Why a value is not given.
 * - not_provided: nobody has entered it.
 * - not_verified: Corridra has no verification of it.
 * - not_established: nothing in Corridra establishes it (authority to represent).
 * - module_off: the module that holds it is switched off.
 * - unreadable: the module is on and the read failed; the value may exist.
 */
export type AbsentReason =
  'not_provided' | 'not_verified' | 'not_established' | 'module_off' | 'unreadable';

export type AbsentFact = {
  key: CommercialFactKey | UnestablishedKey;
  reason: AbsentReason;
  workspaceId: string;
};

export type CommercialFactsRefusalCode =
  /** The actor was not produced by readCommercialActor from the server-side session. */
  | 'actor_not_from_session'
  /** The request carried anything other than one well-formed workspace id. */
  | 'invalid_request'
  /** The person is not a current member of that workspace (or it does not exist; the two are not told apart). */
  | 'not_a_member'
  /** The signed-in account is no longer the one the actor was read for. */
  | 'session_changed'
  /** Signed out or unverified at read time. */
  | 'signed_out'
  /** Workspaces are switched off, the services are missing or a read failed. */
  | 'unavailable';

export type CommercialFactsRefusal = {
  ok: false;
  code: CommercialFactsRefusalCode;
  message: string;
  workspaceId: string | null;
};

export type CommercialFacts = {
  ok: true;
  workspaceId: string;
  readAt: string;
  facts: CommercialFact[];
  absent: AbsentFact[];
};

export type CommercialFactsResult = CommercialFacts | CommercialFactsRefusal;

/** A workspace the person can be asked to choose. The role is shown as a role, never as authority to represent. */
export type RepresentableWorkspace = {
  workspaceId: string;
  name: string;
  role: 'owner' | 'admin' | 'member';
  archived: boolean;
};

export type RepresentableWorkspacesResult =
  { ok: true; workspaces: RepresentableWorkspace[] } | Omit<CommercialFactsRefusal, 'workspaceId'>;
