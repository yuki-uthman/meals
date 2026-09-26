// The meal a person is filling in, and the pure rules that say when it may be
// recorded. No DOM and no SDK here, so every refusal this value declares is
// testable without a browser: a draft goes in, a message or a recording comes out.
//
// A draft holds what the person typed, as text, rather than numbers it has
// already interpreted. That is deliberate: a half-typed amount is a real state a
// form is in, and turning text into numbers exactly once -- at the moment of
// recording -- keeps the field showing what was entered.

import {
  clockTime,
  slotLabel,
  type AmountUnit,
  type ExerciseContext,
  type FoodPortion,
  type FoodType,
  type IsoDate,
  type Meal,
  type MealSlot,
} from './entry';

export type FoodDraft = {
  readonly name: string;
  /** Null until the person chooses. A food must have a type to be recorded. */
  readonly foodType: FoodType | null;
  readonly amount: string;
  readonly unit: AmountUnit;
};

/**
 * The meal a repeat took its foods from, kept so the form can name it. It is the
 * source's identity for the reader and nothing more: no value of the source is
 * ever written back, and a repeat is a new row with no id of its own yet.
 */
export type RepeatSource = {
  readonly slot: MealSlot;
  readonly eatenAt: Date;
};

export type MealDraft = {
  /** The row being updated, or null when this draft is a new meal. */
  readonly mealId: string | null;
  /**
   * The meal whose foods were copied into this draft, or null when the person
   * started from an empty form. A draft with a source is still a NEW meal.
   * Absent reads the same as null: most drafts are nobody's repeat.
   */
  readonly copiedFrom?: RepeatSource | null;
  /**
   * The date the meal is recorded against: the one the Today screen is reading,
   * never the server's, so a meal logged late at night lands on the day the
   * person is looking at.
   */
  readonly date: IsoDate;
  readonly slot: MealSlot;
  /** Local clock time as 'HH:MM'. */
  readonly time: string;
  readonly glucoseBefore: string;
  readonly glucoseAfter: string;
  readonly insulinUnits: string;
  readonly exerciseContext: ExerciseContext;
  readonly note: string;
  readonly foods: readonly FoodDraft[];
};

/**
 * A meal needs a slot, a time and at least one food. Everything else is optional,
 * because a person who forgot to measure must still be able to record what they
 * ate, and the app never invents a dose on their behalf.
 */
export const NO_FOOD_REFUSAL = 'Add at least one food.';
export const NO_TIME_REFUSAL = 'Enter a time.';
export const NO_FOOD_NAME_REFUSAL = 'Name the food.';
export const NO_FOOD_TYPE_REFUSAL = 'Choose a food type.';

/** The unit a new food opens on: grams, the commonest of the brief's five. */
const DEFAULT_UNIT: AmountUnit = 'g';

export const emptyFoodDraft: FoodDraft = {
  name: '',
  foodType: null,
  amount: '',
  unit: DEFAULT_UNIT,
};

/** The time field opens on the current local clock time; the person may change it. */
export const newMealDraft = (date: IsoDate, slot: MealSlot, now: Date = new Date()): MealDraft => ({
  mealId: null,
  copiedFrom: null,
  date,
  slot,
  time: clockTime(now),
  glucoseBefore: '',
  glucoseAfter: '',
  insulinUnits: '',
  exerciseContext: 'none',
  note: '',
  foods: [],
});

/** A recorded number back in a field: 6 reads as '6', never as '6.00'. */
const fieldText = (value: number | null): string =>
  value === null ? '' : String(Number(value.toFixed(2)));

const isAmountUnit = (unit: string | null): unit is AmountUnit =>
  unit === 'g' || unit === 'ml' || unit === 'pc' || unit === 'cup' || unit === 'tbsp';

export const foodDraftFrom = (food: FoodPortion): FoodDraft => ({
  name: food.name,
  foodType: food.foodType,
  amount: fieldText(food.amount),
  unit: isAmountUnit(food.unit) ? food.unit : DEFAULT_UNIT,
});

/**
 * An existing meal as a draft, so reopening it shows what was recorded rather
 * than an empty form. It keeps the meal's id, which is what makes saving update
 * that row instead of writing a second meal on the date.
 */
export const mealDraftFrom = (meal: Meal, date: IsoDate): MealDraft => ({
  mealId: meal.id,
  copiedFrom: null,
  date,
  slot: meal.slot,
  time: clockTime(meal.eatenAt),
  glucoseBefore: fieldText(meal.glucoseBefore),
  glucoseAfter: fieldText(meal.glucoseAfter),
  insulinUnits: fieldText(meal.insulinUnits),
  exerciseContext: meal.exerciseContext,
  note: meal.note ?? '',
  foods: meal.foods.map(foodDraftFrom),
});

/**
 * A meal's foods again, as a NEW draft. Only the foods travel -- each name, its
 * type and its amount with its unit -- because the whole premise of the product
 * is comparing two instances of the same composition, and a copy of the readings
 * or the dose would make the second instance an echo of the first rather than a
 * fresh observation. The dose above all starts empty: a dose offered as a
 * starting value is a dose recommended however it is labelled.
 *
 * The slot comes across, because repeating a dinner almost always means another
 * dinner and the person can still change it. The date is the one passed in --
 * today, since repeating a meal is something done when eating it again -- and
 * the time is the current clock.
 */
export const repeatMealDraft = (meal: Meal, date: IsoDate, now: Date = new Date()): MealDraft => ({
  ...newMealDraft(date, meal.slot, now),
  copiedFrom: { slot: meal.slot, eatenAt: meal.eatenAt },
  foods: meal.foods.map(foodDraftFrom),
});

/** 'same foods as Thu 10 Sep · Dinner': what a repeat is a repeat of. */
export const repeatSourceText = (source: RepeatSource): string =>
  `same foods as ${source.eatenAt.toLocaleDateString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  })} · ${slotLabel(source.slot)}`;

export const withFood = (draft: MealDraft, food: FoodDraft): MealDraft => ({
  ...draft,
  foods: [...draft.foods, food],
});

export const withoutFood = (draft: MealDraft, index: number): MealDraft => ({
  ...draft,
  foods: draft.foods.filter((_, at) => at !== index),
});

/** Why this food cannot be added yet, or null when it can. */
export const foodDraftRefusal = (food: FoodDraft): string | null => {
  if (food.name.trim() === '') return NO_FOOD_NAME_REFUSAL;
  if (food.foodType === null) return NO_FOOD_TYPE_REFUSAL;
  return null;
};

// ------------------------------------------------------------- recording

export type FoodRecording = {
  readonly name: string;
  readonly foodType: FoodType;
  readonly amount: number | null;
  readonly unit: AmountUnit | null;
};

/**
 * A draft that has passed its rules, as the store is asked to write it. `id` is
 * null for a new meal and the existing row for an edit, so one write path covers
 * recording and adding the after reading later.
 */
export type MealRecording = {
  readonly id: string | null;
  readonly slot: MealSlot;
  readonly eatenOn: IsoDate;
  readonly eatenAt: Date;
  readonly glucoseBefore: number | null;
  readonly glucoseAfter: number | null;
  readonly insulinUnits: number | null;
  readonly exerciseContext: ExerciseContext;
  readonly note: string | null;
  readonly foods: readonly FoodRecording[];
};

const numberField = (text: string): number | null => {
  const trimmed = text.trim();
  if (trimmed === '') return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
};

/** Glucose is whole numbers in mg/dL, so a typed decimal is read as one. */
const glucoseField = (text: string): number | null => {
  const parsed = numberField(text);
  return parsed === null ? null : Math.round(parsed);
};

const textField = (text: string): string | null => {
  const trimmed = text.trim();
  return trimmed === '' ? null : trimmed;
};

/**
 * The foods of the draft that are complete enough to record. A food with no type
 * is not a food this product can compare, so it is not counted -- which is also
 * why an incomplete food cannot satisfy the 'at least one food' rule.
 */
const recordedFoods = (foods: readonly FoodDraft[]): readonly FoodRecording[] =>
  foods.flatMap((food): readonly FoodRecording[] => {
    const name = food.name.trim();
    if (name === '' || food.foodType === null) return [];
    const amount = numberField(food.amount);
    return [{ name, foodType: food.foodType, amount, unit: amount === null ? null : food.unit }];
  });

const atLocalTime = (date: IsoDate, time: string): Date => {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  const [hours, minutes] = time.split(':').map(Number) as [number, number];
  return new Date(year, month - 1, day, hours, minutes, 0, 0);
};

const TIME_PATTERN = /^\d{1,2}:\d{2}$/;

/** Why this meal cannot be saved yet, or null when it can. */
export const mealDraftRefusal = (draft: MealDraft): string | null => {
  if (!TIME_PATTERN.test(draft.time.trim())) return NO_TIME_REFUSAL;
  if (recordedFoods(draft.foods).length === 0) return NO_FOOD_REFUSAL;
  return null;
};

/**
 * The draft as a recording, or null when its rules refuse it. Returning null
 * rather than throwing keeps the refusal a value the screen can show, and makes
 * it impossible to build a recording that the rules would have rejected.
 */
export const mealRecording = (draft: MealDraft): MealRecording | null => {
  if (mealDraftRefusal(draft) !== null) return null;
  return {
    id: draft.mealId,
    slot: draft.slot,
    eatenOn: draft.date,
    eatenAt: atLocalTime(draft.date, draft.time.trim()),
    glucoseBefore: glucoseField(draft.glucoseBefore),
    glucoseAfter: glucoseField(draft.glucoseAfter),
    insulinUnits: numberField(draft.insulinUnits),
    exerciseContext: draft.exerciseContext,
    note: textField(draft.note),
    foods: recordedFoods(draft.foods),
  };
};
