import { clockTime, slotLabel, type IsoDate, type MealSlot } from './entry';

// The readings the number pad offers as chips, derived from what the account
// already recorded. No DOM and no SDK here: which reading is 'the last one' is a
// rule, so it is stated once, in the open, and not buried in a query.
//
// A chip repeats a reading the person already took. It is not advice and it is
// not a default: nothing here computes a dose or suggests a target.

/** One recent meal, as much of it as a chip needs and no more. */
export type RecentMeal = {
  readonly id: string;
  readonly slot: MealSlot;
  readonly eatenOn: IsoDate;
  readonly eatenAt: Date;
  readonly glucoseBefore: number | null;
  readonly glucoseAfter: number | null;
};

/**
 * How far back the chips look. A reading older than this is not a useful thing
 * to re-offer, and the window keeps the read bounded whatever the history holds.
 */
export const RECENT_MEALS_WINDOW = 40;

/** A chip: the words on it and the whole-number reading it puts in the field. */
export type ReadingChip = {
  readonly label: string;
  readonly value: number;
};

/** Newest first. Both readings of a meal hang off that one time. */
const byTimeDescending = (a: RecentMeal, b: RecentMeal): number =>
  b.eatenAt.getTime() - a.eatenAt.getTime();

const usable = (meals: readonly RecentMeal[], exclude: string | null): readonly RecentMeal[] =>
  // The meal being edited is not its own history: reopening a dinner must not
  // offer that same dinner's reading back as 'the last one'.
  [...meals].filter((meal) => meal.id !== exclude).sort(byTimeDescending);

/**
 * The most recent glucose value the account recorded, with the time of the entry
 * it came from. Within one meal the after reading counts as the later of the
 * two, because both hang off the meal's own time and the after one is taken
 * afterwards; so a lunch of 112 before and 133 after offers 133, never 112.
 */
export const lastReadingChip = (
  meals: readonly RecentMeal[],
  exclude: string | null = null,
): ReadingChip | null => {
  for (const meal of usable(meals, exclude)) {
    const value = meal.glucoseAfter ?? meal.glucoseBefore;
    if (value === null) continue;
    return { label: `Last reading ${value} · ${clockTime(meal.eatenAt)}`, value };
  }
  return null;
};

/**
 * The before reading of the most recent meal in the slot being recorded: what
 * this person tends to sit at going into dinner, in their own numbers. The
 * before reading, deliberately, because that is the reading being keyed.
 */
export const slotReadingChip = (
  meals: readonly RecentMeal[],
  slot: MealSlot | null,
  exclude: string | null = null,
): ReadingChip | null => {
  if (slot === null) return null;
  for (const meal of usable(meals, exclude)) {
    if (meal.slot !== slot) continue;
    if (meal.glucoseBefore === null) continue;
    return {
      label: `Before last ${slotLabel(slot).toLowerCase()} ${meal.glucoseBefore}`,
      value: meal.glucoseBefore,
    };
  }
  return null;
};

/**
 * The chips a pad carries, in the order it offers them. A chip with no reading
 * behind it is absent rather than empty: an empty chip would read as a reading
 * of nothing, and there is no honest number to put on it.
 */
export const readingChips = (
  meals: readonly RecentMeal[],
  slot: MealSlot | null,
  exclude: string | null = null,
): readonly ReadingChip[] => {
  const chips = [lastReadingChip(meals, exclude), slotReadingChip(meals, slot, exclude)];
  const present = chips.filter((chip): chip is ReadingChip => chip !== null);
  // The same reading reached by two routes is one chip, not two identical ones.
  return present.filter(
    (chip, index) => present.findIndex((other) => other.label === chip.label) === index,
  );
};
