import type { IsoDate } from '../domain/entry';

// The signed-in frame: the header the canvas draws -- the weekday and date above
// the heading, with the day stepper -- the sign-out control, and the slot the day
// log renders into. No account data of any kind reaches the frame.

export type FormFrame = {
  /** The heading the form screen carries, 'New meal' or 'Edit meal'. */
  readonly title: string;
  /** While a save is in flight the Save control is refused rather than repeated. */
  readonly busy: boolean;
};

/** The sections the bottom navigation carries. Lookup joined them at value 10. */
export type ShellTab = 'today' | 'lookup' | 'history';

export type ShellState = {
  readonly date: IsoDate;
  /**
   * A section that is not the day being read, such as History. When it is set
   * the header says the section rather than the date, and the day stepper is
   * absent, because stepping a day means nothing outside the day log.
   */
  readonly heading?: string | undefined;
  /** Which navigation entry the person is on, so the frame can say so. */
  readonly tab?: ShellTab | undefined;
  /** Whether the date being read is the reader's own today. */
  readonly isToday: boolean;
  /**
   * Present when the frame is holding a form rather than the day log. The date
   * stays in the state either way, because a form records against the date being
   * read and the header keeps saying which day that is.
   */
  readonly form?: FormFrame | undefined;
};

export type ShellHandlers = {
  readonly onSignOut: () => void;
  readonly onPreviousDay: () => void;
  readonly onNextDay: () => void;
  /** Used only by a form frame: leave without writing, and write. */
  readonly onCancel?: (() => void) | undefined;
  readonly onSave?: (() => void) | undefined;
  /**
   * Moving between the sections. Present on the reading screens and absent on a
   * form: leaving a half-filled meal by tapping a section would throw it away.
   */
  readonly onNavigate?: ((tab: ShellTab) => void) | undefined;
};

const NAV_ENTRIES: readonly (readonly [ShellTab, string])[] = [
  ['today', 'Today'],
  ['lookup', 'Lookup'],
  ['history', 'History'],
];

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

const controlBar = (): HTMLElement => {
  const controls = document.createElement('div');
  controls.className = 'shell__controls';
  return controls;
};

/** Reading a day: step it, or leave. */
const dayControls = (state: ShellState, handlers: ShellHandlers): HTMLElement => {
  const controls = controlBar();

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
  return controls;
};

/**
 * Filling in a form: leave without writing, or write. The day stepper and the
 * sign-out control are deliberately absent -- moving the date would shift the day
 * the meal is being recorded against, and leaving would throw the meal away.
 */
const formControls = (form: FormFrame, handlers: ShellHandlers): HTMLElement => {
  const controls = controlBar();

  const cancel = document.createElement('button');
  cancel.className = 'button button--quiet';
  cancel.type = 'button';
  cancel.textContent = 'Cancel';
  cancel.addEventListener('click', () => handlers.onCancel?.());

  // One Save control for the whole form, in the frame, so there is exactly one
  // unambiguous way to record what has been filled in.
  const save = document.createElement('button');
  save.className = 'button button--save';
  save.type = 'button';
  save.textContent = form.busy ? 'Saving…' : 'Save';
  save.disabled = form.busy;
  save.addEventListener('click', () => handlers.onSave?.());

  controls.append(cancel, save);
  return controls;
};

/**
 * A section other than the day log: there is no day to step, so the frame
 * carries the way out and nothing else.
 */
const sectionControls = (handlers: ShellHandlers): HTMLElement => {
  const controls = controlBar();

  const signOut = document.createElement('button');
  signOut.className = 'button button--quiet';
  signOut.type = 'button';
  signOut.textContent = 'Sign out';
  signOut.addEventListener('click', () => handlers.onSignOut());

  controls.append(signOut);
  return controls;
};

/**
 * The bottom navigation: Today, Lookup and History, and nothing else. Settings is
 * in no value of this brief, so it is not here.
 */
const bottomNavigation = (state: ShellState, handlers: ShellHandlers): HTMLElement => {
  const nav = document.createElement('nav');
  nav.className = 'shell__nav';
  nav.setAttribute('aria-label', 'Sections');

  for (const [tab, label] of NAV_ENTRIES) {
    const entry = document.createElement('button');
    entry.className = state.tab === tab ? 'nav__entry nav__entry--on' : 'nav__entry';
    entry.type = 'button';
    entry.textContent = label;
    // The section being read says so to a screen reader rather than only by
    // being painted differently.
    if (state.tab === tab) entry.setAttribute('aria-current', 'page');
    entry.addEventListener('click', () => handlers.onNavigate?.(tab));
    nav.append(entry);
  }

  return nav;
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

  const title = document.createElement('h1');
  title.className = 'shell__title';
  title.textContent =
    state.form?.title ?? state.heading ?? screenHeading(state.date, state.isToday);

  // The quiet date line belongs to the day being read. A section such as History
  // is not one date, so saying one above its heading would be a small untruth.
  if (state.form === undefined && state.heading !== undefined) {
    day.append(title);
  } else {
    const weekday = document.createElement('p');
    weekday.className = 'shell__weekday';
    weekday.textContent = dateHeading(state.date);
    day.append(weekday, title);
  }

  const controls =
    state.form !== undefined
      ? formControls(state.form, handlers)
      : state.heading === undefined
        ? dayControls(state, handlers)
        : sectionControls(handlers);

  header.append(day, controls);

  const main = document.createElement('main');
  main.className = 'shell__main';
  main.append(content);

  frame.append(header, main);

  // No navigation on a form: the way out of one is Cancel or Save, and both say
  // what happens to what has been filled in.
  if (state.form === undefined && handlers.onNavigate !== undefined) {
    frame.append(bottomNavigation(state, handlers));
  }

  return frame;
};
