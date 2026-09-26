import {
  lookupView,
  mealCountText,
  type LookupFigure,
  type LookupResult,
  type LookupSummary,
} from '../domain/food-lookup';
import type { MealInstance } from '../domain/meal-identity';

// Looking back at the log by food: a search box, a summary of the meals that
// matched, and those meals listed newest first, each one a way into its detail.
//
// The screen carries three tabs, because the canvas makes By food, By change and
// By start one screen and a person moves between them. Only By food works in this
// value: the other two are present but refused rather than pretending to work, so
// nobody taps one and is told nothing.
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

/** The three tabs the canvas draws, and which of them this value built. */
const TABS: readonly { readonly label: string; readonly ready: boolean }[] = [
  { label: 'By food', ready: true },
  { label: 'By change', ready: false },
  { label: 'By start', ready: false },
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
  /** What is typed. It is held outside the screen, so a redraw keeps it. */
  readonly query: string;
  readonly state: LookupState;
};

export type LookupHandlers = {
  /** Records what was typed. It does NOT redraw the screen: see below. */
  readonly onQuery: (query: string) => void;
  readonly onOpen: (id: string) => void;
  readonly onRetry: () => void;
};

const element = (tag: string, className: string, text?: string): HTMLElement => {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

const tabStrip = (): HTMLElement => {
  const strip = element('div', 'lookup__tabs');
  strip.setAttribute('role', 'tablist');
  strip.setAttribute('aria-label', 'How to look back');

  for (const tab of TABS) {
    const control = document.createElement('button');
    control.className = tab.ready ? 'lookup__tab lookup__tab--on' : 'lookup__tab';
    control.type = 'button';
    control.setAttribute('role', 'tab');
    control.textContent = tab.label;
    control.setAttribute('aria-selected', String(tab.ready));
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
const resultRow = (result: LookupResult, handlers: LookupHandlers): HTMLElement => {
  const row = document.createElement('li');
  row.className = 'result';

  const open = document.createElement('button');
  open.className = 'result__open';
  open.type = 'button';
  open.setAttribute('aria-label', result.openLabel);

  const head = element('p', 'result__when', `${result.date} · ${result.slot}`);
  open.append(head);
  if (result.dose !== null) open.append(element('p', 'result__dose', result.dose));
  if (result.foods !== null) open.append(element('p', 'result__foods', result.foods));
  open.append(readingsLine(result));
  open.addEventListener('click', () => handlers.onOpen(result.id));

  row.append(open);
  return row;
};

const resultsSection = (
  results: readonly LookupResult[],
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
  handlers: LookupHandlers,
): readonly HTMLElement[] => {
  const view = lookupView(meals, query);
  if (view.kind !== 'found') return [resultsMessage(view.message)];
  return [summarySection(view.summary), resultsSection(view.results, handlers)];
};

export const lookupScreen = (
  view: LookupScreenView,
  handlers: LookupHandlers,
): HTMLElement => {
  const screen = element('div', 'lookup-screen');
  screen.append(tabStrip());

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
  screen.append(search);

  const meals = view.state.meals;
  const panel = element('div', 'lookup__panel');
  panel.append(...panelFor(meals, view.query, handlers));
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
    panel.replaceChildren(...panelFor(meals, typed, handlers));
  });

  return screen;
};
