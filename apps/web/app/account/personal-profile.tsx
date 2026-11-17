'use client';
import { useCallback, useEffect, useState, type KeyboardEvent, type ReactNode } from 'react';
import { CountrySelect } from '../../components/ux/pickers';
import { Dialog } from '../../components/ux/dialog';
import { ErrorSummary, type FieldError } from '../../components/ux/feedback';
import { countryName } from '../../lib/ux/options';
import { fieldAnchor } from '../../lib/ux/focus';
import { LifecycleErrorLine } from './lifecycle-error-line';
import { lifecycleWords, sessionHeaders } from './workspace-lifecycle-client';

// ADR-086. My Profile on the account Profile tab: the verified email, the name and the person's own optional,
// self-declared details, each edited in place. Nothing is mandatory and nothing is scored. The details are read from and
// saved to /api/customer-personal-profile; the name goes through /api/account/name and is offered only while the server
// says the name change is proven (nameEditable). Copy is written here, as on the rest of the account page.

type ContactMethod = 'EMAIL' | 'IN_APP' | 'NO_PREFERENCE';
type Initials = 'NAME_INITIALS' | 'EMAIL_INITIALS' | 'NONE';
type Details = {
  title?: string | null;
  baseCountry?: string | null;
  interests?: string[];
  contactMethod?: ContactMethod;
  initialsPreference?: Initials;
};
type View = {
  currentVersion: number;
  provenance: 'SELF_REPORTED';
  verified: false;
  profile: (Details & { version: number; updatedAt: string }) | null;
};
type Section = 'name' | 'about' | 'interests' | 'contact';
type Load = 'loading' | 'ready' | 'missing' | 'failed';
type Draft = {
  name: string;
  title: string;
  baseCountry: string | null;
  initialsPreference: Initials;
  interests: string[];
  contactMethod: ContactMethod;
};
type Pending = { section: Section; commandId: string; body: Record<string, unknown> };

const endpoint = '/api/customer-personal-profile';
const words = {
  heading: 'Profile and Identity',
  chip: 'Verified account email',
  notAdded: 'Not added',
  selfDeclared: 'Self-declared: you entered these. Corridra has not checked them.',
  missing: 'Personal details are not available yet.',
  readFailed: 'Your details could not be loaded.',
  saved: 'Saved.',
  conflict: 'This changed in another window. Review the latest and try again.',
  lost: 'We could not confirm the save. Your details may or may not have changed.',
  providerRefused: 'The sign-in service did not accept this name. Your name was not changed.',
  providerDown:
    'We cannot reach the sign-in service. Your name was not changed. Try again in a few minutes.',
  noWorkspace:
    'Personal details need a workspace on this account. Create or join a workspace first.',
  inactive:
    'These details cannot be changed while your account is closed or an erasure request is open.',
  tooMany: 'Too many changes in a short time. Try again in an hour.',
  failed: 'The change could not be saved. Please try again.',
  discardTitle: 'Discard your changes?',
};
const sectionTitle: Record<Section, string> = {
  name: 'Name',
  about: 'About you',
  interests: 'Interests',
  contact: 'How to reach you',
};
const contactWords: Record<ContactMethod, string> = {
  EMAIL: 'Email',
  IN_APP: 'In the app',
  NO_PREFERENCE: 'No preference',
};
const initialsWords: Record<Initials, string> = {
  NAME_INITIALS: 'From your name',
  EMAIL_INITIALS: 'From your email',
  NONE: 'Do not show',
};
const control = /[\u0000-\u001f\u007f]/u;
const interestLimit = 10;
const shownInterests = 5;
const editId = (section: Section) => `profile-${section}-edit`;

function initialsOf(text: string) {
  const parts = text
    .replace(/@.*$/, '')
    .split(/[\s._-]+/)
    .filter(Boolean);
  return parts
    .slice(0, 2)
    .map((part) => part[0]!.toUpperCase())
    .join('');
}
function draftFrom(name: string, details: Details | null): Draft {
  return {
    name,
    title: details?.title ?? '',
    baseCountry: details?.baseCountry ?? null,
    initialsPreference: details?.initialsPreference ?? 'NAME_INITIALS',
    interests: details?.interests ?? [],
    contactMethod: details?.contactMethod ?? 'NO_PREFERENCE',
  };
}
function same(a: Draft, b: Draft, section: Section) {
  if (section === 'name') return a.name.trim() === b.name.trim();
  if (section === 'about')
    return (
      a.title.trim() === b.title.trim() &&
      a.baseCountry === b.baseCountry &&
      a.initialsPreference === b.initialsPreference
    );
  if (section === 'interests') return a.interests.join('\u0001') === b.interests.join('\u0001');
  return a.contactMethod === b.contactMethod;
}
// The whole set of details a save sends: the stored ones with this section's fields replaced.
function detailsFor(stored: Details | null, draft: Draft, section: Section): Details {
  const base: Details = {
    title: stored?.title ?? null,
    baseCountry: stored?.baseCountry ?? null,
    interests: stored?.interests ?? [],
    contactMethod: stored?.contactMethod ?? 'NO_PREFERENCE',
    initialsPreference: stored?.initialsPreference ?? 'NAME_INITIALS',
  };
  if (section === 'about')
    return {
      ...base,
      title: draft.title.trim() || null,
      baseCountry: draft.baseCountry,
      initialsPreference: draft.initialsPreference,
    };
  if (section === 'interests') return { ...base, interests: draft.interests };
  if (section === 'contact') return { ...base, contactMethod: draft.contactMethod };
  return base;
}
function checkDraft(draft: Draft, section: Section): FieldError[] {
  const errors: FieldError[] = [];
  if (section === 'name') {
    const name = draft.name.trim();
    if (name.length < 1 || name.length > 100 || control.test(name))
      errors.push({ field: 'profile-name', message: 'Enter a name of 1 to 100 characters.' });
  }
  if (section === 'about') {
    const title = draft.title.trim();
    if (title.length > 80 || control.test(title))
      errors.push({ field: 'profile-title', message: 'Keep the job title to 80 characters.' });
  }
  return errors;
}

export function PersonalProfile({
  subject,
  issuer,
  name,
  email,
  nameEditable,
}: {
  subject: string;
  issuer: string;
  name: string | null;
  email: string;
  nameEditable: boolean;
}) {
  const headers = sessionHeaders(subject, issuer);
  const [load, setLoad] = useState<Load>('loading');
  const [view, setView] = useState<View | null>(null);
  const [shownName, setShownName] = useState(name ?? '');
  const [editing, setEditing] = useState<Section | null>(null);
  const [draft, setDraft] = useState<Draft>(() => draftFrom(name ?? '', null));
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [errors, setErrors] = useState<FieldError[]>([]);
  const [attempt, setAttempt] = useState(0);
  const [conflict, setConflict] = useState<View | null>(null);
  const [lost, setLost] = useState<Pending | null>(null);
  const [askDiscard, setAskDiscard] = useState(false);
  const [interestText, setInterestText] = useState('');
  const [interestError, setInterestError] = useState('');
  const stored = view?.profile ?? null;

  const read = useCallback(
    async (signal?: AbortSignal): Promise<View | 'missing' | 'failed' | 'session' | 'inactive'> => {
      try {
        const response = await fetch(endpoint, {
          credentials: 'same-origin',
          cache: 'no-store',
          signal,
          headers: sessionHeaders(subject, issuer),
        });
        if (response.status === 503) {
          const answer = (await response.json().catch(() => ({}))) as { code?: string };
          return answer.code === 'module_unavailable' ? 'missing' : 'failed';
        }
        if (response.status === 403) return 'inactive';
        if (response.status === 401 || response.status === 409) return 'session';
        if (!response.ok) return 'failed';
        return (await response.json()) as View;
      } catch {
        return 'failed';
      }
    },
    [subject, issuer],
  );

  const apply = useCallback((result: View | 'missing' | 'failed' | 'session' | 'inactive') => {
    if (result === 'missing') setLoad('missing');
    else if (result === 'failed') setLoad('failed');
    else if (result === 'inactive') {
      setLoad('failed');
      setMessage(words.inactive);
    } else if (result === 'session') {
      setLoad('failed');
      setMessage(lifecycleWords.signInAgain);
    } else {
      setView(result);
      setLoad('ready');
    }
  }, []);

  async function reload() {
    setLoad('loading');
    apply(await read());
  }

  useEffect(() => {
    const controller = new AbortController();
    void read(controller.signal).then((result) => {
      if (!controller.signal.aborted) apply(result);
    });
    return () => controller.abort();
  }, [read, apply]);

  const base = draftFrom(shownName, stored);
  const changed = editing !== null && !same(draft, base, editing);

  function open(section: Section) {
    setDraft(draftFrom(shownName, stored));
    setErrors([]);
    setMessage(null);
    setStatus('');
    setConflict(null);
    setLost(null);
    setInterestText('');
    setInterestError('');
    setEditing(section);
  }
  function close(section: Section | null = editing) {
    setEditing(null);
    setAskDiscard(false);
    setConflict(null);
    setErrors([]);
    if (section) window.setTimeout(() => document.getElementById(editId(section))?.focus(), 0);
  }
  function cancel() {
    if (changed) setAskDiscard(true);
    else close();
  }
  function onKey(event: KeyboardEvent) {
    if (event.key !== 'Escape' || saving) return;
    event.preventDefault();
    cancel();
  }

  // Maps one refusal to its words. Returns true when it was handled.
  function refused(statusCode: number, code: string | undefined, section: Section) {
    if (statusCode === 401 || code === 'account_changed' || code === 'signed_out') {
      setMessage(lifecycleWords.signInAgain);
      return true;
    }
    if (code === 'email_unverified') {
      setMessage(lifecycleWords.signInAgain);
      return true;
    }
    if (code === 'provider_unavailable') setMessage(words.providerDown);
    else if (code === 'provider_refused') setMessage(words.providerRefused);
    else if (code === 'module_unavailable') setMessage(words.missing);
    else if (code === 'no_workspace') setMessage(words.noWorkspace);
    else if (code === 'account_inactive' || code === 'account_closed') setMessage(words.inactive);
    else if (statusCode === 429) setMessage(words.tooMany);
    else if (statusCode === 400)
      setErrors([
        {
          field: section === 'name' ? 'profile-name' : `profile-${section}`,
          message:
            section === 'name' ? 'Enter a name of 1 to 100 characters.' : 'Check these details.',
        },
      ]);
    else setMessage(words.failed);
    return true;
  }

  async function send(next: Pending) {
    setSaving(true);
    setMessage(null);
    setLost(null);
    let response: Response;
    try {
      response = await fetch(next.section === 'name' ? '/api/account/name' : endpoint, {
        method: 'POST',
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ commandId: next.commandId, ...next.body }),
      });
    } catch {
      setSaving(false);
      setLost(next);
      return;
    }
    let answer: { code?: string } = {};
    try {
      answer = (await response.json()) as { code?: string };
    } catch {
      if (response.ok) {
        setSaving(false);
        setLost(next);
        return;
      }
    }
    if (response.ok) {
      if (next.section === 'name') setShownName(String(next.body.name));
      else {
        const latest = await read();
        if (typeof latest === 'object') setView(latest);
      }
      setSaving(false);
      setStatus(words.saved);
      close(next.section);
      return;
    }
    if (answer.code === 'stale') {
      const latest = await read();
      setSaving(false);
      if (typeof latest !== 'object') {
        setMessage(words.conflict);
        return;
      }
      setConflict(latest);
      return;
    }
    setSaving(false);
    if (response.status >= 500 && !answer.code) {
      setLost(next);
      return;
    }
    refused(response.status, answer.code, next.section);
  }

  function save(section: Section) {
    const found = checkDraft(draft, section);
    setAttempt((n) => n + 1);
    setErrors(found);
    if (found.length > 0 || !changed) return;
    const commandId = crypto.randomUUID();
    if (section === 'name') {
      void send({ section, commandId, body: { name: draft.name.trim() } });
      return;
    }
    void send({
      section,
      commandId,
      body: { expectedVersion: view?.currentVersion ?? 0, ...detailsFor(stored, draft, section) },
    });
  }
  function useExisting() {
    if (!conflict || !editing) return;
    const section = editing;
    setView(conflict);
    setConflict(null);
    close(section);
  }
  function saveMine() {
    if (!conflict || !editing) return;
    const latest = conflict.profile ?? null;
    setView(conflict);
    setConflict(null);
    void send({
      section: editing,
      commandId: crypto.randomUUID(),
      body: { expectedVersion: conflict.currentVersion, ...detailsFor(latest, draft, editing) },
    });
  }
  function addInterest() {
    const word = interestText.trim();
    if (word.length < 2 || word.length > 60 || control.test(word)) {
      setInterestError('Use 2 to 60 characters.');
      return;
    }
    if (draft.interests.some((item) => item.toLowerCase() === word.toLowerCase())) {
      setInterestError('You already added this.');
      return;
    }
    if (draft.interests.length >= interestLimit) {
      setInterestError('You can add up to 10.');
      return;
    }
    setDraft({ ...draft, interests: [...draft.interests, word] });
    setInterestText('');
    setInterestError('');
  }

  const preference = stored?.initialsPreference ?? 'NAME_INITIALS';
  const initials =
    preference === 'NONE'
      ? ''
      : preference === 'EMAIL_INITIALS' || !shownName.trim()
        ? initialsOf(email)
        : initialsOf(shownName);

  const valueOr = (text: string | null | undefined) =>
    text && text.trim() ? text : words.notAdded;
  const interests = stored?.interests ?? [];

  function row(section: Section, value: ReactNode, form: ReactNode) {
    const isOpen = editing === section;
    return (
      <div
        className="ux-account-row"
        style={{ justifySelf: 'stretch' }}
        data-section={section}
        onKeyDown={isOpen ? onKey : undefined}
      >
        <h3 id={`profile-${section}-heading`}>{sectionTitle[section]}</h3>
        {isOpen ? (
          <form
            aria-labelledby={`profile-${section}-heading`}
            aria-busy={saving}
            onSubmit={(event) => {
              event.preventDefault();
              save(section);
            }}
          >
            <ErrorSummary errors={errors} attempt={attempt} />
            <fieldset
              disabled={saving || lost !== null}
              style={{ border: 'none', margin: 0, padding: 0 }}
            >
              {form}
            </fieldset>
            {conflict && (
              <div role="alert" className="ux-draft-notice">
                <p>{words.conflict}</p>
                <dl>
                  <dt>Latest saved</dt>
                  <dd>{summary(section, conflict.profile ?? null)}</dd>
                  <dt>What you typed</dt>
                  <dd>{summary(section, detailsFor(null, draft, section))}</dd>
                </dl>
                <div className="ux-account-actions">
                  <button type="button" className="button button-secondary" onClick={useExisting}>
                    Use Existing Details
                  </button>
                  <button type="button" className="primary-link" onClick={saveMine}>
                    Save Mine Instead
                  </button>
                </div>
              </div>
            )}
            {lost && (
              <div role="alert" className="ux-draft-notice">
                <p>{words.lost}</p>
                <button
                  type="button"
                  className="primary-link"
                  disabled={saving}
                  onClick={() => void send(lost)}
                >
                  Check and Try Again
                </button>
              </div>
            )}
            <LifecycleErrorLine message={message} />
            {!conflict && !lost && (
              <div
                className="ux-account-actions"
                style={{ gridAutoFlow: 'column', justifyContent: 'start', alignItems: 'center' }}
              >
                <button type="submit" className="primary-link" disabled={saving || !changed}>
                  {saving ? 'Saving...' : 'Save'}
                </button>
                <button
                  type="button"
                  className="button button-secondary"
                  disabled={saving}
                  onClick={cancel}
                >
                  Cancel
                </button>
              </div>
            )}
          </form>
        ) : (
          <>
            <div>{value}</div>
            <button
              type="button"
              className="button button-secondary"
              aria-label={`Edit ${sectionTitle[section]}`}
              id={editId(section)}
              disabled={editing !== null}
              onClick={() => open(section)}
            >
              Edit
            </button>
          </>
        )}
      </div>
    );
  }
  function summary(section: Section, details: Details | null) {
    if (section === 'about')
      return [
        valueOr(details?.title),
        details?.baseCountry ? countryName(details.baseCountry) : words.notAdded,
      ].join(', ');
    if (section === 'interests')
      return details?.interests?.length ? details.interests.join(', ') : words.notAdded;
    if (section === 'contact') return contactWords[details?.contactMethod ?? 'NO_PREFERENCE'];
    return '';
  }

  const header = (
    <div style={{ display: 'flex', gap: 'var(--space-4)', alignItems: 'center' }}>
      {initials && (
        <span
          aria-hidden="true"
          className="ux-avatar-face"
          style={{
            inlineSize: '3rem',
            blockSize: '3rem',
            borderRadius: 'var(--guided-hero-radius)',
            flex: 'none',
          }}
        >
          {initials}
        </span>
      )}
      <div style={{ display: 'grid', gap: 'var(--space-1)', minWidth: 0 }}>
        <span className="ux-status" data-tone="positive">
          {words.chip}
        </span>
        <p style={{ margin: 0, overflowWrap: 'anywhere' }}>{email}</p>
      </div>
    </div>
  );

  return (
    <section
      className="ux-account-profile ux-account-card"
      aria-labelledby="profile-identity-heading"
      aria-busy={load === 'loading'}
    >
      <h2 id="profile-identity-heading">{words.heading}</h2>
      {header}
      {!nameEditable && shownName && <p>{shownName}</p>}
      {nameEditable &&
        row(
          'name',
          <p>{valueOr(shownName)}</p>,
          <label className="field" htmlFor={fieldAnchor('profile-name')}>
            Your name
            <input
              id={fieldAnchor('profile-name')}
              value={draft.name}
              maxLength={100}
              autoComplete="name"
              aria-invalid={errors.some((e) => e.field === 'profile-name') || undefined}
              aria-describedby="profile-name-help"
              onChange={(event) => setDraft({ ...draft, name: event.target.value })}
            />
            <span id="profile-name-help">Shown to your team and the Corridra team.</span>
          </label>,
        )}
      {load === 'loading' && (
        <div role="status" aria-live="polite" style={{ minBlockSize: 'calc(var(--space-16) * 3)' }}>
          <p>Loading your details...</p>
        </div>
      )}
      {load === 'missing' && <p role="status">{words.missing}</p>}
      {load === 'failed' && (
        <div role="alert">
          <p>{words.readFailed}</p>
          <button type="button" className="button button-secondary" onClick={() => void reload()}>
            Try Again
          </button>
          {!editing && <LifecycleErrorLine message={message} />}
        </div>
      )}
      {load === 'ready' && (
        <>
          {row(
            'about',
            <p>
              {valueOr(stored?.title)}
              <br />
              {stored?.baseCountry ? countryName(stored.baseCountry) : words.notAdded}
            </p>,
            <div style={{ display: 'grid', gap: 'var(--space-3)' }}>
              <label className="field" htmlFor={fieldAnchor('profile-title')}>
                Job title (optional)
                <input
                  id={fieldAnchor('profile-title')}
                  value={draft.title}
                  maxLength={80}
                  autoComplete="organization-title"
                  aria-invalid={errors.some((e) => e.field === 'profile-title') || undefined}
                  onChange={(event) => setDraft({ ...draft, title: event.target.value })}
                />
              </label>
              <CountrySelect
                id={fieldAnchor('profile-country')}
                label="Country you work from (optional)"
                value={draft.baseCountry}
                onChange={(value) => setDraft({ ...draft, baseCountry: value })}
              />
              <label className="field" htmlFor={fieldAnchor('profile-initials')}>
                Initials on your profile (optional)
                <select
                  id={fieldAnchor('profile-initials')}
                  value={draft.initialsPreference}
                  onChange={(event) =>
                    setDraft({ ...draft, initialsPreference: event.target.value as Initials })
                  }
                >
                  {(Object.keys(initialsWords) as Initials[]).map((key) => (
                    <option key={key} value={key}>
                      {initialsWords[key]}
                    </option>
                  ))}
                </select>
              </label>
            </div>,
          )}
          {row(
            'interests',
            interests.length ? (
              <ul
                aria-label="Your interests"
                style={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  gap: 'var(--space-2)',
                  listStyle: 'none',
                  margin: 0,
                  padding: 0,
                }}
              >
                {interests.slice(0, shownInterests).map((item) => (
                  <li key={item} className="ux-status">
                    {item}
                  </li>
                ))}
                {interests.length > shownInterests && (
                  <li
                    className="ux-status"
                    aria-label={`${interests.length - shownInterests} more`}
                  >
                    +{interests.length - shownInterests}
                  </li>
                )}
              </ul>
            ) : (
              <p>{words.notAdded}</p>
            ),
            <div style={{ display: 'grid', gap: 'var(--space-2)' }}>
              <label className="field" htmlFor={fieldAnchor('profile-interest')}>
                Interests (optional)
                <input
                  id={fieldAnchor('profile-interest')}
                  value={interestText}
                  maxLength={60}
                  aria-invalid={interestError ? true : undefined}
                  aria-describedby="profile-interest-help profile-interest-error"
                  onChange={(event) => setInterestText(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      addInterest();
                    }
                  }}
                />
                <span id="profile-interest-help">Up to 10 short words, for example machinery.</span>
              </label>
              <div id="profile-interest-error" role="alert">
                {interestError && <p>{interestError}</p>}
              </div>
              <button
                type="button"
                className="button button-secondary"
                disabled={draft.interests.length >= interestLimit}
                onClick={addInterest}
              >
                Add
              </button>
              <p aria-live="polite">
                {draft.interests.length} of {interestLimit}
              </p>
              <ul
                style={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  gap: 'var(--space-2)',
                  listStyle: 'none',
                  margin: 0,
                  padding: 0,
                }}
              >
                {draft.interests.map((item) => (
                  <li key={item}>
                    <button
                      type="button"
                      className="button button-secondary"
                      aria-label={`Remove ${item}`}
                      style={{
                        minBlockSize: '2.75rem',
                        paddingInline: 'var(--space-3)',
                        gap: 'var(--space-2)',
                      }}
                      onClick={() =>
                        setDraft({ ...draft, interests: draft.interests.filter((w) => w !== item) })
                      }
                    >
                      {item}
                      <span aria-hidden="true">×</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>,
          )}
          {row(
            'contact',
            <p>{contactWords[stored?.contactMethod ?? 'NO_PREFERENCE']}</p>,
            <label className="field" htmlFor={fieldAnchor('profile-contact')}>
              Preferred way to contact you (optional)
              <select
                id={fieldAnchor('profile-contact')}
                value={draft.contactMethod}
                onChange={(event) =>
                  setDraft({ ...draft, contactMethod: event.target.value as ContactMethod })
                }
              >
                <option value="NO_PREFERENCE">No preference</option>
                <option value="EMAIL">Email</option>
                <option value="IN_APP">In the app</option>
              </select>
            </label>,
          )}
          <p>{words.selfDeclared}</p>
        </>
      )}
      <div role="status" aria-live="polite">
        {status && <p>{status}</p>}
      </div>
      <Dialog
        open={askDiscard}
        onClose={() => setAskDiscard(false)}
        title={words.discardTitle}
        returnFocusTo={() => (editing ? document.getElementById(editId(editing)) : null)}
      >
        <div className="ux-dialog-actions">
          <button type="button" className="primary-link" onClick={() => close()}>
            Discard
          </button>
          <button
            type="button"
            className="button button-secondary"
            data-autofocus=""
            onClick={() => setAskDiscard(false)}
          >
            Keep Editing
          </button>
        </div>
      </Dialog>
    </section>
  );
}
