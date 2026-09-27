import {
  historyCaption,
  historyHeaders,
  historyLegend,
  historyViewLabel,
  HISTORY_VIEWS,
  type CellTarget,
  type FilledCell,
  type HistoryRow,
  type HistoryView,
} from '../domain/history';

// The History grid: one row per calendar date, newest first, and four columns
// read left to right as the day happened -- the night that led into it, then
// breakfast, lunch and dinner.
//
// Every band is published to the DOM BY NAME, as data-level-band in the Before
// view and data-change-band in the other two, and the stylesheet is the only
// thing that turns a name into a colour. The Before view publishes level bands
// only and Change and Both publish change bands only, so the brief's rule is
// stated where it can be read back rather than hidden in a palette.
//
// A cell with nothing behind it is an empty outline: no band, no digits and no
// control, because a cell that opens nothing must not be offered as one.

export type HistoryState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'failed'; readonly message: string }
  | { readonly kind: 'loaded'; readonly rows: readonly HistoryRow[] };

export type HistoryScreenView = {
  readonly view: HistoryView;
  readonly state: HistoryState;
};

export type HistoryHandlers = {
  readonly onView: (view: HistoryView) => void;
  readonly onOpen: (target: CellTarget) => void;
  readonly onRetry: () => void;
};

export const HISTORY_REGION_LABEL = 'History';

const element = (tag: string, className: string, text?: string): HTMLElement => {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

/**
 * A chooser entry. It publishes what it has chosen as pressed state rather than
 * as a colour, so which view the grid is on can be read back.
 */
const chooser = (
  label: string,
  pressed: boolean,
  className: string,
  onChoose: () => void,
): HTMLButtonElement => {
  const control = document.createElement('button');
  control.className = pressed ? `${className} ${className}--on` : className;
  control.type = 'button';
  control.textContent = label;
  control.setAttribute('aria-pressed', String(pressed));
  control.addEventListener('click', () => onChoose());
  return control;
};

const viewChooser = (view: HistoryView, handlers: HistoryHandlers): HTMLElement => {
  const group = element('div', 'history__views');
  group.setAttribute('role', 'group');
  group.setAttribute('aria-label', 'Which reading the grid shows');
  for (const candidate of HISTORY_VIEWS) {
    group.append(
      chooser(historyViewLabel(candidate), candidate === view, 'history__view', () =>
        handlers.onView(candidate),
      ),
    );
  }
  return group;
};

/**
 * A populated cell is one control that carries the band. Its accessible name
 * says its day, its column and its readings in words, because a coloured square
 * is unreadable to anyone not using the colours.
 */
const filledCell = (cell: FilledCell, handlers: HistoryHandlers): HTMLElement => {
  const control = document.createElement('button');
  control.className =
    cell.readings.length > 1 ? 'history__tap history__tap--pair' : 'history__tap';
  control.type = 'button';
  control.setAttribute('aria-label', cell.name);
  control.setAttribute(
    cell.bandKind === 'level' ? 'data-level-band' : 'data-change-band',
    cell.band,
  );
  for (const text of cell.readings) {
    control.append(element('span', 'history__reading', text));
  }
  control.addEventListener('click', () => handlers.onOpen(cell.target));
  return control;
};

const gridTable = (rows: readonly HistoryRow[], view: HistoryView, handlers: HistoryHandlers): HTMLElement => {
  const table = document.createElement('table');
  table.className = 'history__grid';

  const head = document.createElement('thead');
  const headRow = document.createElement('tr');
  // The corner is empty on purpose: the row header is a date, and naming the
  // column 'Day' would be a word that says nothing the labels below do not.
  const corner = element('th', 'history__corner');
  corner.setAttribute('scope', 'col');
  headRow.append(corner);
  for (const header of historyHeaders(view)) {
    const cell = element('th', 'history__header', header);
    cell.setAttribute('scope', 'col');
    headRow.append(cell);
  }
  head.append(headRow);
  table.append(head);

  const body = document.createElement('tbody');
  for (const row of rows) {
    const line = document.createElement('tr');
    line.className = 'history__row';
    const label = element('th', 'history__day', row.label);
    label.setAttribute('scope', 'row');
    line.append(label);
    for (const cell of row.cells) {
      const slot = element('td', cell.kind === 'empty' ? 'history__cell history__cell--empty' : 'history__cell');
      if (cell.kind === 'filled') slot.append(filledCell(cell, handlers));
      line.append(slot);
    }
    body.append(line);
  }
  table.append(body);

  return table;
};

/**
 * The legend follows the view and names its bands in words. It sits outside the
 * grid region on purpose: it is a statement about the colours, not a reading
 * anybody recorded, so an account with nothing in its grid still gets one.
 */
const legend = (view: HistoryView): HTMLElement => {
  const list = element('ul', 'history__legend');
  list.setAttribute('aria-label', 'What the colours mean');
  for (const entry of historyLegend(view)) {
    const item = element('li', 'history__legend-entry');
    const swatch = element('span', 'history__swatch');
    swatch.setAttribute(
      entry.bandKind === 'level' ? 'data-level-band' : 'data-change-band',
      entry.band,
    );
    swatch.textContent = entry.words;
    item.append(swatch);
    list.append(item);
  }
  return list;
};

export const historyScreen = (
  view: HistoryScreenView,
  handlers: HistoryHandlers,
): HTMLElement => {
  const screen = element('div', 'history-screen');
  // The view and nothing else: there is no period control, because the grid runs
  // back to the earliest recorded entry and going further back is scrolling.
  screen.append(viewChooser(view.view, handlers));

  if (view.state.kind === 'loading') {
    // Deliberately no grid while the read is in flight: a page of empty outlines
    // would read as a fortnight with nothing recorded rather than as one not yet
    // read.
    screen.append(element('p', 'history__waiting', 'Loading…'));
    return screen;
  }

  if (view.state.kind === 'failed') {
    // Show the failure and no grid at all, rather than a stale one.
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

  const region = document.createElement('section');
  region.className = 'history';
  region.setAttribute('aria-label', HISTORY_REGION_LABEL);
  region.append(gridTable(view.state.rows, view.view, handlers));

  screen.append(region);
  screen.append(element('p', 'history__caption', historyCaption(view.view)));
  screen.append(legend(view.view));
  return screen;
};
