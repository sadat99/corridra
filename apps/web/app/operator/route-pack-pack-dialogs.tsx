'use client';
import { useId, useState } from 'react';
import { FieldError } from '../../components/field-error';
import { ChoiceButton, ChoiceRow } from '../../components/ux/choice-chip';
import {
  listOptions,
  manualOf,
  packStatusOrder,
  sameAsPack,
  isKeyListKey,
  isListKey,
  type ListKey,
  type PackEdit,
  type SettingKey,
} from '../../lib/route-pack-editor-pack';
import {
  changeRow,
  changedLine,
  noneWords,
  nowStatus,
  nowValue,
  packWords,
  statusLine,
} from './route-pack-pack-words';
import { packCurrencies, packLanguages, packZones, words } from './review-settings';
import { KeyListEntry } from './route-pack-key-list';
import { PackDialog, PendingCaution, type PackDone } from './route-pack-pack-publish';
import './route-pack-pack.css';

// ADR-093 Phase 3, PR 3b: the three pack dialogs, each a thin wrapper around PackDialog (spec 8.9, 11.3, 11.5), and the two
// buttons that open them. Pending Core only warns: it never blocks a status choice.

type PackRead = {
  version: number;
  status: string;
  configuration: Record<string, unknown> | null;
};
type Shared = {
  open: boolean;
  tenant: string;
  routeId: string;
  labelOf: (key: string) => string;
  onClose: () => void;
  onDone: (done: PackDone) => void;
  onReload: () => void;
  returnFocusTo?: () => HTMLElement | null;
};

const listOf = (configuration: Record<string, unknown> | null, key: string): string[] => {
  const value = configuration?.[key];
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
};

export function ChangePackSettingDialog(
  props: Shared & {
    settingKey: SettingKey;
    label: string;
    pack: PackRead | null;
    missionChoices: readonly string[];
  },
) {
  const { settingKey, label, pack, open } = props;
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const configuration = pack?.configuration ?? null;
  const [list, setList] = useState<string[]>([]);
  const [manual, setManual] = useState(false);
  // The draft starts from the pack each time the dialog opens.
  const [openedFor, setOpenedFor] = useState<string | null>(null);
  const openKey = open ? settingKey : null;
  if (openKey !== openedFor) {
    setOpenedFor(openKey);
    if (openKey) {
      setList(settingKey === 'channels' ? [] : listOf(configuration, settingKey));
      setManual(manualOf(configuration?.channels as string[] | undefined));
    }
  }

  const fixed: readonly (readonly [string, string])[] =
    settingKey === 'missionTypes'
      ? props.missionChoices.map((key) => [key, words(key)] as const)
      : settingKey === 'languages'
        ? packLanguages
        : settingKey === 'currencies'
          ? packCurrencies
          : settingKey === 'timeZones'
            ? packZones
            : [];
  const current = settingKey === 'channels' ? [] : listOf(configuration, settingKey);
  const options = listOptions(fixed, current);
  const nameOf = (value: string) => options.find(([key]) => key === value)?.[1] ?? value;
  const join = (values: string[]) => (values.length ? values.map(nameOf).join(', ') : noneWords);

  const edit: PackEdit =
    settingKey === 'channels'
      ? { kind: 'channel', manual }
      : { kind: 'list', key: settingKey as ListKey, value: list };
  const missingType = settingKey === 'missionTypes' && list.length === 0;
  const unchanged = sameAsPack(edit, configuration, pack?.status ?? null);
  const nextOff = missingType
    ? packWords.missionTypesNeeded
    : unchanged
      ? packWords.changeValueFirst
      : null;
  const toggle = (value: string, on: boolean) =>
    setList((now) =>
      on ? [...now.filter((item) => item !== value), value] : now.filter((item) => item !== value),
    );

  const nowText =
    settingKey === 'channels'
      ? manualOf(configuration?.channels as string[] | undefined)
        ? packWords.manualYes
        : packWords.manualNo
      : current.length
        ? join(current)
        : null;

  const stepOne = (
    <div className="route-pack-step">
      <p className="route-edit-quiet">{nowValue(nowText)}</p>
      {pack ? null : <p className="route-edit-quiet">{packWords.startsDraft}</p>}
      {settingKey === 'channels' ? (
        <label className="ux-check">
          <input
            type="checkbox"
            checked={manual}
            onChange={(event) => setManual(event.target.checked)}
          />{' '}
          {packWords.manualChannel}
        </label>
      ) : isKeyListKey(settingKey) ? (
        <KeyListEntry label={label} value={list} onChange={setList} />
      ) : isListKey(settingKey) ? (
        <fieldset
          className="route-pack-boxes"
          aria-describedby={missingType ? `${id}-needed` : undefined}
        >
          <legend>{label}</legend>
          {options.map(([value, text]) => (
            <label key={value} className="ux-check">
              <input
                type="checkbox"
                value={value}
                checked={list.includes(value)}
                aria-invalid={missingType ? true : undefined}
                onChange={(event) => toggle(value, event.target.checked)}
              />{' '}
              {text}
            </label>
          ))}
          {missingType ? (
            <FieldError id={`${id}-needed`}>{packWords.missionTypesNeeded}</FieldError>
          ) : null}
        </fieldset>
      ) : null}
    </div>
  );

  return (
    <PackDialog
      open={open}
      title={packWords.changeSettingTitle}
      tenant={props.tenant}
      routeId={props.routeId}
      packVersion={pack?.version ?? null}
      edit={nextOff ? null : edit}
      nextOff={nextOff}
      stepWords={packWords.stepValue}
      stepOne={stepOne}
      primary={packWords.publishPack}
      summary={() =>
        settingKey === 'channels'
          ? [
              changedLine(
                label,
                manualOf(configuration?.channels as string[] | undefined)
                  ? packWords.manualYes
                  : packWords.manualNo,
                manual ? packWords.manualYes : packWords.manualNo,
              ),
            ]
          : [changedLine(label, join(current), join(list))]
      }
      labelOf={props.labelOf}
      onClose={props.onClose}
      onDone={props.onDone}
      onReload={props.onReload}
      returnFocusTo={props.returnFocusTo}
    />
  );
}

export function ChangePackStatusDialog(
  props: Shared & {
    pack: PackRead;
    pendingCoreLabels: string[];
    statusWords: (status: string) => string;
  },
) {
  const { pack, open } = props;
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const [chosen, setChosen] = useState<string | null>(null);
  // Each opening starts with nothing chosen (state adjusted while rendering, not in an effect).
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setChosen(null);
  }
  const picked = packStatusOrder.find((status) => status === chosen && status !== pack.status);
  const edit: PackEdit | null = picked ? { kind: 'status', status: picked } : null;

  const stepOne = (
    <div className="route-pack-step">
      <p className="route-edit-quiet">{nowStatus(props.statusWords(pack.status))}</p>
      <p className="sr-only" id={`${id}-q`}>
        {packWords.changeStatusTitle}
      </p>
      <ChoiceRow labelledBy={`${id}-q`}>
        {packStatusOrder.map((status) => {
          const here = status === pack.status;
          return (
            <ChoiceButton
              key={status}
              chosen={picked === status}
              disabled={here}
              onClick={() => setChosen(status)}
            >
              {props.statusWords(status)}
              {here ? ` · ${packWords.now}` : ''}
            </ChoiceButton>
          );
        })}
      </ChoiceRow>
      {picked === 'LIMITED' || picked === 'ACTIVE' ? (
        <PendingCaution labels={props.pendingCoreLabels} />
      ) : null}
    </div>
  );

  return (
    <PackDialog
      open={open}
      title={packWords.changeStatusTitle}
      tenant={props.tenant}
      routeId={props.routeId}
      packVersion={pack.version}
      edit={edit}
      nextOff={edit ? null : packWords.pickStatusFirst}
      stepWords={packWords.stepStatus}
      stepOne={stepOne}
      primary={packWords.publishStatus}
      summary={() => [
        statusLine(props.statusWords(pack.status), props.statusWords(picked ?? pack.status)),
        packWords.settingsKept,
      ]}
      labelOf={props.labelOf}
      onClose={props.onClose}
      onDone={props.onDone}
      onReload={props.onReload}
      returnFocusTo={props.returnFocusTo}
    />
  );
}

export function RemoveSourcingDialog(props: Shared & { pack: PackRead }) {
  return (
    <PackDialog
      open={props.open}
      title={packWords.removeSourcingTitle}
      tenant={props.tenant}
      routeId={props.routeId}
      packVersion={props.pack.version}
      edit={{ kind: 'removeSourcing' }}
      nextOff={null}
      stepWords=""
      statement={<p>{packWords.removeStatement}</p>}
      primary={packWords.removeSourcing}
      noChangeWords={packWords.noSourcing}
      summary={() => [packWords.sourcingRemoved]}
      labelOf={props.labelOf}
      onClose={props.onClose}
      onDone={props.onDone}
      onReload={props.onReload}
      returnFocusTo={props.returnFocusTo}
    />
  );
}

export function PackRowButton({
  kind,
  label,
  onOpen,
}: {
  kind: 'change' | 'removeSourcing';
  label: string;
  onOpen: () => void;
}) {
  const text = kind === 'change' ? changeRow(label) : packWords.removeSourcing;
  return (
    <button
      type="button"
      className="text-link route-pack-row-button"
      data-pack-key={kind === 'change' ? label : 'removeSourcing'}
      aria-label={text}
      onClick={onOpen}
    >
      {/* Like Edit: one short word in the state line, the field named in the accessible name. */}
      {kind === 'change' ? packWords.change : packWords.remove}
    </button>
  );
}

export function ChangePackStatusButton({ onOpen }: { onOpen: () => void }) {
  return (
    <button type="button" className="button-secondary route-pack-status-button" onClick={onOpen}>
      {packWords.changeStatusTitle}
    </button>
  );
}
