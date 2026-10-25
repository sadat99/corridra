import { HolderBadge, MoveCard, Road, mrLabels } from '../../../../components/mr';
import { emblemFor } from '../../../../lib/room';
import { fill } from '../../../../lib/i18n/fill';
import { translate, type MessageKey } from '../../../../lib/i18n/messages';
import '../../../account/move/move-view.css';
import '../../../account/rooms/[requestId]/room-view.css';

// View as, stage 2 (Lane 9): the Your Move screen and the Room's header and Road, drawn from fixed sample
// data and placed inside the preview's inert stage, so nothing in them can be pressed, focused or sent.
// The sample is invented here and read from nowhere: no request, no account, no record, and nothing from
// this browser either. The preview holds nothing that can act, so these are the same Move cards, holder
// badges and Road as the real screens, drawn with no link and no button (the real Your Move screen is a
// client component with links and a "forget" button, so it is not used here). This file stays a plain
// server component: the preview folder holds no client code of its own.
const say = (key: MessageKey) => translate('en', key);

const roomTitle = 'Hotel towels for Spain';

export function SampleScreens() {
  const emblem = emblemFor(roomTitle);
  return (
    <>
      <section className="view-as-card" aria-label="Sample Your Move screen">
        <h2>Sample: Your Move</h2>
        <div className="move-view" lang="en" dir="ltr">
          <p className="move-explainer">{mrLabels.move.explainer}</p>
          <section aria-labelledby="sample-move-you">
            <h2 id="sample-move-you">{say('move.you.heading')}</h2>
            <ul className="move-list">
              <li>
                <MoveCard
                  verb="Confirm"
                  object="the sample size for the first check"
                  title="Confirm the sample size for the first check"
                  titleLang="en"
                  holder="you"
                  context="Hotel towels for Spain"
                />
              </li>
              <li>
                <MoveCard
                  verb="Send"
                  object={say('move.card.draft.object')}
                  holder="you"
                  context="Packaging suppliers in Germany"
                />
              </li>
            </ul>
          </section>
          <section aria-labelledby="sample-move-others">
            <h2 id="sample-move-others">{say('move.others.heading')}</h2>
            <ul className="move-list">
              <li className="move-wait">
                <p>
                  <HolderBadge holder="team" />
                </p>
                <p className="move-wait-title">
                  {fill(say('move.received'), { date: '2 Oct 2026' })}
                </p>
                <p>{mrLabels.road.sublines.MEETINGS}</p>
              </li>
            </ul>
          </section>
        </div>
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
