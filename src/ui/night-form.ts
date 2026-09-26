import {
  BEDTIME_GLUCOSE_LABEL,
  DOSE_LABEL,
  MORNING_UNMEASURED,
  TAKEN_AT_LABEL,
  type NightDraft,
  type NightRow,
} from '../domain/night';
import { formScreen, notice, numberField } from './meal-form';

// The night screen, as a pure function from a draft and the five-night list to a
// DOM subtree. It decides nothing: whether a night may be saved is a rule in
// src/domain, and the Save control lives in the frame.
//
// The list reports and concludes nothing. There is no average here, no trend and
// no suggested dose: the app never recommends one, and five nights side by side
// is exactly as far as it goes.

export const NIGHT_FORM_TITLE = 'Night insulin';

/**
 * The five nights, or why they could not be read. There is deliberately no
 * loading member: the screen is not opened until the nights are in hand, so the
 * list is never a row of empty placeholders that reads as five blank nights.
 */
export type NightHistory =
  | { readonly kind: 'loaded'; readonly rows: readonly NightRow[] }
  | { readonly kind: 'failed'; readonly message: string };

export type NightFormState = {
  readonly draft: NightDraft;
  readonly history: NightHistory;
  /** A refusal or retry message, shown in place with every value still filled in. */
  readonly message: string | null;
};

export type NightFormHandlers = {
  readonly onUnits: (value: string) => void;
  readonly onTakenAt: (value: string) => void;
  readonly onBedtimeGlucose: (value: string) => void;
};

/** A part of a row that exists only because this account recorded it. */
const recorded = (className: string, text: string): HTMLElement => {
  const span = document.createElement('span');
  span.className = className;
  span.setAttribute('data-entry', '');
  span.textContent = text;
  return span;
};

/**
 * The morning reading, banded by LEVEL rather than by change, because the
 * question a basal dose answers is whether you woke up in range. A morning
 * nobody measured is an em dash and carries no band at all: a measurement that
 * was never taken must not be drawn as a value.
 */
const morningCell = (row: NightRow): HTMLElement => {
  if (row.morning === null) {
    const unmeasured = document.createElement('span');
    unmeasured.className = 'night-row__morning night-row__morning--unmeasured';
    unmeasured.textContent = MORNING_UNMEASURED;
    return unmeasured;
  }
  const cell = recorded('night-row__morning', row.morning.text);
  // The band is published by name and the stylesheet binds the colour to it,
  // exactly as the change bands are published on the Today card.
  cell.setAttribute('data-level-band', row.morning.band);
  return cell;
};

const nightRowItem = (row: NightRow): HTMLElement => {
  const item = document.createElement('li');
  item.className = 'night-row';

  // The short date is furniture -- it reads the same for every account -- so it
  // carries no entry mark, while the dose the person recorded does.
  const date = document.createElement('span');
  date.className = 'night-row__date';
  date.textContent = row.date;

  item.append(date, recorded('night-row__dose', row.dose), morningCell(row));
  return item;
};

const nightHistory = (history: NightHistory): HTMLElement => {
  const section = document.createElement('div');
  section.className = 'night-history';

  const heading = document.createElement('h2');
  heading.className = 'form__heading';
  heading.textContent = 'Last five nights';
  section.append(heading);

  if (history.kind === 'failed') {
    // Show the failure and no nights at all, rather than stale ones.
    section.append(notice(history.message));
    return section;
  }

  const list = document.createElement('ul');
  list.className = 'night-history__rows';
  for (const row of history.rows) list.append(nightRowItem(row));
  section.append(list);
  return section;
};

/**
 * The time the dose was taken. Labelled 'Taken at' and not 'Time': 'Time' is a
 * substring of 'Bedtime glucose', so a label match on it would resolve to two
 * fields on this one screen and neither could be filled in reliably.
 */
const takenAtField = (value: string, onInput: (value: string) => void): HTMLElement => {
  const wrapper = document.createElement('div');
  wrapper.className = 'field';

  const id = 'night-taken-at';

  const label = document.createElement('label');
  label.className = 'field__label';
  label.htmlFor = id;
  label.textContent = TAKEN_AT_LABEL;

  const input = document.createElement('input');
  input.className = 'field__input';
  input.id = id;
  input.name = id;
  input.type = 'time';
  input.value = value;
  input.addEventListener('input', () => onInput(input.value));

  wrapper.append(label, input);
  return wrapper;
};

export const nightForm = (state: NightFormState, handlers: NightFormHandlers): HTMLElement => {
  const screen = formScreen('form--night');
  const { draft } = state;

  if (state.message !== null) screen.append(notice(state.message));

  screen.append(
    nightHistory(state.history),
    // The dose is required and comes first; the time and the bedtime glucose are
    // optional, because a person who took their basal and did not measure must
    // still be able to record the dose. Each is a real labelled input, so value 5
    // can add the stepper and the number pad as controls that write into them.
    numberField('night-units', DOSE_LABEL, 'dose', draft.units, handlers.onUnits),
    takenAtField(draft.takenAt, handlers.onTakenAt),
    numberField(
      'night-bedtime-glucose',
      BEDTIME_GLUCOSE_LABEL,
      'glucose',
      draft.bedtimeGlucose,
      handlers.onBedtimeGlucose,
    ),
  );

  return screen;
};
