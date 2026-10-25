'use client';
import { useEffect, useState } from 'react';
import { maxMoveObject, maxOpenMoves, moveHolders, moveVerbs } from '@corridra/domain/moves';

// Set a Move (ADR-068): the one thing a person must do next, written by the Corridra team about one
// request. Shown only where Move records are switched on. The words are plain and short; the customer
// reads them on Your Move. A new set replaces the open ones; every earlier Move stays in the history.
type Row = {
  id: string;
  verb: string;
  object: string;
  holder: string;
  dueOn: string | null;
  position: number;
  setAt: string;
  closed: null | { outcome: 'DONE' | 'CLEARED'; at: string };
};
type Draft = { verb: string; object: string; holder: string; dueOn: string };
const holderWords: Record<string, string> = {
  customer: 'The person who sent the request',
  team: 'The Corridra team',
  third: 'A supplier or buyer',
};
const blank = (): Draft => ({ verb: 'Add', object: '', holder: 'customer', dueOn: '' });

export function MissionMoves({ tenant, missionId }: { tenant: string; missionId: string }) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [drafts, setDrafts] = useState<Draft[]>([blank()]);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [commandId, setCommandId] = useState(() => crypto.randomUUID());
  const url = `/api/move/staff?tenant=${encodeURIComponent(tenant)}&mission=${encodeURIComponent(missionId)}`;

  const [reload, setReload] = useState(0);
  useEffect(() => {
    let active = true;
    fetch(url, { cache: 'no-store' })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error ?? 'Moves could not be read');
        if (active) setRows(data as Row[]);
      })
      .catch((error) => {
        if (active) setMessage(error instanceof Error ? error.message : 'Moves could not be read');
      });
    return () => {
      active = false;
    };
  }, [url, reload]);

  async function send(body: Record<string, unknown>, done: string) {
    setBusy(true);
    setMessage('');
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ missionId, ...body }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? 'The Move was not saved');
      setMessage(data.replayed ? 'Already saved.' : done);
      setCommandId(crypto.randomUUID());
      setReload((count) => count + 1);
      return true;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'The Move was not saved');
      return false;
    } finally {
      setBusy(false);
    }
  }
  const open = (rows ?? []).filter((row) => !row.closed);
  const closed = (rows ?? []).filter((row) => row.closed);

  return (
    <section className="operator-moves" aria-label="Moves for this request">
      <h4>Moves for the person who sent this request</h4>
      <p>
        A Move is the one thing a person must do next. Use plain words, at most {maxMoveObject}{' '}
        characters, with no links, no amounts and no contact details. Setting new Moves replaces the
        open ones. Every earlier Move stays in the history below.
      </p>
      <p>
        If the person has switched email on, these words are emailed, and kept as a record that is
        never deleted. Never write ID or document numbers, people&apos;s names, or health, legal or
        money details.
      </p>
      {message && <p role="status">{message}</p>}
      {rows === null ? (
        <p>Reading Moves…</p>
      ) : open.length === 0 ? (
        <p className="ux-empty">No open Moves.</p>
      ) : (
        <ul>
          {open.map((row) => (
            <li key={row.id}>
              <strong>
                {row.verb} {row.object}
              </strong>{' '}
              · {holderWords[row.holder] ?? row.holder}
              {row.dueOn ? ` · due ${row.dueOn}` : ''}{' '}
              <button
                type="button"
                className="text-link"
                disabled={busy}
                onClick={() =>
                  void send(
                    { action: 'done', commandId: crypto.randomUUID(), moveId: row.id },
                    'Marked done.',
                  )
                }
              >
                Mark done
              </button>
            </li>
          ))}
        </ul>
      )}
      <form
        className="operator-form"
        onSubmit={(event) => {
          event.preventDefault();
          void send(
            {
              action: 'set',
              commandId,
              moves: drafts.map((draft) => ({
                verb: draft.verb,
                object: draft.object,
                holder: draft.holder,
                dueOn: draft.dueOn || null,
              })),
            },
            'Moves set.',
          ).then((saved) => {
            if (saved) setDrafts([blank()]);
          });
        }}
      >
        {drafts.map((draft, index) => (
          <fieldset key={index} disabled={busy}>
            <legend>Move {index + 1}</legend>
            <label className="field">
              Verb
              <select
                value={draft.verb}
                onChange={(event) =>
                  setDrafts((all) =>
                    all.map((d, i) => (i === index ? { ...d, verb: event.target.value } : d)),
                  )
                }
              >
                {moveVerbs.map((verb) => (
                  <option key={verb}>{verb}</option>
                ))}
              </select>
            </label>
            <label className="field">
              What, in a few words
              <input
                required
                minLength={3}
                maxLength={maxMoveObject}
                value={draft.object}
                onChange={(event) =>
                  setDrafts((all) =>
                    all.map((d, i) => (i === index ? { ...d, object: event.target.value } : d)),
                  )
                }
              />
            </label>
            <label className="field">
              Who holds it
              <select
                value={draft.holder}
                onChange={(event) =>
                  setDrafts((all) =>
                    all.map((d, i) => (i === index ? { ...d, holder: event.target.value } : d)),
                  )
                }
              >
                {moveHolders.map((holder) => (
                  <option key={holder} value={holder}>
                    {holderWords[holder]}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              Real due date (optional)
              <input
                type="date"
                value={draft.dueOn}
                onChange={(event) =>
                  setDrafts((all) =>
                    all.map((d, i) => (i === index ? { ...d, dueOn: event.target.value } : d)),
                  )
                }
              />
            </label>
          </fieldset>
        ))}
        <div className="operator-actions">
          {drafts.length < maxOpenMoves && (
            <button
              type="button"
              className="text-link"
              disabled={busy}
              onClick={() => setDrafts((all) => [...all, blank()])}
            >
              Add another Move
            </button>
          )}
          <button className="primary-link" disabled={busy}>
            Set these Moves
          </button>
          {open.length > 0 && (
            <button
              type="button"
              className="text-link"
              disabled={busy}
              onClick={() =>
                void send({ action: 'clear', commandId: crypto.randomUUID() }, 'Moves cleared.')
              }
            >
              Clear all open Moves
            </button>
          )}
        </div>
      </form>
      {closed.length > 0 && (
        <details>
          <summary>History ({closed.length} closed)</summary>
          <ul>
            {closed.map((row) => (
              <li key={row.id}>
                {row.verb} {row.object} · {row.closed?.outcome === 'DONE' ? 'done' : 'cleared'}{' '}
                {new Date(row.closed!.at).toLocaleDateString()}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
