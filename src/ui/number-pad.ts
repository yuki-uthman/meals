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

// --------------------------------------------------- opening and closing in place
//
// Opening the pad mounts it beside the field and closing it takes it away again.
// Neither touches the input: it is never rebuilt, never reset and never detached,
// so a value already in the field survives being focused and a hardware-keyboard
// user's first keystroke is not eaten. That is why this is a local DOM change and
// not a redraw of the screen -- a redraw would replace the very node the person is
// typing into, breaking this value's oracle and record-a-meal's along with it.

/** One pad at a time on the whole screen: a second one would have two displays. */
let current: { readonly close: () => void } | null = null;

/** Forgets a pad left behind on a screen that has since been replaced. */
export const forgetOpenPad = (): void => {
  current = null;
};

export type AttachedPadHandlers = {
  /** The field's value changed under the pad's keys. */
  readonly onValue: (value: string) => void;
  /** The pad is now open on this field, so the app can say so elsewhere. */
  readonly onOpened: () => void;
  /** The pad has gone. The value stays exactly where the person left it. */
  readonly onClosed: () => void;
};

/**
 * Gives one glucose field its pad. Tapping the field opens it, and so does
 * reaching it with a keyboard: arriving at the field is what asks for a way to
 * fill it in.
 */
export const attachNumberPad = (
  wrapper: HTMLElement,
  field: HTMLInputElement,
  chips: readonly ReadingChip[],
  handlers: AttachedPadHandlers,
  initiallyOpen = false,
): void => {
  let mounted: HTMLElement | null = null;

  const close = (): void => {
    if (mounted === null) return;
    mounted.remove();
    mounted = null;
    if (current !== null && current.close === close) current = null;
    handlers.onClosed();
  };

  const open = (): void => {
    if (mounted !== null) return;
    // Another field's pad gives way rather than sitting open beside this one.
    current?.close();
    mounted = numberPad(field, chips, { onValue: handlers.onValue, onDone: close });
    wrapper.append(mounted);
    current = { close };
    handlers.onOpened();
  };

  field.addEventListener('click', open);
  field.addEventListener('focus', open);

  // A redraw for some other reason -- a refusal to show, a food added -- must not
  // take an open pad away with it.
  if (initiallyOpen) open();
};
