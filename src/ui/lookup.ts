import {
  lookupView,
  mealCountText,
  type LookupFigure,
  type LookupResult,
  type LookupSummary,
} from '../domain/food-lookup';
import {
  changeWindowLabel,
  nearestView,
  startView,
  startWindowLabel,
  CHANGE_WINDOWS,
  START_WINDOWS,
  type ChangeWindow,
  type StartWindow,
} from '../domain/nearest-lookup';
import { MEAL_SLOTS, slotLabel, type MealSlot } from '../domain/entry';
import type { MealInstance } from '../domain/meal-identity';

// Looking back at the log by food: a search box, a summary of the meals that
// matched, and those meals listed newest first, each one a way into its detail.
//
// The screen carries three tabs, because the canvas makes By food, By change and
// By start one screen and a person moves between them. All three work now.
//
// By change asks for a signed target and a window; By start asks for an unsigned
// starting reading and a window of its own, ±5, ±10 or ±20, because a tolerance on
// a reading is a coarser thing than one on a change. Either window is a TOLERANCE,
// not a ranking: what it excludes is absent rather than listed last. Which meals it
// admits, how far off each was and what order they come in are the domain's rules;
// this only draws them, and a result is the SAME card a food lookup result is.
//
// The band on a change is published to the DOM BY NAME, as data-change-band, and
// the stylesheet is the only thing that turns a name into a colour -- the same
// rule as a Today card and a History cell.
//
// The summary is a REPORT of what was recorded. It never proposes a dose.

/** The two named parts of this screen, each located by the name it is given. */
export const LOOKUP_SUMMARY_LABEL = 'Summary';
export const LOOKUP_RESULTS_LABEL = 'Results';

/**
 * The search field's real name. It is visually hidden because the field sits
 * behind a search icon in the canvas, and hidden is not absent: this is what the
 * field is called to anyone not looking at it.
 */
export const LOOKUP_SEARCH_LABEL = 'Search past meals';

/**
 * The target field's real name, drawn beside the field: the sign is part of what is
 * asked for, so the field says outright what it takes.
 */
export const LOOKUP_TARGET_LABEL = 'Change wanted';

/**
 * The starting reading field's real name, drawn beside the field. It says 'reading'
 * outright, because what is asked for here is where a meal BEGAN and not how far it
 * moved, and it carries no sign: a reading is never negative.
 */
export const LOOKUP_START_LABEL = 'Starting reading';

/** Which way of looking back the person is on. */
export type LookupTab = 'food' | 'change' | 'start';

/** The three tabs the canvas draws, and which of them are built. */
const TABS: readonly {
  readonly tab: LookupTab;
  readonly label: string;
  readonly ready: boolean;
}[] = [
  { tab: 'food', label: 'By food', ready: true },
  { tab: 'change', label: 'By change', ready: true },
  { tab: 'start', label: 'By start', ready: true },
];

/**
 * There is deliberately no loading state. The meals a lookup matches over are read
 * BEFORE this screen is shown -- as the night list and the pad's chips already are
 * -- so the search box never exists while the material behind it is still in
 * flight. A box that accepted a word it could not yet answer would either lose
 * what was typed or answer it over half a log.
 */
export type LookupState =
  | { readonly kind: 'failed'; readonly message: string }
  | { readonly kind: 'loaded'; readonly meals: readonly MealInstance[] };

export type LookupScreenView = {
  /** Which tab is being looked at. Held outside the screen, like everything here. */
  readonly tab: LookupTab;
  /** What is typed in the search box. Held outside, so a redraw keeps it. */
  readonly query: string;
  /** The kind of meal the matches are narrowed to, or none for every kind. */
  readonly slot: MealSlot | null;
  /** The target change as typed, signed, and the window it is asked within. */
  readonly target: string;
  readonly window: ChangeWindow;
  /**
   * The starting reading as typed, unsigned, and the window it is asked within.
   * Held separately from By change's pair, because they are different questions
   * over different quantities and switching tabs must not answer one with the
   * other's target or the other's tolerance.
   */
  readonly startTarget: string;
  readonly startWindow: StartWindow;
  readonly state: LookupState;
};

export type LookupHandlers = {
  /** Records what was typed. It does NOT redraw the screen: see below. */
  readonly onQuery: (query: string) => void;
  /** Choosing a kind of meal, or choosing it again to clear it. Redraws. */
  readonly onSlot: (slot: MealSlot | null) => void;
  /** Records the target change. It does not redraw the screen either. */
  readonly onTarget: (target: string) => void;
  /** Choosing a tab or a window IS structural, so both redraw. */
  readonly onTab: (tab: LookupTab) => void;
  readonly onWindow: (bound: ChangeWindow) => void;
  /** The starting reading, recorded without a redraw for the same reason. */
  readonly onStartTarget: (target: string) => void;
  readonly onStartWindow: (bound: StartWindow) => void;
  readonly onOpen: (id: string) => void;
  readonly onRetry: () => void;
};

const element = (tag: string, className: string, text?: string): HTMLElement => {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

const tabStrip = (current: LookupTab, handlers: LookupHandlers): HTMLElement => {
  const strip = element('div', 'lookup__tabs');
  strip.setAttribute('role', 'tablist');
  strip.setAttribute('aria-label', 'How to look back');

  for (const tab of TABS) {
    const on = tab.ready && tab.tab === current;
    const control = document.createElement('button');
    control.className = on ? 'lookup__tab lookup__tab--on' : 'lookup__tab';
    control.type = 'button';
    control.setAttribute('role', 'tab');
    control.textContent = tab.label;
    control.setAttribute('aria-selected', String(on));
    if (tab.ready) {
      control.addEventListener('click', () => handlers.onTab(tab.tab));
    }
    if (!tab.ready) {
      // Present, and refused. A tab that is not built yet says so rather than
      // being tapped and doing nothing.
      control.setAttribute('aria-disabled', 'true');
      control.disabled = true;
    }
    strip.append(control);
  }

  return strip;
};

/**
 * One figure: its name, its value, and how many meals it is over. The count is
 * beside the figure rather than once for the whole summary, because the three
 * figures are over different numbers of meals -- a change nobody measured is in
 * none of them -- and a figure over two meals must not read like one over twenty.
 */
const figureCard = (figure: LookupFigure): HTMLElement => {
  const card = element('div', 'figure');
  card.append(element('p', 'figure__name', figure.name));
  // A figure no matching meal recorded says so with a dash rather than with a
  // zero: nothing recorded is not a value of nothing.
  card.append(element('p', 'figure__value', figure.value ?? '—'));
  card.append(element('p', 'figure__meals', `over ${mealCountText(figure.meals)}`));
  if (figure.note !== undefined) card.append(element('p', 'figure__note', figure.note));
  return card;
};

const summarySection = (summary: LookupSummary): HTMLElement => {
  const region = document.createElement('section');
  region.className = 'lookup-summary';
  region.setAttribute('aria-label', LOOKUP_SUMMARY_LABEL);

  region.append(element('h2', 'lookup-summary__heading', summary.heading));

  const figures = element('div', 'lookup-summary__figures');
  for (const figure of summary.figures) figures.append(figureCard(figure));
  region.append(figures);

  return region;
};

/**
 * The readings, and the change between them. A meal with no after reading shows
 * its before alone and carries no change and no band at all: a measurement
 * nobody took must never be drawn as a change of zero.
 */
const readingsLine = (result: LookupResult): HTMLElement => {
  const line = element('p', 'result__readings');
  if (result.before !== null) line.append(element('span', 'result__before', result.before));
  if (result.after !== null) {
    // Decoration between the two readings, hidden from a screen reader exactly as
    // the detail's is: it is a picture of 'became', not a word anybody recorded.
    const arrow = element('span', 'result__arrow', '→');
    arrow.setAttribute('aria-hidden', 'true');
    line.append(arrow);
    line.append(element('span', 'result__after', result.after));
  }
  if (result.change !== null) {
    const change = element('span', 'result__change', result.change.text);
    change.setAttribute('data-change-band', result.change.band);
    line.append(change);
  }
  return line;
};

/**
 * One result. The whole row is the one control that opens the meal, by its id
 * through the port, exactly as a Today card and a History cell are, and its
 * accessible name says which meal it opens in words rather than by position.
 */
const resultRow = (
  result: LookupResult & { readonly distance?: string },
  handlers: LookupHandlers,
): HTMLElement => {
  const row = document.createElement('li');
  row.className = 'result';

  const open = document.createElement('button');
  open.className = 'result__open';
  open.type = 'button';
  open.setAttribute('aria-label', result.openLabel);

  const head = element('p', 'result__when', `${result.date} · ${result.slot}`);
  open.append(head);
  /**
   * How far off the target it was, in words, and deliberately drawn ABOVE the
   * readings rather than beside the change: a distance and a change are different
   * statements, and putting them side by side would invite reading one as the other.
   */
  if (result.distance !== undefined) {
    open.append(element('p', 'result__distance', result.distance));
  }
  if (result.dose !== null) open.append(element('p', 'result__dose', result.dose));
  if (result.foods !== null) open.append(element('p', 'result__foods', result.foods));
  open.append(readingsLine(result));
  open.addEventListener('click', () => handlers.onOpen(result.id));

  row.append(open);
  return row;
};

const resultsSection = (
  results: readonly (LookupResult & { readonly distance?: string })[],
  handlers: LookupHandlers,
): HTMLElement => {
  const region = document.createElement('section');
  region.className = 'lookup-results';
  region.setAttribute('aria-label', LOOKUP_RESULTS_LABEL);

  const list = element('ul', 'lookup-results__rows');
  for (const result of results) list.append(resultRow(result, handlers));
  region.append(list);

  return region;
};

/** The results area saying why it is empty: nothing typed, or nothing matched. */
const resultsMessage = (message: string): HTMLElement => {
  const region = document.createElement('section');
  region.className = 'lookup-results';
  region.setAttribute('aria-label', LOOKUP_RESULTS_LABEL);
  region.append(element('p', 'lookup-results__empty', message));
  return region;
};

/**
 * Everything below the search box, for what is typed. With nothing typed the
 * screen invites a search rather than listing everything the account owns, and
 * with no match there is no summary at all, because a summary over nothing would
 * print figures with no meals behind them.
 */
const panelFor = (
  meals: readonly MealInstance[],
  query: string,
  slot: MealSlot | null,
  handlers: LookupHandlers,
): readonly HTMLElement[] => {
  const view = lookupView(meals, query, slot);
  if (view.kind !== 'found') return [resultsMessage(view.message)];
  return [summarySection(view.summary), resultsSection(view.results, handlers)];
};

/**
 * The kinds of meal, as pills under the search box. Tapping the chosen one again
 * clears it, so there is no separate 'All' to find; none chosen means every kind.
 */
const slotPills = (chosen: MealSlot | null, handlers: LookupHandlers): HTMLElement => {
  const pills = element('div', 'lookup__windows lookup__slots');
  pills.setAttribute('role', 'group');
  pills.setAttribute('aria-label', 'Meal type');

  for (const slot of MEAL_SLOTS) {
    const on = slot === chosen;
    const pill = document.createElement('button');
    pill.className = on ? 'lookup__window lookup__window--on' : 'lookup__window';
    pill.type = 'button';
    pill.textContent = slotLabel(slot);
    pill.setAttribute('aria-pressed', String(on));
    pill.addEventListener('click', () => handlers.onSlot(on ? null : slot));
    pills.append(pill);
  }

  return pills;
};

/** Everything below the target field, for the target and the window in hand. */
const changePanelFor = (
  meals: readonly MealInstance[],
  target: string,
  bound: ChangeWindow,
  handlers: LookupHandlers,
): readonly HTMLElement[] => {
  const view = nearestView(meals, target, bound);
  if (view.kind !== 'found') return [resultsMessage(view.message)];
  return [resultsSection(view.results, handlers)];
};

/**
 * The three windows, as chips. Each says which bound it is, the chosen one says so
 * to a screen reader as well as to the eye, and none of them is ever disabled: with
 * nothing in the window, widening it is the move that finds something, so the chips
 * must stay usable exactly when there are no results.
 */
const windowChips = <Bound extends number>(
  bounds: readonly Bound[],
  chosen: Bound,
  label: (bound: Bound) => string,
  choose: (bound: Bound) => void,
): HTMLElement => {
  const chips = element('div', 'lookup__windows');
  chips.setAttribute('role', 'group');
  chips.setAttribute('aria-label', 'Window');

  for (const bound of bounds) {
    const on = bound === chosen;
    const chip = document.createElement('button');
    chip.className = on ? 'lookup__window lookup__window--on' : 'lookup__window';
    chip.type = 'button';
    chip.textContent = label(bound);
    chip.setAttribute('aria-pressed', String(on));
    chip.addEventListener('click', () => choose(bound));
    chips.append(chip);
  }

  return chips;
};

/**
 * By change: the signed target, the window, and the meals nearest to it. Only this
 * panel is redrawn as the target is typed, for the same reason the search box's is.
 */
const byChangeSection = (
  meals: readonly MealInstance[],
  view: LookupScreenView,
  handlers: LookupHandlers,
): HTMLElement => {
  const section = element('div', 'lookup__by-change');

  const field = document.createElement('input');
  field.className = 'field__input lookup__field';
  field.id = 'lookup-change-target';
  // Deliberately a text field rather than a number one: the target is signed, and a
  // number field on a phone keyboard hides the minus sign that makes '-20' askable.
  field.type = 'text';
  field.inputMode = 'text';
  field.autocomplete = 'off';
  field.value = view.target;

  const label = document.createElement('label');
  label.className = 'field__label';
  label.setAttribute('for', field.id);
  label.textContent = LOOKUP_TARGET_LABEL;

  const asked = element('div', 'field');
  asked.append(label, field);
  section.append(
    asked,
    windowChips(CHANGE_WINDOWS, view.window, changeWindowLabel, handlers.onWindow),
  );

  const panel = element('div', 'lookup__panel');
  panel.append(...changePanelFor(meals, view.target, view.window, handlers));
  section.append(panel);

  // Typing redraws THIS PANEL and nothing else: rebuilding the screen on every
  // keystroke would replace the very field being typed into and take the caret with
  // it, and the window is arithmetic over meals already in hand. What was typed is
  // recorded outside the screen, so a redraw for any other reason keeps it.
  field.addEventListener('input', () => {
    const typed = field.value;
    handlers.onTarget(typed);
    panel.replaceChildren(...changePanelFor(meals, typed, view.window, handlers));
  });

  return section;
};

/** Everything below the starting reading field, for the reading and window in hand. */
const startPanelFor = (
  meals: readonly MealInstance[],
  target: string,
  bound: StartWindow,
  handlers: LookupHandlers,
): readonly HTMLElement[] => {
  const view = startView(meals, target, bound);
  if (view.kind !== 'found') return [resultsMessage(view.message)];
  return [resultsSection(view.results, handlers)];
};

/**
 * By start: the starting reading, its own window, and the meals that began nearest
 * to it. Only this panel is redrawn as the reading is typed, for the same reason
 * the search box's and By change's are.
 */
const byStartSection = (
  meals: readonly MealInstance[],
  view: LookupScreenView,
  handlers: LookupHandlers,
): HTMLElement => {
  const section = element('div', 'lookup__by-start');

  const field = document.createElement('input');
  field.className = 'field__input lookup__field';
  field.id = 'lookup-start-target';
  // A text field with a numeric keypad rather than a number field: the reading is
  // unsigned whole mg/dL, and the domain is the only thing that decides what counts
  // as one, so nothing here silently repairs what was typed.
  field.type = 'text';
  field.inputMode = 'numeric';
  field.autocomplete = 'off';
  field.value = view.startTarget;

  const label = document.createElement('label');
  label.className = 'field__label';
  label.setAttribute('for', field.id);
  label.textContent = LOOKUP_START_LABEL;

  const asked = element('div', 'field');
  asked.append(label, field);
  section.append(
    asked,
    windowChips(START_WINDOWS, view.startWindow, startWindowLabel, handlers.onStartWindow),
  );

  const panel = element('div', 'lookup__panel');
  panel.append(...startPanelFor(meals, view.startTarget, view.startWindow, handlers));
  section.append(panel);

  // Typing redraws THIS PANEL and nothing else, for the reason By change's does.
  field.addEventListener('input', () => {
    const typed = field.value;
    handlers.onStartTarget(typed);
    panel.replaceChildren(...startPanelFor(meals, typed, view.startWindow, handlers));
  });

  return section;
};

export const lookupScreen = (
  view: LookupScreenView,
  handlers: LookupHandlers,
): HTMLElement => {
  const screen = element('div', 'lookup-screen');
  screen.append(tabStrip(view.tab, handlers));

  if (view.state.kind === 'failed') {
    // Say why, and offer no search box at all: a box that cannot answer anything is
    // a dead control, and worse than an error because a person would read its
    // silence as having eaten the food never.
    const notice = element('p', 'notice', view.state.message);
    notice.setAttribute('role', 'alert');
    const retry = document.createElement('button');
    retry.className = 'button button--quiet';
    retry.type = 'button';
    retry.textContent = 'Try again';
    retry.addEventListener('click', () => handlers.onRetry());
    screen.append(notice, retry);
    return screen;
  }

  if (view.tab === 'change') {
    screen.append(byChangeSection(view.state.meals, view, handlers));
    return screen;
  }

  if (view.tab === 'start') {
    screen.append(byStartSection(view.state.meals, view, handlers));
    return screen;
  }

  const search = element('div', 'lookup__search');
  search.setAttribute('role', 'search');

  const field = document.createElement('input');
  field.className = 'field__input lookup__field';
  field.id = 'lookup-search';
  field.type = 'search';
  field.value = view.query;

  const label = document.createElement('label');
  // Visually hidden, never absent: the field is named to anyone not looking at it.
  label.className = 'visually-hidden';
  label.setAttribute('for', field.id);
  label.textContent = LOOKUP_SEARCH_LABEL;

  search.append(label, field);
  screen.append(search, slotPills(view.slot, handlers));

  const meals = view.state.meals;
  const panel = element('div', 'lookup__panel');
  panel.append(...panelFor(meals, view.query, view.slot, handlers));
  screen.append(panel);

  /**
   * Typing redraws THIS PANEL and nothing else. Rebuilding the whole screen on
   * every keystroke would replace the very field being typed into and take the
   * caret with it, and the matching is over meals already in hand, so a keystroke
   * is arithmetic rather than another read. What was typed is still recorded
   * outside the screen, so a redraw for any other reason keeps it.
   */
  field.addEventListener('input', () => {
    const typed = field.value;
    handlers.onQuery(typed);
    panel.replaceChildren(...panelFor(meals, typed, view.slot, handlers));
  });

  return screen;
};
