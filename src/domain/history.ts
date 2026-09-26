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

// ------------------------------------------------------------------ periods

export type HistoryPeriodKey = '2-weeks' | '1-month' | '3-months';

export type HistoryPeriod = {
  readonly key: HistoryPeriodKey;
  readonly label: string;
  /** How many calendar dates the grid is bounded to, ending with today. */
  readonly days: number;
};

/**
 * Three periods, defaulting to a fortnight. Without one the grid would be
 * unbounded, and 'one row per day' needs a range to be one of.
 */
export const HISTORY_PERIODS: readonly HistoryPeriod[] = [
  { key: '2-weeks', label: '2 weeks', days: 14 },
  { key: '1-month', label: '1 month', days: 30 },
  { key: '3-months', label: '3 months', days: 90 },
];

export const DEFAULT_HISTORY_PERIOD: HistoryPeriodKey = '2-weeks';

export const historyPeriod = (key: HistoryPeriodKey): HistoryPeriod =>
  HISTORY_PERIODS.find((period) => period.key === key) ?? (HISTORY_PERIODS[0] as HistoryPeriod);

/** The widest period there is: what one read has to cover so that changing the bound is free. */
export const LONGEST_HISTORY_DAYS: number = HISTORY_PERIODS.reduce(
  (widest, period) => Math.max(widest, period.days),
  0,
);

/** The dates of a period, newest first, ending with today. */
export const historyDates = (today: IsoDate, days: number): readonly IsoDate[] =>
  Array.from({ length: days }, (_unused, index) => shiftDate(today, -index));

// -------------------------------------------------------------------- cells

/** What a populated cell opens. A cell with nothing behind it opens nothing. */
export type CellTarget =
  | { readonly kind: 'meal'; readonly id: string }
  /** The night record's own date, which is the day BEFORE the row it appears in. */
  | { readonly kind: 'night'; readonly nightOn: IsoDate };

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

/** Nothing behind it: an empty outline, no band, no digits and nothing to tap. */
export type EmptyCell = { readonly kind: 'empty' };

export type HistoryCell = FilledCell | EmptyCell;

const EMPTY: EmptyCell = { kind: 'empty' };

export type HistoryRow = {
  readonly date: IsoDate;
  /** The short day label, 'Tue 22', which is what says which date this row is. */
  readonly label: string;
  /** Exactly four: the night, then breakfast, lunch and dinner. */
  readonly cells: readonly HistoryCell[];
};

const reading = (value: number): string => String(Math.round(value));

const named = (label: string, column: string, readings: readonly string[]): string =>
  `${label} ${column} ${readings.join(' to ')}`;

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
  label: string,
  column: string,
  view: HistoryView,
): HistoryCell => {
  if (meal === undefined) return EMPTY;
  const before = meal.glucoseBefore;
  const after = meal.glucoseAfter;
  const target: CellTarget = { kind: 'meal', id: meal.id };

  if (view === 'before') {
    if (before === null) return EMPTY;
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
  if (before === null || after === null) return EMPTY;
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
  if (night === undefined) return EMPTY;

  const bedtime = night.bedtimeGlucose;
  const target: CellTarget = { kind: 'night', nightOn };

  if (view === 'before') {
    if (bedtime === null) return EMPTY;
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
  if (bedtime === null || morning === null) return EMPTY;
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
  return dates.map((date): HistoryRow => {
    const label = shortNightDate(date);
    return {
      date,
      label,
      cells: [
        nightCell(window, date, label, nightColumn, view),
        ...HISTORY_SLOTS.map((slot) =>
          mealCell(mealIn(window.meals, date, slot), label, slotLabel(slot), view),
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
