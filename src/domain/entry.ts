// The entries a day log is made of, and the pure functions that turn one into
// its day-log line. No DOM and no SDK here, so the reading rule this value is
// judged on is testable on its own.

import { changeBand, type ChangeBand } from './band';

/** A calendar date in the reader's own timezone, as 'YYYY-MM-DD'. */
export type IsoDate = string;

export type MealSlot = 'breakfast' | 'lunch' | 'dinner' | 'snack';

/** Every slot a meal may be recorded against, in the order a chooser offers them. */
export const MEAL_SLOTS: readonly MealSlot[] = ['breakfast', 'lunch', 'dinner', 'snack'];

/**
 * The brief's seven food types. The stored value is what the check constraint on
 * meal_foods.food_type allows, so this list and the migration say the same thing.
 */
export type FoodType =
  | 'carb-heavy'
  | 'protein'
  | 'vegetable'
  | 'fruit'
  | 'dairy'
  | 'mixed dish'
  | 'drink';

export const FOOD_TYPES: readonly FoodType[] = [
  'carb-heavy',
  'protein',
  'vegetable',
  'fruit',
  'dairy',
  'mixed dish',
  'drink',
];

const FOOD_TYPE_LABELS: Readonly<Record<FoodType, string>> = {
  'carb-heavy': 'Carb-heavy',
  protein: 'Protein',
  vegetable: 'Vegetable',
  fruit: 'Fruit',
  dairy: 'Dairy',
  'mixed dish': 'Mixed dish',
  drink: 'Drink',
};

export const foodTypeLabel = (type: FoodType): string => FOOD_TYPE_LABELS[type];

/** The brief's five amount units. Shown exactly as they are stored. */
export type AmountUnit = 'g' | 'ml' | 'pc' | 'cup' | 'tbsp';

export const AMOUNT_UNITS: readonly AmountUnit[] = ['g', 'ml', 'pc', 'cup', 'tbsp'];

/** Whether the person moved around the meal, and on which side of it. */
export type ExerciseContext = 'none' | 'before' | 'after';

export const EXERCISE_CONTEXTS: readonly ExerciseContext[] = ['none', 'before', 'after'];

const EXERCISE_LABELS: Readonly<Record<ExerciseContext, string>> = {
  none: 'None',
  before: 'Before meal',
  after: 'After meal',
};

export const exerciseContextLabel = (context: ExerciseContext): string => EXERCISE_LABELS[context];

export type FoodPortion = {
  readonly name: string;
  /** Reading never needed the type; recording does, so the portion carries it. */
  readonly foodType: FoodType | null;
  readonly amount: number | null;
  readonly unit: string | null;
};

export type Meal = {
  readonly id: string;
  readonly slot: MealSlot;
  readonly eatenAt: Date;
  readonly glucoseBefore: number | null;
  readonly glucoseAfter: number | null;
  readonly insulinUnits: number | null;
  readonly exerciseContext: ExerciseContext;
  readonly note: string | null;
  readonly foods: readonly FoodPortion[];
};

export type NightInsulin = {
  readonly id: string;
  readonly nightOn: IsoDate;
  readonly units: number;
  readonly takenAt: Date | null;
  readonly bedtimeGlucose: number | null;
};

export type DayLog = {
  readonly date: IsoDate;
  readonly meals: readonly Meal[];
  readonly nightInsulin: readonly NightInsulin[];
};

const SLOT_LABELS: Readonly<Record<MealSlot, string>> = {
  breakfast: 'Breakfast',
  lunch: 'Lunch',
  dinner: 'Dinner',
  snack: 'Snack',
};

export const slotLabel = (slot: MealSlot): string => SLOT_LABELS[slot];

/**
 * The accessible names of the two controls a card carries: 'Log dinner' on an
 * empty slot and 'Edit dinner' on a logged meal. They name the slot in words
 * rather than by position, so a person using a screen reader hears which meal a
 * control belongs to, and the Edit name is fixed for the rest of the delivery.
 */
export const logSlotLabel = (slot: MealSlot): string => `Log ${slot}`;

export const editMealLabel = (slot: MealSlot): string => `Edit ${slot}`;

/** The reader's local clock time as 'HH:MM'. */
export const clockTime = (at: Date): string =>
  `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`;

/** Whole numbers read as whole numbers: 60 is '60', never '60.00'. */
const amountText = (value: number): string =>
  Number.isInteger(value) ? String(value) : String(Number(value.toFixed(2)));

export const foodText = (food: FoodPortion): string => {
  if (food.amount === null) return food.name;
  const measure = food.unit === null ? amountText(food.amount) : `${amountText(food.amount)} ${food.unit}`;
  return `${food.name} ${measure}`;
};

/** '5 u', or nothing at all when no dose was recorded. The app never suggests one. */
export const doseText = (units: number | null): string | null =>
  units === null ? null : `${amountText(units)} u`;

/** The foods as the card reads them: 'Oats 60 g · Milk 200 ml'. */
export const foodsText = (foods: readonly FoodPortion[]): string | null =>
  foods.length === 0 ? null : foods.map(foodText).join(' · ');

/** '18 u at 22:30', or '18 u' when no time was recorded. */
export const nightInsulinLine = (night: NightInsulin): string => {
  const dose = `${amountText(night.units)} u`;
  return night.takenAt === null ? dose : `${dose} at ${clockTime(night.takenAt)}`;
};

const byTime = (a: Meal, b: Meal): number => a.eatenAt.getTime() - b.eatenAt.getTime();

/** The placeholder an empty fixed slot and an unrecorded night dose both read. */
export const NOT_LOGGED_YET = 'Not logged yet';

export const NIGHT_INSULIN_LABEL = 'Night insulin';

/**
 * The three slots the screen always shows, in the order it shows them. A snack
 * is deliberately absent: a logged snack gets its own card after dinner, but an
 * unlogged snack is not a hole in the day the way a missed dinner is.
 */
export const FIXED_SLOTS: readonly MealSlot[] = ['breakfast', 'lunch', 'dinner'];

/**
 * After minus before, or nothing at all when either reading is missing. A change
 * that has not happened yet must not be drawn as zero.
 */
export const glucoseChange = (meal: Meal): number | null =>
  meal.glucoseBefore === null || meal.glucoseAfter === null
    ? null
    : meal.glucoseAfter - meal.glucoseBefore;

/**
 * '+82', '−18' with the true minus sign U+2212, and '0' for no change. The sign
 * is always explicit, because the whole point of the number is its direction.
 */
export const changeText = (change: number): string => {
  if (change === 0) return '0';
  return change > 0 ? `+${amountText(change)}` : `−${amountText(Math.abs(change))}`;
};

export type ChangeReading = {
  readonly text: string;
  readonly band: ChangeBand;
};

/**
 * One logged meal as the card reads it. Every string here except `label` exists
 * only because the account recorded it, which is exactly the split the reading
 * surface marks with data-entry; `change` is derived from the readings rather
 * than recorded, so it is published with its band and without that mark.
 */
export type MealCard = {
  readonly kind: 'meal';
  readonly id: string;
  /** The slot itself, beside its label, so a control can name the meal it edits. */
  readonly slot: MealSlot;
  readonly label: string;
  readonly time: string;
  readonly foods: string | null;
  readonly dose: string | null;
  readonly before: string | null;
  readonly after: string | null;
  readonly change: ChangeReading | null;
};

/** A fixed slot with nothing logged in it: the label and the placeholder. */
export type EmptySlotCard = {
  readonly kind: 'empty-slot';
  /** The slot this card is the way to log, so the card can open New meal on it. */
  readonly slot: MealSlot;
  readonly label: string;
};

/**
 * The night dose, always exactly one card so the screen never reads as two
 * separate nights. With nothing recorded `doses` is empty and the card shows the
 * placeholder instead.
 */
export type NightCard = {
  readonly kind: 'night';
  readonly label: string;
  readonly doses: readonly string[];
};

export type DayCard = MealCard | EmptySlotCard | NightCard;

const mealCard = (meal: Meal): MealCard => {
  const change = glucoseChange(meal);
  return {
    kind: 'meal',
    id: meal.id,
    slot: meal.slot,
    label: slotLabel(meal.slot),
    time: clockTime(meal.eatenAt),
    foods: foodsText(meal.foods),
    dose: doseText(meal.insulinUnits),
    before: meal.glucoseBefore === null ? null : amountText(meal.glucoseBefore),
    after: meal.glucoseAfter === null ? null : amountText(meal.glucoseAfter),
    change: change === null ? null : { text: changeText(change), band: changeBand(change) },
  };
};

/**
 * The whole screen as cards: the three fixed slots in order, each either its
 * logged meals or the placeholder, then any snacks in clock order, then the one
 * night insulin card.
 */
export const dayCards = (log: DayLog): readonly DayCard[] => {
  const inSlot = (slot: MealSlot): readonly Meal[] =>
    log.meals.filter((meal) => meal.slot === slot).sort(byTime);

  const fixed = FIXED_SLOTS.flatMap((slot): readonly DayCard[] => {
    const meals = inSlot(slot);
    return meals.length === 0
      ? [{ kind: 'empty-slot', slot, label: slotLabel(slot) }]
      : meals.map(mealCard);
  });

  const night: NightCard = {
    kind: 'night',
    label: NIGHT_INSULIN_LABEL,
    doses: log.nightInsulin.map(nightInsulinLine),
  };

  return [...fixed, ...inSlot('snack').map(mealCard), night];
};

export const emptyDayLog = (date: IsoDate): DayLog => ({ date, meals: [], nightInsulin: [] });

/** Today as the reader's own calendar date, not UTC's. */
export const localToday = (now: Date = new Date()): IsoDate =>
  `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(
    now.getDate(),
  ).padStart(2, '0')}`;

/**
 * The date `days` away, through the local calendar rather than through
 * arithmetic on the string, so a month end and a daylight-saving change both
 * land where the reader expects.
 */
export const shiftDate = (date: IsoDate, days: number): IsoDate => {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  return localToday(new Date(year, month - 1, day + days));
};
