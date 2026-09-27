// The History grid, as a value. No DOM and no SDK here, so the rule the grid is
// judged on -- which reading sits in which column, and which band it falls in --
// is a pure function of what the store handed back.
//
// One row per calendar date, newest first, and four columns. The first is the
// night that led INTO that day, so reading a row left to right is chronological:
// overnight, then breakfast, lunch and dinner.
//
// Two things are deliberately not invented here. The night's morning reading is
// the one value 4 already derives -- the earliest before reading on the row's own
// date -- rather than a second kind of reading nobody records; and a reading that
// was never taken produces an empty cell rather than a change of zero.

import { changeBand, levelBand, type ChangeBand, type LevelBand } from './band';
import {
  changeText,
  shiftDate,
  slotLabel,
  type IsoDate,
  type MealSlot,
  type NightInsulin,
} from './entry';
import { morningReading, shortNightDate } from './night';
import type { RecentMeal } from './recent-readings';

/**
 * The raw material a grid is read from: the meals in the range, and the nights
 * that led into its dates. The store hands back both and the rules below decide
 * what a cell says, so nothing about the grid is buried in a query.
 */
export type HistoryWindow = {
  readonly meals: readonly RecentMeal[];
  readonly nights: readonly NightInsulin[];
};

export const emptyHistoryWindow: HistoryWindow = { meals: [], nights: [] };

/**
 * Which half of each pair the grid is showing. Before is coloured by the LEVEL
 * of the reading; Change and Both are coloured by the CHANGE, and never by the
 * level.
 */
export type HistoryView = 'before' | 'change' | 'both';

export const HISTORY_VIEWS: readonly HistoryView[] = ['before', 'change', 'both'];

const VIEW_LABELS: Readonly<Record<HistoryView, string>> = {
  before: 'Before',
  change: 'Change',
  both: 'Both',
};

export const historyViewLabel = (view: HistoryView): string => VIEW_LABELS[view];

/**
 * The caption says which of the two the colour is, in words, because a legend
 * alone leaves a reader to infer it.
 */
export const LEVEL_CAPTION = 'Colour is the level of that reading. Tap a cell to open that meal.';
export const CHANGE_CAPTION = 'Colour is the change, not the level. Tap a cell to open that meal.';

export const historyCaption = (view: HistoryView): string =>
  view === 'before' ? LEVEL_CAPTION : CHANGE_CAPTION;

/**
 * The first column's header follows the view: it is a night-and-morning pair,
 * and the header says which half is being shown.
 */
const NIGHT_HEADERS: Readonly<Record<HistoryView, string>> = {
  before: 'Bedtime',
  change: 'Overnight',
  both: 'Night',
};

export const nightColumnHeader = (view: HistoryView): string => NIGHT_HEADERS[view];

/** The three meal columns, in the order the grid shows them. */
export const HISTORY_SLOTS: readonly MealSlot[] = ['breakfast', 'lunch', 'dinner'];

export const historyHeaders = (view: HistoryView): readonly string[] => [
  nightColumnHeader(view),
  ...HISTORY_SLOTS.map(slotLabel),
];

// --------------------------------------------------- how far back a grid runs

/**
 * There are no periods. The grid runs from today back to whichever is EARLIER --
 * ninety days ago, or the oldest recorded entry -- and the page scrolls, so going
 * further back is scrolling rather than finding a chip before older days appear.
 *
 * Ninety days is the FLOOR because backfilling is the point: the days worth
 * filling in are by definition days with nothing in them, so a grid bounded by
 * existing data could never reach them. Scrolling stops at the floor, or at the
 * oldest entry when the record runs back further, rather than running into an
 * unbounded empty past.
 */
export const HISTORY_ROW_FLOOR = 90;

/**
 * The date the grid's one read starts from: before any entry can exist, so the
 * read covers the whole record. For one or two people's log the whole record is
 * already in hand -- which is why History adds no pagination -- and the earliest
 * row is then read off what came back rather than guessed at beforehand.
 */
export const HISTORY_RECORD_START: IsoDate = '1970-01-01';

/** Whole days since the epoch, so a span is arithmetic and never a timezone. */
const dayNumber = (date: IsoDate): number => {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  return Math.round(Date.UTC(year, month - 1, day) / 86_400_000);
};

const earlier = (a: IsoDate | null, b: IsoDate): IsoDate => (a === null || b < a ? b : a);

/**
 * The oldest date the record reaches, as a ROW: a meal's own date, and for a
 * night the date it led into, which is the day after the night record. Null when
 * the account has recorded nothing at all.
 */
export const earliestRecordedDate = (window: HistoryWindow): IsoDate | null => {
  let earliest: IsoDate | null = null;
  for (const meal of window.meals) earliest = earlier(earliest, meal.eatenOn);
  for (const night of window.nights) earliest = earlier(earliest, shiftDate(night.nightOn, 1));
  return earliest;
};

/**
 * The dates the grid draws, newest first: today back to the earliest recorded
 * entry, and never fewer than the floor.
 */
export const historyDates = (today: IsoDate, window: HistoryWindow): readonly IsoDate[] => {
  const earliest = earliestRecordedDate(window);
  const span = earliest === null ? 0 : dayNumber(today) - dayNumber(earliest) + 1;
  const days = Math.max(HISTORY_ROW_FLOOR, span);
  return Array.from({ length: days }, (_unused, index) => shiftDate(today, -index));
};

// -------------------------------------------------------------------- cells

/**
 * What a cell opens. EVERY cell opens something: a cell with nothing behind it is
 * where a day kept on paper gets filled in, and an untappable empty cell would
 * make the one screen that shows a missing day the one screen that cannot fill it.
 */
export type CellTarget =
  /**
   * The meal's own row, and the date it was eaten on. The date travels with the
   * id because opening the cell opens that meal's EDIT form, which records
   * against a date: taking it from the cell rather than from whatever day happens
   * to be loaded is what stops an edit moving the meal to another day.
   */
  | { readonly kind: 'meal'; readonly id: string; readonly eatenOn: IsoDate }
  /** The night record's own date, which is the day BEFORE the row it appears in. */
  | { readonly kind: 'night'; readonly nightOn: IsoDate }
  /**
   * A new entry for that date and that slot: what an empty slot cell opens, with
   * both already chosen, so saving records against the cell's own date rather than
   * against today.
   */
  | { readonly kind: 'new-meal'; readonly date: IsoDate; readonly slot: MealSlot };

export type FilledCell = {
  readonly kind: 'filled';
  /** One reading in Before and Change, two in Both. Always whole mg/dL. */
  readonly readings: readonly string[];
  readonly band: LevelBand | ChangeBand;
  /** Which kind of band this is, so the surface publishes one attribute or the other. */
  readonly bandKind: 'level' | 'change';
  /** The accessible name: its day, its column and its readings, said in words. */
  readonly name: string;
  readonly target: CellTarget;
};

/**
 * Nothing behind it: an empty outline carrying no band and no digits. It is still
 * a control, and what it opens is a new entry for that date and that column, which
 * is the whole reason History exists for somebody who has kept this log on paper.
 */
export type EmptyCell = {
  readonly kind: 'empty';
  /** Its day and its column in words, because a blank square says nothing. */
  readonly name: string;
  readonly target: CellTarget;
};

export type HistoryCell = FilledCell | EmptyCell;

export type HistoryRow = {
  readonly date: IsoDate;
  /** The short day label, 'Tue 22', which is what the 360 px grid has room for. */
  readonly label: string;
  /**
   * The same date said unambiguously, 'Thursday 25 September': over ninety days the
   * short label repeats three times, so this is what identifies one row rather than
   * its two namesakes a month apart, and it is the row's accessible name.
   */
  readonly spokenLabel: string;
  /**
   * The month this row begins, named, or null in the middle of one. Without it a
   * person scrolling back to a particular week cannot tell which of three months
   * with a 'Tue 22' in them they are looking at.
   */
  readonly monthLabel: string | null;
  /** Exactly four: the night, then breakfast, lunch and dinner. */
  readonly cells: readonly HistoryCell[];
};

const reading = (value: number): string => String(Math.round(value));

const named = (label: string, column: string, readings: readonly string[]): string =>
  `${label} ${column} ${readings.join(' to ')}`;

/**
 * Deliberately not toLocaleDateString: a row's spoken date is part of what the
 * grid is judged on -- it is how one day is named -- so it is built from a fixed
 * vocabulary rather than from whatever the runtime's locale data happens to say.
 */
const LONG_WEEKDAYS: readonly string[] = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
];

const LONG_MONTHS: readonly string[] = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

const localDate = (date: IsoDate): Date => {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  return new Date(year, month - 1, day);
};

/** 'Thursday 25 September': the row's accessible name, never its visible text. */
export const spokenHistoryDate = (date: IsoDate): string => {
  const at = localDate(date);
  return `${LONG_WEEKDAYS[at.getDay()]} ${at.getDate()} ${LONG_MONTHS[at.getMonth()]}`;
};

/**
 * 'September': what a month separator says. The month alone follows the reader's
 * own locale, because nothing is matched on it beyond the month it names.
 */
export const historyMonthLabel = (date: IsoDate): string =>
  localDate(date).toLocaleDateString(undefined, { month: 'long' });

/** Its day and its column, and that there is nothing in it yet. */
const emptyName = (label: string, column: string): string =>
  `${label} ${column} nothing recorded`;

const empty = (label: string, column: string, target: CellTarget): EmptyCell => ({
  kind: 'empty',
  name: emptyName(label, column),
  target,
});

const byTimeAscending = (a: RecentMeal, b: RecentMeal): number =>
  a.eatenAt.getTime() - b.eatenAt.getTime();

/** The day's meal in that slot: the earliest, when the day holds more than one. */
const mealIn = (
  meals: readonly RecentMeal[],
  date: IsoDate,
  slot: MealSlot,
): RecentMeal | undefined =>
  meals.filter((meal) => meal.eatenOn === date && meal.slot === slot).sort(byTimeAscending)[0];

const mealCell = (
  meal: RecentMeal | undefined,
  date: IsoDate,
  slot: MealSlot,
  label: string,
  column: string,
  view: HistoryView,
): HistoryCell => {
  // Nothing behind it opens a NEW meal for this date and this slot, both already
  // chosen: the empty cell is where a day kept on paper gets filled in.
  const fillIn = (): EmptyCell => empty(label, column, { kind: 'new-meal', date, slot });

  if (meal === undefined) return fillIn();
  const before = meal.glucoseBefore;
  const after = meal.glucoseAfter;
  const target: CellTarget = { kind: 'meal', id: meal.id, eatenOn: meal.eatenOn };

  // A meal that is recorded but has no reading to show in this view is still an
  // entry, so its empty cell opens THAT meal rather than offering a second one.
  const nothingToShow = (): EmptyCell => empty(label, column, target);

  if (view === 'before') {
    if (before === null) return nothingToShow();
    const readings = [reading(before)];
    return {
      kind: 'filled',
      readings,
      band: levelBand(before),
      bandKind: 'level',
      name: named(label, column, readings),
      target,
    };
  }

  // No after reading means no change exists, so Change and Both are empty. A
  // missing measurement is never drawn as a change of zero.
  if (before === null || after === null) return nothingToShow();
  const change = after - before;
  const readings = view === 'change' ? [changeText(change)] : [reading(before), reading(after)];
  return {
    kind: 'filled',
    readings,
    band: changeBand(change),
    bandKind: 'change',
    name: named(label, column, readings),
    target,
  };
};

const nightCell = (
  window: HistoryWindow,
  date: IsoDate,
  label: string,
  column: string,
  view: HistoryView,
): HistoryCell => {
  // The night that led INTO this date is the night record dated the day before it.
  const nightOn = shiftDate(date, -1);
  const night = window.nights.find((candidate) => candidate.nightOn === nightOn);
  const target: CellTarget = { kind: 'night', nightOn };
  // Empty or not, a night cell opens the night screen for ITS OWN night, which is
  // that record's own editor and, where there is no record, where one is filled in.
  const nothingToShow = (): EmptyCell => empty(label, column, target);

  if (night === undefined) return nothingToShow();

  const bedtime = night.bedtimeGlucose;

  if (view === 'before') {
    if (bedtime === null) return nothingToShow();
    const readings = [reading(bedtime)];
    return {
      kind: 'filled',
      readings,
      band: levelBand(bedtime),
      bandKind: 'level',
      name: named(label, column, readings),
      target,
    };
  }

  // The morning reading is the one value 4 derives: the earliest before reading
  // on the row's OWN date. Nobody measured means no change, not a change of zero.
  const morning = morningReading(window.meals, date);
  if (bedtime === null || morning === null) return nothingToShow();
  const change = morning - bedtime;
  const readings = view === 'change' ? [changeText(change)] : [reading(bedtime), reading(morning)];
  return {
    kind: 'filled',
    readings,
    band: changeBand(change),
    bandKind: 'change',
    name: named(label, column, readings),
    target,
  };
};

/** One row per date, newest first, each with its four chronological columns. */
export const historyRows = (
  window: HistoryWindow,
  dates: readonly IsoDate[],
  view: HistoryView,
): readonly HistoryRow[] => {
  const nightColumn = nightColumnHeader(view);
  // Where each month the grid reaches begins, read down the rows as they are shown:
  // the label goes on the first row of each month rather than on a fixed set of
  // twelve, so the separator marks THIS span and nothing wider.
  let previousMonth: string | null = null;
  return dates.map((date): HistoryRow => {
    const label = shortNightDate(date);
    const month = historyMonthLabel(date);
    const monthLabel = month === previousMonth ? null : month;
    previousMonth = month;
    return {
      date,
      label,
      spokenLabel: spokenHistoryDate(date),
      monthLabel,
      cells: [
        nightCell(window, date, label, nightColumn, view),
        ...HISTORY_SLOTS.map((slot) =>
          mealCell(mealIn(window.meals, date, slot), date, slot, label, slotLabel(slot), view),
        ),
      ],
    };
  });
};

// ------------------------------------------------------------------- legend

export type LegendEntry = {
  readonly band: LevelBand | ChangeBand;
  readonly bandKind: 'level' | 'change';
  /** The band named in words, because a coloured square says nothing on its own. */
  readonly words: string;
};

const LEVEL_LEGEND: readonly LegendEntry[] = [
  { band: 'low', bandKind: 'level', words: 'Low, under 70' },
  { band: 'in-range', bandKind: 'level', words: 'In range, 70 to 180' },
  { band: 'high', bandKind: 'level', words: 'High, 181 to 250' },
  { band: 'very-high', bandKind: 'level', words: 'Very high, over 250' },
];

const CHANGE_LEGEND: readonly LegendEntry[] = [
  { band: 'dropped', bandKind: 'change', words: 'Dropped, 40 or more' },
  { band: 'stable', bandKind: 'change', words: 'Stable' },
  { band: 'rose', bandKind: 'change', words: 'Rose, up to 60' },
  { band: 'rose-high', bandKind: 'change', words: 'Rose sharply, over 60' },
];

/**
 * The legend follows the view. One that did not switch would tell the reader the
 * wrong thing about the colours in front of them.
 */
export const historyLegend = (view: HistoryView): readonly LegendEntry[] =>
  view === 'before' ? LEVEL_LEGEND : CHANGE_LEGEND;
