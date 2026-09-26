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

/** '5 u', or nothing at all when no dose was recorded. The app never suggests one. */
export const doseText = (units: number | null): string | null =>
  units === null ? null : `${amountText(units)} u`;

/**
 * '104 → 186 mg/dL' when both readings exist, '104 mg/dL before' or
 * '186 mg/dL after' when only one does, and nothing when neither does. Whole
 * mg/dL numbers, as stored.
 */
export const glucoseText = (meal: Meal): string | null => {
  const before = meal.glucoseBefore;
  const after = meal.glucoseAfter;
  if (before !== null && after !== null) return `${amountText(before)} → ${amountText(after)} mg/dL`;
  if (before !== null) return `${amountText(before)} mg/dL before`;
  if (after !== null) return `${amountText(after)} mg/dL after`;
  return null;
};

/**
 * Everything on a meal's line that the account itself recorded: the clock time,
 * the foods with their amounts, the dose and the glucose readings. The slot
 * label is deliberately absent, because it is the same for every account and so
 * belongs to the screen rather than to anybody's data.
 *
 * '07:40 · Oats 60 g, Milk 200 ml · 5 u · 104 → 186 mg/dL'. A segment with
 * nothing recorded in it is dropped rather than shown empty.
 */
export const mealRecordedText = (meal: Meal): string => {
  const foods = meal.foods.length === 0 ? null : meal.foods.map(foodText).join(', ');
  const segments = [clockTime(meal.eatenAt), foods, doseText(meal.insulinUnits), glucoseText(meal)];
  return segments.filter((segment): segment is string => segment !== null).join(' · ');
};

/**
 * 'Breakfast · 07:40 · Oats 60 g, Milk 200 ml · 5 u · 104 → 186 mg/dL'. The
 * whole line as one string, slot label included, for readers that want the text
 * without the furniture boundary.
 */
export const mealLine = (meal: Meal): string =>
  `${slotLabel(meal.slot)} · ${mealRecordedText(meal)}`;

/** '18 u at 22:30', or '18 u' when no time was recorded. */
export const nightInsulinLine = (night: NightInsulin): string => {
  const dose = `${amountText(night.units)} u`;
  return night.takenAt === null ? dose : `${dose} at ${clockTime(night.takenAt)}`;
};

const byTime = (a: Meal, b: Meal): number => a.eatenAt.getTime() - b.eatenAt.getTime();

/**
 * One line of the day log, split where ownership is: `furniture` is the part
 * that reads the same for every account, `recorded` is the part that exists only
 * because this account wrote it down. The reading surface marks the second as
 * entry data and the first as nothing of the kind.
 */
export type DayLogEntry = {
  readonly furniture: string | null;
  readonly recorded: string;
};

/** Every line the day log shows, meals in clock order then the night dose. */
export const dayLogEntries = (log: DayLog): readonly DayLogEntry[] => [
  ...[...log.meals]
    .sort(byTime)
    .map((meal): DayLogEntry => ({ furniture: slotLabel(meal.slot), recorded: mealRecordedText(meal) })),
  ...log.nightInsulin.map(
    (night): DayLogEntry => ({ furniture: null, recorded: nightInsulinLine(night) }),
  ),
];

/** The same lines as plain text, furniture joined back on. */
export const dayLogLines = (log: DayLog): readonly string[] =>
  dayLogEntries(log).map((entry) =>
    entry.furniture === null ? entry.recorded : `${entry.furniture} · ${entry.recorded}`,
  );

export const isEmpty = (log: DayLog): boolean => dayLogEntries(log).length === 0;

export const emptyDayLog = (date: IsoDate): DayLog => ({ date, meals: [], nightInsulin: [] });

/** Today as the reader's own calendar date, not UTC's. */
export const localToday = (now: Date = new Date()): IsoDate =>
  `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(
    now.getDate(),
  ).padStart(2, '0')}`;
