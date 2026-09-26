// The entries a day log is made of, and the pure functions that turn one into
// its day-log line. No DOM and no SDK here, so the reading rule this value is
// judged on is testable on its own.

/** A calendar date in the reader's own timezone, as 'YYYY-MM-DD'. */
export type IsoDate = string;

export type MealSlot = 'breakfast' | 'lunch' | 'dinner' | 'snack';

export type FoodPortion = {
  readonly name: string;
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

/**
 * 'Breakfast · 07:40 · Oats 60 g, Milk 200 ml'. A meal with no recorded foods
 * keeps its slot and time and drops the trailing segment rather than showing an
 * empty one.
 */
export const mealLine = (meal: Meal): string => {
  const head = `${slotLabel(meal.slot)} · ${clockTime(meal.eatenAt)}`;
  if (meal.foods.length === 0) return head;
  return `${head} · ${meal.foods.map(foodText).join(', ')}`;
};

/** '18 u at 22:30', or '18 u' when no time was recorded. */
export const nightInsulinLine = (night: NightInsulin): string => {
  const dose = `${amountText(night.units)} u`;
  return night.takenAt === null ? dose : `${dose} at ${clockTime(night.takenAt)}`;
};

const byTime = (a: Meal, b: Meal): number => a.eatenAt.getTime() - b.eatenAt.getTime();

/** Every line the day log shows, meals in clock order then the night dose. */
export const dayLogLines = (log: DayLog): readonly string[] => [
  ...[...log.meals].sort(byTime).map(mealLine),
  ...log.nightInsulin.map(nightInsulinLine),
];

export const isEmpty = (log: DayLog): boolean => dayLogLines(log).length === 0;

export const emptyDayLog = (date: IsoDate): DayLog => ({ date, meals: [], nightInsulin: [] });

/** Today as the reader's own calendar date, not UTC's. */
export const localToday = (now: Date = new Date()): IsoDate =>
  `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(
    now.getDate(),
  ).padStart(2, '0')}`;
