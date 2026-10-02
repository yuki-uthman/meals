import {
  historyCaption,
  historyHeaders,
  historyLegend,
  historyViewLabel,
  searchHistoryRows,
  suggestedFoods,
  HISTORY_SEARCH_LABEL,
  HISTORY_VIEWS,
  type CellTarget,
  type AwaitingCell,
  type EmptyCell,
  type FilledCell,
  type HistoryRow,
  type HistoryView,
} from '../domain/history';

// The History grid: one row per calendar date, newest first, and four columns
// read left to right as the day happened -- breakfast, lunch and dinner, then
// that day's night.
//
// Every band is published to the DOM BY NAME, as data-level-band in the Before
// view and data-change-band in the other two, and the stylesheet is the only
// thing that turns a name into a colour. The Before view publishes level bands
// only and Change and Both publish change bands only, so the brief's rule is
// stated where it can be read back rather than hidden in a palette.
//
// A cell with nothing behind it is an empty outline carrying no band and no
// digits, and it IS a control: it opens a new entry for that date and that slot,
// because backfilling a day kept on paper is the reason this screen exists, and an
// untappable empty cell would make the one screen that shows a missing day the one
// screen that cannot fill it. Its accessible name still says which day and which
// column it belongs to, since there is nothing in it to read.

export type HistoryState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'failed'; readonly message: string }
  | {
      readonly kind: 'loaded';
      readonly rows: readonly HistoryRow[];
      /** Every food the record holds, most recently eaten first: what the search offers. */
      readonly foods: readonly string[];
    };

export type HistoryScreenView = {
  readonly view: HistoryView;
  readonly state: HistoryState;
  /** The food being searched for; empty shows every day. */
  readonly query: string;
};

export type HistoryHandlers = {
  readonly onView: (view: HistoryView) => void;
  readonly onQuery: (query: string) => void;
  readonly onOpen: (target: CellTarget) => void;
  readonly onRetry: () => void;
};

export const HISTORY_REGION_LABEL = 'History';

/**
 * The element the ROWS scroll inside. The page itself does not scroll on this
 * screen -- which is what makes the pinned column headers worth having -- so the
 * offset that is remembered and put back is THIS container's and not the window's.
 * Restoring a window offset would restore nothing, and returning from a cell would
 * silently land at the top of ninety rows again.
 */
export const HISTORY_SCROLLER_CLASS = 'history';

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
 * A cell that does not hold the food being searched for is greyed out. It stays a
 * control, because the day around a match is still worth opening.
 */
const dim = (control: HTMLElement, dimmed: boolean): HTMLElement => {
  if (dimmed) {
    control.classList.add('history__tap--dimmed');
    control.setAttribute('data-dimmed', 'true');
  }
  return control;
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

/**
 * An empty cell: the same control with no band, no digits and a dashed outline.
 * The name is the only thing it can be read by, so it carries one.
 */
const emptyCell = (cell: EmptyCell, handlers: HistoryHandlers): HTMLElement => {
  const control = document.createElement('button');
  control.className = 'history__tap history__tap--empty';
  control.type = 'button';
  control.setAttribute('aria-label', cell.name);
  control.addEventListener('click', () => handlers.onOpen(cell.target));
  return control;
};

/**
 * A recorded entry with no reading to show yet: a solid outline on a soft fill
 * and a dash, so it stands apart from the dashed slots with nothing in them.
 */
const awaitingCell = (cell: AwaitingCell, handlers: HistoryHandlers): HTMLElement => {
  const control = document.createElement('button');
  control.className = 'history__tap history__tap--awaiting';
  control.type = 'button';
  control.setAttribute('aria-label', cell.name);
  control.append(element('span', 'history__awaiting-mark', '—'));
  control.addEventListener('click', () => handlers.onOpen(cell.target));
  return control;
};

/**
 * The month a row begins, named across the grid. Over ninety days the short label
 * 'Tue 22' is ambiguous three times over, so this is what tells a person scrolling
 * back which month they have reached.
 */
const monthSeparator = (month: string, columns: number): HTMLElement => {
  const line = document.createElement('tr');
  line.className = 'history__month';
  // Built as a TABLE CELL rather than through element(), which returns HTMLElement
  // and has no colSpan: a browser source that does not compile takes the whole
  // acceptance suite down with it, because the support builds the bundle before
  // serving it.
  const cell = document.createElement('th');
  cell.className = 'history__month-name';
  cell.textContent = month;
  cell.scope = 'row';
  cell.colSpan = columns;
  line.append(cell);
  return line;
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
  // Every header, the night's included, is drawn the same way: upper case, bold,
  // letter-spaced. A transform changes only how a word is drawn, never the text a
  // reader or an oracle reads back.
  historyHeaders(view).forEach((header) => {
    const cell = element('th', 'history__header', header);
    cell.setAttribute('scope', 'col');
    headRow.append(cell);
  });
  head.append(headRow);
  table.append(head);

  const body = document.createElement('tbody');
  for (const row of rows) {
    if (row.monthLabel !== null) {
      // The day label plus the four columns: the separator spans the whole grid.
      body.append(monthSeparator(row.monthLabel, 5));
    }
    const line = document.createElement('tr');
    line.className = 'history__row';
    const label = element('th', 'history__day', row.label);
    label.setAttribute('scope', 'row');
    // Seen short, because that is what 360 px has room for, and spoken in full,
    // because 'Thu 25' names three days over the span the grid reaches.
    label.setAttribute('aria-label', row.spokenLabel);
    line.append(label);
    for (const cell of row.cells) {
      const slot = element('td', 'history__cell');
      slot.append(
        dim(
          cell.kind === 'filled'
            ? filledCell(cell, handlers)
            : cell.kind === 'awaiting'
              ? awaitingCell(cell, handlers)
              : emptyCell(cell, handlers),
          cell.dimmed,
        ),
      );
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
  // A plain group of spans rather than a list: a legend entry is one swatch, and
  // each entry is the banded thing itself, so there is no wrapper between the band
  // and the words it is published beside.
  const list = element('div', 'history__legend');
  list.setAttribute('role', 'group');
  list.setAttribute('aria-label', 'What the colours mean');
  for (const entry of historyLegend(view)) {
    const swatch = element('span', 'history__swatch');
    swatch.setAttribute(
      entry.bandKind === 'level' ? 'data-level-band' : 'data-change-band',
      entry.band,
    );
    // Drawn as the RANGE, because that is what one row has room for and what a
    // person reading the colours needs; spoken as the MEANING, because the word is
    // what anyone not reading the colours needs. It is given a role so the name is
    // honoured rather than being an attribute nothing reads.
    swatch.setAttribute('role', 'img');
    swatch.setAttribute('aria-label', entry.words);
    swatch.textContent = entry.range;
    list.append(swatch);
  }
  return list;
};

/**
 * The field the grid is searched by food with, and the foods it offers as it is
 * typed into. Its label is hidden from the eye and present to everything else, as
 * Lookup's is. The offers float OVER the grid rather than pushing it down, so
 * typing never moves a cell.
 */
const searchField = (
  query: string,
  foods: readonly string[],
  onSearch: (query: string) => void,
): HTMLElement => {
  const box = element('div', 'history__search');
  box.setAttribute('role', 'search');
  const field = document.createElement('input');
  field.className = 'field__input history__search-field';
  field.id = 'history-search';
  field.type = 'search';
  field.placeholder = 'Search by food';
  field.autocomplete = 'off';
  field.value = query;
  field.setAttribute('role', 'combobox');
  field.setAttribute('aria-autocomplete', 'list');
  field.setAttribute('aria-controls', 'history-search-foods');
  const label = document.createElement('label');
  label.className = 'visually-hidden';
  label.setAttribute('for', field.id);
  label.textContent = HISTORY_SEARCH_LABEL;

  const list = element('div', 'history__suggestions');
  list.id = 'history-search-foods';
  list.setAttribute('role', 'listbox');
  list.setAttribute('aria-label', 'Foods you have eaten');

  const close = (): void => {
    list.replaceChildren();
    list.hidden = true;
    field.setAttribute('aria-expanded', 'false');
  };

  const offer = (typed: string): void => {
    const names = suggestedFoods(foods, typed);
    if (names.length === 0) {
      close();
      return;
    }
    list.replaceChildren(
      ...names.map((name) => {
        const option = element('div', 'history__suggestion', name);
        option.setAttribute('role', 'option');
        option.setAttribute('aria-selected', 'false');
        // Pressed before the field loses focus, so the choice lands before the
        // offers are closed by the blur.
        option.addEventListener('mousedown', (event) => event.preventDefault());
        option.addEventListener('click', () => {
          field.value = name;
          close();
          onSearch(name);
        });
        return option;
      }),
    );
    list.hidden = false;
    field.setAttribute('aria-expanded', 'true');
  };

  close();
  field.addEventListener('input', () => {
    onSearch(field.value);
    offer(field.value);
  });
  field.addEventListener('focus', () => offer(field.value));
  field.addEventListener('blur', close);
  // Enter keeps what was typed as the search -- a keyword such as a restaurant's
  // name, which greys out every food not carrying it -- and puts the list away,
  // along with a phone's keyboard, so the grid it greys can be seen.
  field.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') close();
    if (event.key === 'Enter') {
      event.preventDefault();
      close();
      field.blur();
    }
  });

  box.append(label, field, list);
  return box;
};

export const historyScreen = (
  view: HistoryScreenView,
  handlers: HistoryHandlers,
): HTMLElement => {
  const screen = element('div', 'history-screen');
  // The view and nothing else: there is no period control, because the grid runs
  // back to ninety days or the earliest recorded entry, whichever is earlier, and
  // going further back is scrolling.
  screen.append(viewChooser(view.view, handlers));

  if (view.state.kind === 'loading') {
    // Deliberately no grid while the read is in flight: a page of empty outlines
    // would read as ninety days with nothing recorded rather than as a record not
    // yet read.
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
  region.className = HISTORY_SCROLLER_CLASS;
  region.setAttribute('aria-label', HISTORY_REGION_LABEL);
  const rows = view.state.rows;
  region.append(gridTable(searchHistoryRows(rows, view.query), view.view, handlers));

  /**
   * Searching redraws THE GRID and nothing else, as Lookup's field does: rebuilding
   * the whole screen would replace the field being typed into and take the caret
   * with it. The rows are the same rows, only greyed differently, so the grid stays
   * scrolled exactly where it was. What was typed is still recorded outside the
   * screen, so a redraw for any other reason keeps it.
   */
  const search = searchField(view.query, view.state.foods, (typed) => {
    handlers.onQuery(typed);
    const scrolled = region.scrollTop;
    region.replaceChildren(gridTable(searchHistoryRows(rows, typed), view.view, handlers));
    region.scrollTop = scrolled;
  });

  screen.append(search, region);
  screen.append(element('p', 'history__caption', historyCaption(view.view)));
  screen.append(legend(view.view));
  return screen;
};
