'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { formatMoment } from '../../../../lib/ux/format';
import type { RoomReport } from '../../../../lib/room';
import { limitWords } from '../../../../lib/account-limit';
import {
  acceptAssignedMission,
  acceptCommand,
  type AcceptCommand,
} from '../../assigned-mission-accept';
import { SaveReportForm } from '../../assigned-missions';

const notConfirmed =
  'Saving was not confirmed. Retry the same command or refresh current deliveries.';

/**
 * Saving a delivered report from the Room: the Library's own acknowledgement, unchecked, and its own button, for
 * each report the Room offers. One submit sends one command; a retry of an attempt whose answer was lost sends the
 * same command again, so the server treats it as the same save. Only a confirmed receipt calls `onSaved`.
 */
export function RoomSave({
  reports,
  subject,
  issuer,
  onSaved,
  onRefused,
}: {
  reports: RoomReport[];
  subject: string;
  issuer: string;
  onSaved: (assignmentId: string, resourceId: string) => void;
  /** The server refused this report: it is not open to the person now, and nothing was saved. */
  onRefused: (assignmentId: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  // The unconfirmed command per report, so a retry of any report sends that report's own command again.
  const [pending, setPending] = useState<Record<string, AcceptCommand>>({});
  const [last, setLast] = useState<AcceptCommand | null>(null);
  const [notice, setNotice] = useState('');
  const inFlight = useRef(false);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);

  async function send(command: AcceptCommand) {
    // A second click, or Enter pressed twice, while the first save is on its way sends nothing.
    if (inFlight.current) return;
    inFlight.current = true;
    const task = new AbortController();
    controller.current = task;
    setPending((all) => ({ ...all, [command.assignmentId]: command }));
    setLast(command);
    setBusy(true);
    setNotice('');
    try {
      const resourceId = await acceptAssignedMission(command, { subject, issuer }, task.signal);
      if (!task.signal.aborted) onSaved(command.assignmentId, resourceId);
    } catch (error) {
      if (task.signal.aborted) return;
      const reason = error instanceof Error ? error.message : 'failed';
      if (reason === 'denied') {
        // The server refused: this report is not open to the person now. Nothing was saved.
        setPending((all) =>
          Object.fromEntries(Object.entries(all).filter(([id]) => id !== command.assignmentId)),
        );
        setLast(null);
        onRefused(command.assignmentId);
      } else if (reason === 'limit') setNotice(limitWords);
      else if (reason === 'unavailable')
        setNotice('Account mission delivery is unavailable. Nothing was saved.');
      else setNotice(notConfirmed);
    } finally {
      if (!task.signal.aborted) {
        inFlight.current = false;
        setBusy(false);
      }
    }
  }

  function submit(event: FormEvent<HTMLFormElement>, assignmentId: string) {
    event.preventDefault();
    // The same report again after an unconfirmed attempt is the same command; another report is a new one.
    void send(pending[assignmentId] ?? acceptCommand(assignmentId));
  }

  const many = reports.length > 1;
  return (
    <div className="room-save">
      {reports.map((report) =>
        many ? (
          <article className="room-save-item" key={report.assignmentId}>
            <h3 dir="auto">{report.title}</h3>
            <p>Current report access expires {formatMoment(report.expiresAt)}.</p>
            <SaveReportForm busy={busy} onSave={(e) => submit(e, report.assignmentId)} />
          </article>
        ) : (
          <SaveReportForm
            key={report.assignmentId}
            busy={busy}
            onSave={(e) => submit(e, report.assignmentId)}
          />
        ),
      )}
      {notice && <p role="status">{notice}</p>}
      {last && !busy && notice === notConfirmed && (
        <button className="primary-link" type="button" onClick={() => void send(last)}>
          Retry Saving the Same Report
        </button>
      )}
    </div>
  );
}
