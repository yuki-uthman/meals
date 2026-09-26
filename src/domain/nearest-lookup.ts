// Looking a CHANGE up in the log: which past meals moved the glucose by about the
// amount asked for, nearest first, and how far off each one was.
//
// Every rule this value is judged on lives here rather than in a query or in the
// screen: what a window admits, how far off a meal is, and what order the results
// come in. No DOM and no SDK, so the arithmetic is testable on its own.
//
// A window is a TOLERANCE, not a ranking. A meal outside it is not listed at all,
// however close the next nearest is, because the person chose how much slack they
// would accept. Nothing here proposes a dose: every result reports a dose already
// taken and a change that already happened.

import { changeBand } from './band';
import { changeText, doseText, foodsText, slotLabel } from './entry';
import { lookupDateText, type LookupResult } from './food-lookup';
import type { MealInstance } from './meal-identity';

/** The three windows the screen offers, and the one it starts on. */
export const CHANGE_WINDOWS = [2, 5, 10] as const;

export type ChangeWindow = (typeof CHANGE_WINDOWS)[number];

export const DEFAULT_CHANGE_WINDOW: ChangeWindow = 5;

/** '±5': how a window is named, wherever it is named. */
export const changeWindowLabel = (bound: ChangeWindow): string => `±${bound}`;

/**
 * The target as typed. It is a SIGNED whole number, because −20 and +40 are both
 * askable: a person asking what dropped them by twenty is asking the same kind of
 * question as one asking what raised them by forty. Anything that is not a signed
 * whole number is nothing at all rather than zero -- an empty box, a lone minus
 * sign part-way through typing -- so the screen goes on inviting a target instead
 * of answering a question nobody asked.
 */
export const parseChangeTarget = (typed: string): number | null => {
  const text = typed.trim();
  if (!/^[+-]?\d+$/.test(text)) return null;
  const value = Number(text);
  return Number.isFinite(value) ? value : null;
};

/** After minus before, or nothing when either reading is missing. */
const changeOf = (meal: MealInstance): number | null =>
  meal.glucoseBefore === null || meal.glucoseAfter === null
    ? null
    : meal.glucoseAfter - meal.glucoseBefore;

/**
 * How far off a meal was, in WORDS. 'exact' when the change equals the target,
 * because a distance of nothing is a different statement from a distance of zero
 * units, and never a signed number, which would be read as another change.
 */
export const distanceText = (distance: number): string =>
  distance === 0 ? 'exact' : `${distance} off`;

/**
 * One result: the same card a food lookup result is -- date and slot, dose, foods
 * with amounts, and the two readings with the banded change -- and how far off the
 * change was. One result card, three lookups: a person should not have to relearn
 * the row.
 */
export type NearestResult = LookupResult & {
  /** 'exact', '3 off'. */
  readonly distance: string;
};

/** A meal that is in the window, with the arithmetic that put it there. */
type Nearest = {
  readonly meal: MealInstance;
  readonly change: number;
  readonly distance: number;
};

/**
 * Nearest first, ties broken by date, newer first, so the order is total: the day
 * the meal belongs to leads, because that is the day its writer meant, and the
 * clock time settles two meals on one day.
 */
const nearestFirst = (a: Nearest, b: Nearest): number => {
  if (a.distance !== b.distance) return a.distance - b.distance;
  if (a.meal.eatenOn !== b.meal.eatenOn) return a.meal.eatenOn < b.meal.eatenOn ? 1 : -1;
  return b.meal.eatenAt.getTime() - a.meal.eatenAt.getTime();
};

/**
 * The meals within the window of the target, nearest first. Only meals with BOTH
 * readings can be here, because a change needs both: a meal with no after reading
 * has no change, so it is absent rather than listed with an empty distance.
 */
export const nearestByChange = (
  history: readonly MealInstance[],
  target: number,
  bound: ChangeWindow,
): readonly MealInstance[] =>
  history
    .flatMap((meal) => {
      const change = changeOf(meal);
      if (change === null) return [];
      const distance = Math.abs(change - target);
      // The bound is a tolerance: outside it the meal is not listed at all.
      return distance > bound ? [] : [{ meal, change, distance }];
    })
    .sort(nearestFirst)
    .map((nearest) => nearest.meal);

const resultOf = (meal: MealInstance, target: number): NearestResult => {
  // Only meals with both readings reach here, so the change is a number.
  const change = (meal.glucoseAfter as number) - (meal.glucoseBefore as number);
  return {
    id: meal.id,
    date: lookupDateText(meal.eatenOn),
    slot: slotLabel(meal.slot),
    dose: doseText(meal.insulinUnits),
    foods: foodsText(meal.foods),
    before: String(meal.glucoseBefore),
    after: String(meal.glucoseAfter),
    change: { text: changeText(change), band: changeBand(change) },
    openLabel: `View ${meal.slot} on ${lookupDateText(meal.eatenOn)}`,
    distance: distanceText(Math.abs(change - target)),
  };
};

/** What the results area says with no target entered. */
export const CHANGE_INVITATION = 'Enter a change to find the meals nearest to it.';

/**
 * What it says when the window admits nothing. It names the WINDOW rather than the
 * target, because widening the window is the move that finds something.
 */
export const NO_CHANGE_MATCHES = 'No meals within that window.';

export type NearestView =
  | { readonly kind: 'inviting'; readonly message: string }
  | { readonly kind: 'none'; readonly message: string }
  | { readonly kind: 'found'; readonly results: readonly NearestResult[] };

export const nearestView = (
  history: readonly MealInstance[],
  typed: string,
  bound: ChangeWindow,
): NearestView => {
  const target = parseChangeTarget(typed);
  // With no target the screen invites one rather than listing everything.
  if (target === null) return { kind: 'inviting', message: CHANGE_INVITATION };

  const meals = nearestByChange(history, target, bound);
  if (meals.length === 0) return { kind: 'none', message: NO_CHANGE_MATCHES };
  return { kind: 'found', results: meals.map((meal) => resultOf(meal, target)) };
};
