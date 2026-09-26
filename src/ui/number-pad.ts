import type { ReadingChip } from '../domain/recent-readings';
import {
  appendDigit,
  chipValue,
  CLEARED,
  deleteLastDigit,
  DIGITS,
} from '../domain/number-entry';

// The in-app number pad: a thumb-sized way to key a glucose reading on a phone,
// where the system keyboard is neither.
//
// The pad writes into the very input the form already declared. It does not own
// a display of its own and it does not replace the field: the field keeps its
// label, keeps its value and stays editable, so a hardware keyboard still works
// and everything built on that field goes on working. Every key here is one of
// the rules in src/domain/number-entry applied to the field's current value.

export const NUMBER_PAD_LABEL = 'Number pad';

export type NumberPadHandlers = {
  /** The field's value changed, so the draft behind it has to hear about it. */
  readonly onValue: (value: string) => void;
  /** Done: close the pad and leave the value where it is. */
  readonly onDone: () => void;
};

const padButton = (
  className: string,
  name: string,
  onPress: () => void,
): HTMLButtonElement => {
  const button = document.createElement('button');
  button.className = className;
  button.type = 'button';
  button.textContent = name;
  // The press must not take focus off the field the pad is writing into: a key
  // is a way of typing, not a way of leaving.
  button.addEventListener('mousedown', (event) => event.preventDefault());
  button.addEventListener('click', () => onPress());
  return button;
};

/**
 * The pad for one field. It is handed the input itself, so a key is a change to
 * that field's value and nothing has to be mirrored or redrawn; the screen is
 * rebuilt only when the pad opens or closes.
 */
export const numberPad = (
  field: HTMLInputElement,
  chips: readonly ReadingChip[],
  handlers: NumberPadHandlers,
): HTMLElement => {
  const pad = document.createElement('div');
  pad.className = 'number-pad';
  pad.setAttribute('role', 'group');
  pad.setAttribute('aria-label', NUMBER_PAD_LABEL);

  const put = (value: string): void => {
    field.value = value;
    handlers.onValue(value);
  };

  if (chips.length > 0) {
    const row = document.createElement('div');
    row.className = 'number-pad__chips';
    for (const chip of chips) {
      // A chip replaces the value and leaves the pad open, so a mistaken tap is
      // one Clear away. It repeats a reading the person already took; it is not
      // a suggestion and nothing here is derived from it.
      row.append(
        padButton('number-pad__chip', chip.label, () => put(chipValue(chip.value))),
      );
    }
    pad.append(row);
  }

  const keys = document.createElement('div');
  keys.className = 'number-pad__keys';
  for (const digit of DIGITS) {
    keys.append(padButton('number-pad__key', digit, () => put(appendDigit(field.value, digit))));
  }
  pad.append(keys);

  const actions = document.createElement('div');
  actions.className = 'number-pad__actions';
  actions.append(
    padButton('number-pad__action', 'Clear', () => put(CLEARED)),
    padButton('number-pad__action', 'Delete', () => put(deleteLastDigit(field.value))),
    padButton('number-pad__action number-pad__action--done', 'Done', () => handlers.onDone()),
  );
  pad.append(actions);

  return pad;
};
