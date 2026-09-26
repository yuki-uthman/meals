// What makes two meals the same meal, and how the instances of one meal read.
//
// Sameness is the multiset of (name, amount, unit) over a meal's foods: the name
// trimmed and compared case-insensitively, the amount and the unit exactly, and
// the order of the foods irrelevant. The food TYPE is deliberately not part of
// identity -- the brief defines sameness by foods, amounts and units, and a type
// is a classification of a food rather than a property of the meal.
//
// The key is computed here rather than in SQL because it is a multiset over
// related rows. If that ever stops being cheap the key becomes a stored column,
// and the rule still lives in exactly this one place.

import { changeBand } from './band';
import {
  changeText,
  clockTime,
  doseText,
  slotLabel,
  type ChangeReading,
  type FoodPortion,
  type IsoDate,
  type MealSlot,
} from './entry';

/**
 * One recorded meal as the instance list reads it. It carries eatenOn as well as
 * eatenAt, because which day a meal belongs to is the day its writer meant and
 * not whatever a timestamp's offset would make of it.
 */
export type MealInstance = {
  readonly id: string;
  readonly slot: MealSlot;
  readonly eatenOn: IsoDate;
  readonly eatenAt: Date;
  readonly glucoseBefore: number | null;
  readonly glucoseAfter: number | null;
  readonly insulinUnits: number | null;
  readonly foods: readonly FoodPortion[];
};

/** A food as identity sees it: name, amount and unit, and nothing else. */
const foodKey = (food: FoodPortion): string =>
  [
    food.name.trim().toLowerCase(),
    food.amount === null ? '' : String(food.amount),
    food.unit === null ? '' : food.unit,
  ].join('\u0001');

/**
 * The identity of a meal: its foods as a sorted multiset. Sorting is what makes
 * the order the foods were entered in irrelevant, and keeping duplicates is what
 * keeps two slices of bread different from one.
 */
export const mealIdentityKey = (foods: readonly FoodPortion[]): string =>
  foods.map(foodKey).sort().join('\u0002');

export const sameFoods = (
  left: readonly FoodPortion[],
  right: readonly FoodPortion[],
): boolean => mealIdentityKey(left) === mealIdentityKey(right);

/** Newest first: by the day the meal belongs to, then by its clock time. */
const newestFirst = (a: MealInstance, b: MealInstance): number =>
  a.eatenOn === b.eatenOn
    ? b.eatenAt.getTime() - a.eatenAt.getTime()
    : a.eatenOn < b.eatenOn
      ? 1
      : -1;

const localDate = (date: IsoDate): Date => {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  return new Date(year, month - 1, day);
};

/** 'Thu 10 Sep': short enough to sit beside the slot at 360 px. */
export const instanceDateText = (date: IsoDate): string =>
  localDate(date).toLocaleDateString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });

/**
 * One row of the instance list. The change is absent when the meal has no after
 * reading, exactly as a Today card is: a change that has not happened yet must
 * not be drawn as zero.
 */
export type InstanceRow = {
  readonly id: string;
  readonly date: string;
  readonly slot: string;
  readonly dose: string | null;
  readonly before: string | null;
  readonly after: string | null;
  readonly change: ChangeReading | null;
  /** True for the one instance being looked at, which is the only marked row. */
  readonly viewing: boolean;
};

const reading = (value: number | null): string | null =>
  value === null ? null : String(value);

const instanceRow = (instance: MealInstance, viewedId: string): InstanceRow => {
  const change =
    instance.glucoseBefore === null || instance.glucoseAfter === null
      ? null
      : instance.glucoseAfter - instance.glucoseBefore;
  return {
    id: instance.id,
    date: instanceDateText(instance.eatenOn),
    slot: slotLabel(instance.slot),
    dose: doseText(instance.insulinUnits),
    before: reading(instance.glucoseBefore),
    after: reading(instance.glucoseAfter),
    change: change === null ? null : { text: changeText(change), band: changeBand(change) },
    viewing: instance.id === viewedId,
  };
};

/**
 * Every instance of these foods, newest first, the viewed one included. Including
 * it is what makes marking it mean anything: the list is the whole history of
 * this meal, with the reader's place in it shown.
 */
export const instancesOf = (
  history: readonly MealInstance[],
  foods: readonly FoodPortion[],
  viewedId: string,
): readonly InstanceRow[] =>
  history
    .filter((instance) => sameFoods(instance.foods, foods))
    .slice()
    .sort(newestFirst)
    .map((instance) => instanceRow(instance, viewedId));

/** 'Every time you ate this · 4'. The heading counts what is below it. */
export const instancesHeading = (count: number): string => `Every time you ate this · ${count}`;

/**
 * The name of the way into a meal's detail, from the card on Today. It names the
 * meal in words rather than by position, exactly as the Edit control does, so a
 * person using a screen reader hears which meal is being opened.
 */
export const openMealLabel = (slot: MealSlot): string => `View ${slot}`;

/** The mark the viewed row carries. Words, not only a border, so colour is never the message. */
export const VIEWING_MARK = 'viewing';

/** 'Fri 26 Sep · 19:05': when the meal in hand was eaten. */
export const eatenAtText = (eatenAt: Date): string =>
  `${eatenAt.toLocaleDateString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  })} · ${clockTime(eatenAt)}`;
