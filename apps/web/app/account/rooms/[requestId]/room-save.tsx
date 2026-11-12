'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { displayDate } from '@corridra/domain/locale';
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
}: {
  reports: RoomReport[];
  subject: string;
  issuer: string;
  onSaved: (assignmentId: string, resourceId: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<AcceptCommand | null>(null);
  const [notice, setNotice] = useState('');
  const [closed, setClosed] = useState<string[]>([]);
  const inFlight = useRef(false);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);

  async function send(command: AcceptCommand) {
    // A second click, or Enter pressed twice, while the first save is on its way sends nothing.
    if (inFlight.current) return;
    inFlight.current = true;
    const task = new AbortController();
    controller.current = task;
    setPending(command);
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
        setPending(null);
        setClosed((ids) => [...ids, command.assignmentId]);
        setNotice('This report is no longer open to you. Nothing was saved.');
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
    void send(
      pending && pending.assignmentId === assignmentId ? pending : acceptCommand(assignmentId),
    );
  }

  const open = reports.filter((report) => !closed.includes(report.assignmentId));
  const many = reports.length > 1;
  return (
    <div className="room-save">
      {open.map((report) =>
        many ? (
          <article className="room-save-item" key={report.assignmentId}>
            <h3 dir="auto">{report.title}</h3>
            <p>Current report access expires {displayDate(report.expiresAt)}.</p>
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
      {pending && !busy && notice === notConfirmed && (
        <button className="primary-link" type="button" onClick={() => void send(pending)}>
          Retry Saving the Same Report
        </button>
      )}
    </div>
  );
}
