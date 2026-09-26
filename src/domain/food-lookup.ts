// Looking a food up in the log: which past meals contained it, how they read, and
// the three figures that summarise them.
//
// Every rule this value is judged on lives here rather than in a query or in the
// screen: what counts as a match, what order the results come in, and the
// arithmetic of the three figures. No DOM and no SDK, so the arithmetic is
// testable on its own.
//
// The figures are REPORTS of what was recorded before. A typical dose is what was
// taken, never what should be taken, and nothing here proposes anything.

import { changeBand, type ChangeBand } from './band';
import {
  changeText,
  doseText,
  foodsText,
  slotLabel,
  type FoodPortion,
} from './entry';
import type { MealInstance } from './meal-identity';

/**
 * 'Thu 10 Sep'. Deliberately not toLocaleDateString, for the reason the night
 * list already gives: the date on a result is part of what this screen is judged
 * on, so it is built from a fixed vocabulary rather than from whatever the
 * runtime's locale data happens to say -- which would put the month before the
 * day on one machine and after it on another.
 */
const SHORT_WEEKDAYS: readonly string[] = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const SHORT_MONTHS: readonly string[] = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

const localDate = (date: string): Date => {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  return new Date(year, month - 1, day);
};

export const lookupDateText = (date: string): string => {
  const at = localDate(date);
  return `${SHORT_WEEKDAYS[at.getDay()]} ${at.getDate()} ${SHORT_MONTHS[at.getMonth()]}`;
};

/** Whole numbers read as whole numbers: 250 is '250', never '250.00'. */
const numberText = (value: number): string =>
  Number.isInteger(value) ? String(value) : String(Number(value.toFixed(2)));

/**
 * Halves away from zero, which is the one rounding rule this module uses. The
 * platform's own Math.round rounds −0.5 towards zero, so a negative value is
 * rounded by magnitude and given its sign back.
 */
const roundHalfAwayFromZero = (value: number): number =>
  value < 0 ? -Math.round(-value) : Math.round(value);

/**
 * The middle value of the sorted list when the count is odd, and the mean of the
 * two middle values -- rounded to the nearest whole number, halves away from zero
 * -- when it is even. Nothing at all over an empty list: a median of no values is
 * not zero.
 */
export const median = (values: readonly number[]): number | null => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = sorted.length >> 1;
  if (sorted.length % 2 === 1) return sorted[middle] as number;
  return roundHalfAwayFromZero(((sorted[middle - 1] as number) + (sorted[middle] as number)) / 2);
};

/**
 * The arithmetic mean, rounded to the nearest whole number, halves away from
 * zero. Nothing at all over an empty list, for the same reason as the median.
 */
export const meanOf = (values: readonly number[]): number | null =>
  values.length === 0
    ? null
    : roundHalfAwayFromZero(values.reduce((total, value) => total + value, 0) / values.length);

/** The typed text as matching sees it: trimmed and folded to one case. */
const normalise = (text: string): string => text.trim().toLowerCase();

/**
 * A food matches when its name CONTAINS the typed text, compared trimmed and
 * case-insensitively: 'rice' finds 'Chicken rice', because a person searching
 * their own log types a fragment and not an exact name.
 */
export const foodMatches = (food: FoodPortion, query: string): boolean =>
  normalise(food.name).includes(normalise(query));

/** A meal matches when any of its foods does. */
export const mealMatches = (meal: MealInstance, query: string): boolean =>
  meal.foods.some((food) => foodMatches(food, query));

/**
 * Newest first: by the day the meal belongs to, then by its clock time. The day
 * leads, because which day a meal belongs to is the day its writer meant and not
 * whatever a timestamp's offset would make of it.
 */
const newestFirst = (a: MealInstance, b: MealInstance): number =>
  a.eatenOn === b.eatenOn
    ? b.eatenAt.getTime() - a.eatenAt.getTime()
    : a.eatenOn < b.eatenOn
      ? 1
      : -1;

/** The matching meals, newest first. */
export const matchingMeals = (
  history: readonly MealInstance[],
  query: string,
): readonly MealInstance[] =>
  history.filter((meal) => mealMatches(meal, query)).slice().sort(newestFirst);

/**
 * One result as the screen reads it: 'Thu 10 Sep · Dinner', '6 u', the foods with
 * their amounts, and the two readings with the banded change. The change is
 * absent when the meal has no after reading, exactly as a Today card is: a change
 * nobody measured must never be drawn as zero.
 */
export type LookupResult = {
  readonly id: string;
  readonly date: string;
  readonly slot: string;
  readonly dose: string | null;
  readonly foods: string | null;
  readonly before: string | null;
  readonly after: string | null;
  readonly change: { readonly text: string; readonly band: ChangeBand } | null;
  /** The accessible name of the way in, which names the meal in words. */
  readonly openLabel: string;
};

/** After minus before, or nothing when either reading is missing. */
const changeOf = (meal: MealInstance): number | null =>
  meal.glucoseBefore === null || meal.glucoseAfter === null
    ? null
    : meal.glucoseAfter - meal.glucoseBefore;

const readingText = (value: number | null): string | null =>
  value === null ? null : numberText(value);

const resultOf = (meal: MealInstance): LookupResult => {
  const change = changeOf(meal);
  return {
    id: meal.id,
    date: lookupDateText(meal.eatenOn),
    slot: slotLabel(meal.slot),
    dose: doseText(meal.insulinUnits),
    foods: foodsText(meal.foods),
    before: readingText(meal.glucoseBefore),
    after: readingText(meal.glucoseAfter),
    change: change === null ? null : { text: changeText(change), band: changeBand(change) },
    openLabel: `View ${meal.slot} on ${lookupDateText(meal.eatenOn)}`,
  };
};

/**
 * One summary figure. It carries the number of meals it is over as well as its
 * value, so a figure over two meals can never be mistaken for one over twenty,
 * and `value` is absent when no matching meal recorded what it is made of.
 */
export type LookupFigure = {
  readonly name: string;
  readonly value: string | null;
  readonly meals: number;
  /**
   * Said only when it needs saying: which unit the typical amount is in, when the
   * matched food was recorded in more than one.
   */
  readonly note?: string | undefined;
};

export type LookupSummary = {
  /** 'Chicken rice · 4 meals': the food this matched, and how many meals it is over. */
  readonly heading: string;
  readonly figures: readonly LookupFigure[];
};

/** One matched portion: which meal it was in, and what was recorded of it. */
type MatchedPortion = {
  readonly mealId: string;
  readonly name: string;
  readonly amount: number;
  readonly unit: string | null;
};

const matchedPortions = (
  meals: readonly MealInstance[],
  query: string,
): readonly MatchedPortion[] =>
  meals.flatMap((meal) =>
    meal.foods
      .filter((food) => foodMatches(food, query) && food.amount !== null)
      .map((food) => ({
        mealId: meal.id,
        name: food.name.trim(),
        amount: food.amount as number,
        unit: food.unit,
      })),
  );

/**
 * The commonest value, with the first one seen winning a tie. The meals arrive
 * newest first, so a tie is settled by the most recent meal -- which is the one
 * the person most likely has in mind.
 */
const commonest = <T>(values: readonly T[]): T | null => {
  let best: T | null = null;
  let bestCount = 0;
  for (const value of values) {
    const count = values.filter((other) => other === value).length;
    if (count > bestCount) {
      best = value;
      bestCount = count;
    }
  }
  return best;
};

/** The food the summary names: the commonest matched name among the results. */
const matchedName = (
  portions: readonly MatchedPortion[],
  meals: readonly MealInstance[],
  query: string,
): string => {
  // A matched food with no amount recorded is still the food that matched, so the
  // name falls back to the matching foods themselves rather than to the typed text.
  const named =
    portions.length > 0
      ? portions.map((portion) => portion.name)
      : meals.flatMap((meal) =>
          meal.foods.filter((food) => foodMatches(food, query)).map((food) => food.name.trim()),
        );
  return commonest(named) ?? query.trim();
};

const mealsBehind = (ids: readonly string[]): number => new Set(ids).size;

/**
 * TYPICAL AMOUNT: the median of the matched food's OWN amounts, reported with its
 * unit. Where the matched food appears with more than one unit, the median is
 * taken within the commonest unit and the figure says which, because a median
 * across grams and millilitres would be a number of nothing.
 */
const amountFigure = (portions: readonly MatchedPortion[]): LookupFigure => {
  const units = portions.map((portion) => portion.unit);
  const unit = commonest(units);
  const inUnit = portions.filter((portion) => portion.unit === unit);
  const middle = median(inUnit.map((portion) => portion.amount));
  const mixed = new Set(units).size > 1;
  return {
    name: 'Typical amount',
    value:
      middle === null
        ? null
        : unit === null
          ? numberText(middle)
          : `${numberText(middle)} ${unit}`,
    meals: mealsBehind(inUnit.map((portion) => portion.mealId)),
    ...(mixed && unit !== null ? { note: `measured in ${unit}` } : {}),
  };
};

/**
 * TYPICAL DOSE: the median of the doses of the matching meals that recorded one. A
 * meal with no dose contributes nothing rather than contributing a zero, and the
 * count says how many meals are behind it. This is a report of what was taken
 * before; it is never a proposal.
 */
const doseFigure = (meals: readonly MealInstance[]): LookupFigure => {
  const dosed = meals.filter((meal) => meal.insulinUnits !== null);
  const middle = median(dosed.map((meal) => meal.insulinUnits as number));
  return {
    name: 'Typical dose',
    value: middle === null ? null : doseText(middle),
    meals: dosed.length,
  };
};

/**
 * AVERAGE CHANGE: the mean of the changes of the matching meals that have BOTH
 * readings, written with its sign. A meal with no after reading is still a meal
 * that contained the food, so it is listed, but it contributes nothing here: a
 * change nobody measured is not a change of zero, and the count is what makes
 * that visible beside a longer list of results.
 */
const changeFigure = (meals: readonly MealInstance[]): LookupFigure => {
  const changes = meals
    .map(changeOf)
    .filter((change): change is number => change !== null);
  const average = meanOf(changes);
  return {
    name: 'Average change',
    value: average === null ? null : changeText(average),
    meals: changes.length,
  };
};

/** '1 meal', '4 meals': the number of meals a figure or a heading is over. */
export const mealCountText = (meals: number): string =>
  `${meals} ${meals === 1 ? 'meal' : 'meals'}`;

/** 'Chicken rice · 4 meals'. */
export const summaryHeading = (food: string, meals: number): string =>
  `${food} · ${mealCountText(meals)}`;

/** What the results area says when the search box is empty. */
export const LOOKUP_INVITATION = 'Type a food to find the meals you ate it in.';

/** What the results area says when nothing matched. */
export const NO_LOOKUP_MATCHES = 'No meals with that food yet.';

/**
 * The whole screen below the search box. An empty box invites a search rather
 * than listing everything the account owns, and no match has no summary at all,
 * because a summary over nothing would print figures with no meals behind them.
 */
export type LookupView =
  | { readonly kind: 'inviting'; readonly message: string }
  | { readonly kind: 'none'; readonly message: string }
  | {
      readonly kind: 'found';
      readonly summary: LookupSummary;
      readonly results: readonly LookupResult[];
    };

export const lookupView = (history: readonly MealInstance[], query: string): LookupView => {
  if (normalise(query) === '') return { kind: 'inviting', message: LOOKUP_INVITATION };

  const meals = matchingMeals(history, query);
  if (meals.length === 0) return { kind: 'none', message: NO_LOOKUP_MATCHES };

  const portions = matchedPortions(meals, query);
  return {
    kind: 'found',
    summary: {
      heading: summaryHeading(matchedName(portions, meals, query), meals.length),
      figures: [amountFigure(portions), doseFigure(meals), changeFigure(meals)],
    },
    results: meals.map(resultOf),
  };
};
