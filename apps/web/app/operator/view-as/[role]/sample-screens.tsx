import { MoveView } from '../../../account/move/move-view';
import { HolderBadge, Road } from '../../../../components/mr';
import { emblemFor } from '../../../../lib/room';
import type { MoveModel } from '../../../../lib/move-cards';
import '../../../account/rooms/[requestId]/room-view.css';

// View as, stage 2 (Lane 9): the real Your Move screen and the Room's header and Road, drawn from fixed
// sample data and placed inside the preview's inert stage, so nothing in them can be pressed, focused or
// sent. The sample is invented here and read from nowhere: no request, no account, no record. This file
// stays a plain server component (the preview folder holds no client code of its own); the real screens
// it draws are imported from where they live.
const sampleMove: MoveModel = {
  cards: [
    {
      id: 'sample-move',
      kind: 'move',
      verb: 'Confirm',
      holder: 'you',
      context: 'Hotel towels for Spain',
      href: '#',
      object: 'the sample size for the first check',
      dueOn: null,
    },
    {
      id: 'sample-draft',
      kind: 'draft',
      verb: 'Add',
      holder: 'you',
      context: 'Packaging suppliers in Germany',
      href: '#',
    },
  ],
  waiting: [
    {
      id: 'sample-waiting',
      holder: 'team',
      kind: 'request',
      title: null,
      status: 'MEETINGS',
      received: '2026-10-02',
      href: '#',
    },
  ],
  replyCandidates: [],
  latest: null,
};

const roomTitle = 'Hotel towels for Spain';

export function SampleScreens() {
  const emblem = emblemFor(roomTitle);
  return (
    <>
      <section className="view-as-card" aria-label="Sample Your Move screen">
        <h2>Sample: Your Move</h2>
        <MoveView model={sampleMove} startHref="#" />
      </section>
      <section className="view-as-card" aria-label="Sample Room">
        <h2>Sample: the Room</h2>
        <header className="room-head">
          <span className="room-emblem" data-tone={emblem.tone} aria-hidden="true">
            {emblem.initials}
          </span>
          <div>
            <h3>{roomTitle}</h3>
            <p>Spain · Received 2 Oct 2026</p>
            <HolderBadge holder="team" />
          </div>
        </header>
        <Road status="MEETINGS" records={{ compare: false, decide: false }} />
      </section>
    </>
  );
}
