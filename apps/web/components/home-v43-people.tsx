'use client';

import { useT } from './language-provider';
import { PlaceWords, placeText } from './place-words';
import { Toggle } from './home-v43-toggle';
import { Eyebrow } from './ux/example-tag';
import { roleIds, v43, type RoleId } from '../lib/home-v43-data';
import { fill } from '../lib/i18n/fill';

// Home page v4.3 "Who uses Corridra?": eight role buttons and a record of what the role brings and gets. The chosen door
// preselects its role until the visitor picks one; a picked role stays across door changes (the reducer's `roleTouched`).
// The roles are tab-reachable buttons, not a roving group, so no arrow key needs mirroring in a right-to-left language.
export function HomeV43People({
  role,
  onRole,
  announce,
}: {
  role: RoleId;
  onRole: (role: RoleId) => void;
  announce: (text: string) => void;
}) {
  const t = useT();
  return (
    <section className="hv43-band hv43-people" id="people" aria-labelledby="people-title">
      <header className="hv43-head">
        <div>
          <Eyebrow>{t(v43('people.eyebrow'))}</Eyebrow>
          <h2 id="people-title">{t(v43('people.title'))}</h2>
        </div>
        <p>{t(v43('people.lead'))}</p>
      </header>
      <div className="hv43-people-grid">
        <div className="hv43-roles" id="who" role="group" aria-label={t(v43('people.group'))}>
          {roleIds.map((id) => (
            <Toggle
              key={id}
              on={role === id}
              onPress={() => {
                onRole(id);
                announce(
                  fill(t(v43('live.chosen')), {
                    item: placeText(t(v43(`people.role.${id}.name`)), t),
                  }),
                );
              }}
            >
              <PlaceWords text={t(v43(`people.role.${id}.name`))} />
            </Toggle>
          ))}
        </div>
        <div className="hv43-record" id="who-panel" role="group" aria-labelledby="who-record-title">
          <h3 id="who-record-title">
            <PlaceWords text={t(v43(`people.role.${role}.name`))} />
          </h3>
          <dl>
            <dt>{t(v43('people.bring'))}</dt>
            <dd>{t(v43(`people.role.${role}.bring`))}</dd>
            <dt>{t(v43('people.get'))}</dt>
            <dd>{t(v43(`people.role.${role}.get`))}</dd>
          </dl>
        </div>
      </div>
    </section>
  );
}
