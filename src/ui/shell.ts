import type { IsoDate } from '../domain/entry';

// The signed-in frame: the header the canvas draws -- the weekday and date above
// the heading, with the day stepper -- the sign-out control, and the slot the day
// log renders into. No account data of any kind reaches the frame.

export type ShellState = {
  readonly date: IsoDate;
  /** Whether the date being read is the reader's own today. */
  readonly isToday: boolean;
};

export type ShellHandlers = {
  readonly onSignOut: () => void;
  readonly onPreviousDay: () => void;
  readonly onNextDay: () => void;
};

const localDate = (date: IsoDate): Date => {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  return new Date(year, month - 1, day);
};

/** 'Saturday 26 September': the quiet line above the heading, always the date. */
export const dateHeading = (date: IsoDate): string =>
  localDate(date).toLocaleDateString(undefined, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });

/**
 * 'Today' when the date being read is the reader's own today, and the date itself
 * otherwise, so a person stepping back is never told they are looking at today.
 */
export const screenHeading = (date: IsoDate, isToday: boolean): string =>
  isToday
    ? 'Today'
    : localDate(date).toLocaleDateString(undefined, { day: 'numeric', month: 'long' });

const stepControl = (label: string, glyph: string, onUse: () => void): HTMLButtonElement => {
  const control = document.createElement('button');
  control.className = 'button button--step';
  control.type = 'button';
  control.setAttribute('aria-label', label);
  control.textContent = glyph;
  control.addEventListener('click', () => onUse());
  return control;
};

export const shell = (
  state: ShellState,
  handlers: ShellHandlers,
  content: HTMLElement,
): HTMLElement => {
  const frame = document.createElement('div');
  frame.className = 'shell';

  const header = document.createElement('header');
  header.className = 'shell__header';

  const day = document.createElement('div');
  day.className = 'shell__day';

  const weekday = document.createElement('p');
  weekday.className = 'shell__weekday';
  weekday.textContent = dateHeading(state.date);

  const title = document.createElement('h1');
  title.className = 'shell__title';
  title.textContent = screenHeading(state.date, state.isToday);

  day.append(weekday, title);

  const controls = document.createElement('div');
  controls.className = 'shell__controls';

  const previous = stepControl('Previous day', '←', handlers.onPreviousDay);

  // The log has no future, so on today the control is refused rather than hidden:
  // a disabled control still says the day stepper exists and stops here.
  const next = stepControl('Next day', '→', handlers.onNextDay);
  next.disabled = state.isToday;

  const signOut = document.createElement('button');
  signOut.className = 'button button--quiet';
  signOut.type = 'button';
  signOut.textContent = 'Sign out';
  signOut.addEventListener('click', () => handlers.onSignOut());

  controls.append(previous, next, signOut);

  header.append(day, controls);

  const main = document.createElement('main');
  main.className = 'shell__main';
  main.append(content);

  frame.append(header, main);
  return frame;
};
