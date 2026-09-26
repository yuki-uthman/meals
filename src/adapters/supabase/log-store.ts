import type { PostgrestError, SupabaseClient } from '@supabase/supabase-js';
import { SESSION_ENDED, UNREACHABLE_SERVER } from '../../ports/identity';
import { MEAL_NOT_SAVED, type DayLogOutcome, type LogStore, type SaveMealOutcome } from '../../ports/log-store';
import type {
  DayLog,
  ExerciseContext,
  FoodPortion,
  FoodType,
  IsoDate,
  Meal,
  MealSlot,
  NightInsulin,
} from '../../domain/entry';
import type { FoodRecording, MealRecording } from '../../domain/meal-draft';

// PostgREST behind the log-store port.
//
// Note what is absent: there is no .eq('user_id', ...) anywhere below. The
// requests ask for a date range and nothing else, so row-level security is the
// only thing that decides which rows come back. A row belonging to another
// account is not filtered out here; it is never sent.

const MEAL_SELECT = `
  id, slot, eaten_on, eaten_at, glucose_before, glucose_after, insulin_units,
  exercise_context, note,
  meal_foods ( id, name, food_type, amount, unit, position )
`;

const NIGHT_SELECT = 'id, night_on, units, taken_at, bedtime_glucose';

const asNumber = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isNaN(parsed) ? null : parsed;
};

const asText = (value: unknown): string | null =>
  typeof value === 'string' && value !== '' ? value : null;

type FoodRow = {
  name?: unknown;
  food_type?: unknown;
  amount?: unknown;
  unit?: unknown;
  position?: unknown;
};

const toFood = (row: FoodRow): FoodPortion => ({
  name: typeof row.name === 'string' ? row.name : '',
  // The column is constrained to the seven types, so whatever came back is one
  // of them; anything else can only be a row written before that constraint.
  foodType: asText(row.food_type) as FoodType | null,
  amount: asNumber(row.amount),
  unit: asText(row.unit),
});

const byPosition = (a: FoodRow, b: FoodRow): number =>
  (asNumber(a.position) ?? 0) - (asNumber(b.position) ?? 0);

type MealRow = {
  id?: unknown;
  slot?: unknown;
  eaten_at?: unknown;
  glucose_before?: unknown;
  glucose_after?: unknown;
  insulin_units?: unknown;
  exercise_context?: unknown;
  note?: unknown;
  meal_foods?: unknown;
};

/** An unrecorded context reads as 'None', which is also what the form defaults to. */
const toExerciseContext = (value: unknown): ExerciseContext =>
  value === 'before' || value === 'after' ? value : 'none';

const toMeal = (row: MealRow): Meal => {
  const foods = Array.isArray(row.meal_foods) ? (row.meal_foods as FoodRow[]) : [];
  return {
    id: String(row.id),
    slot: String(row.slot) as MealSlot,
    eatenAt: new Date(String(row.eaten_at)),
    glucoseBefore: asNumber(row.glucose_before),
    glucoseAfter: asNumber(row.glucose_after),
    insulinUnits: asNumber(row.insulin_units),
    exerciseContext: toExerciseContext(row.exercise_context),
    note: asText(row.note),
    foods: [...foods].sort(byPosition).map(toFood),
  };
};

type NightRow = {
  id?: unknown;
  night_on?: unknown;
  units?: unknown;
  taken_at?: unknown;
  bedtime_glucose?: unknown;
};

const toNightInsulin = (row: NightRow): NightInsulin => ({
  id: String(row.id),
  nightOn: String(row.night_on),
  units: asNumber(row.units) ?? 0,
  takenAt: row.taken_at === null || row.taken_at === undefined ? null : new Date(String(row.taken_at)),
  bedtimeGlucose: asNumber(row.bedtime_glucose),
});

/**
 * An expired or missing token is a refusal that sends the person back to
 * sign-in; anything else that came back wrong is worth retrying. Read and write
 * agree on this reading, so a dead session never reads as a transport problem.
 */
const isSessionGone = (error: PostgrestError, status: number): boolean =>
  status === 401 || error.code === 'PGRST301';

/**
 * An empty result is not a failure at all: owning no rows for the date is the
 * ordinary empty day log.
 */
const toFailure = (error: PostgrestError, status: number): DayLogOutcome =>
  isSessionGone(error, status)
    ? { kind: 'session-ended', message: SESSION_ENDED }
    : { kind: 'retry', message: UNREACHABLE_SERVER };

/** The same reading of a failure, for the write path. */
const toSaveFailure = (error: PostgrestError, status: number): SaveMealOutcome =>
  isSessionGone(error, status)
    ? { kind: 'session-ended', message: SESSION_ENDED }
    : { kind: 'retry', message: UNREACHABLE_SERVER };

/**
 * The meal row's own columns. No user_id: the column defaults to auth.uid() and
 * the insert policy checks it, so the owner of a written row is decided by
 * Postgres and cannot be asked for by the browser.
 */
const mealFields = (recording: MealRecording): Record<string, unknown> => ({
  slot: recording.slot,
  // eaten_on is the date the person was looking at; eaten_at carries the clock
  // time. The day log selects on eaten_on, so a late meal stays on its own day.
  eaten_on: recording.eatenOn,
  eaten_at: recording.eatenAt.toISOString(),
  glucose_before: recording.glucoseBefore,
  glucose_after: recording.glucoseAfter,
  insulin_units: recording.insulinUnits,
  exercise_context: recording.exerciseContext,
  note: recording.note,
});

const foodRows = (
  mealId: string,
  foods: readonly FoodRecording[],
): Record<string, unknown>[] =>
  foods.map((food, index) => ({
    meal_id: mealId,
    name: food.name,
    food_type: food.foodType,
    amount: food.amount,
    unit: food.unit,
    // Position is what the reading path sorts by, so the foods come back in the
    // order they were entered rather than in whatever order Postgres returns.
    position: index + 1,
  }));

const rowIds = (rows: unknown): string[] =>
  (Array.isArray(rows) ? (rows as { id?: unknown }[]) : []).map((row) => String(row.id));

/**
 * A new meal and its foods, written together. PostgREST has no transaction
 * across two requests, so the meal row is created first and removed again if its
 * foods do not land: a meal with no foods is not a thing this product can
 * compare, and a half-written one would quietly corrupt every later lookup.
 */
const recordNewMeal = async (
  client: SupabaseClient,
  recording: MealRecording,
): Promise<SaveMealOutcome> => {
  const created = await client.from('meals').insert(mealFields(recording)).select('id').single();
  if (created.error !== null) return toSaveFailure(created.error, created.status);

  const id = String((created.data as { id?: unknown }).id);

  const foods = await client.from('meal_foods').insert(foodRows(id, recording.foods));
  if (foods.error !== null) {
    await client.from('meals').delete().eq('id', id);
    return { kind: 'refused', message: MEAL_NOT_SAVED };
  }

  return { kind: 'saved', id };
};

/**
 * An existing meal, updated in place. The foods are replaced by writing the new
 * rows before removing the old ones, so a failed insert leaves the recorded
 * foods standing rather than emptying the meal.
 */
const updateMeal = async (
  client: SupabaseClient,
  id: string,
  recording: MealRecording,
): Promise<SaveMealOutcome> => {
  // No user_id filter here either: the update policy is what limits this to the
  // caller's own row, so a guessed id touches nothing.
  const updated = await client.from('meals').update(mealFields(recording)).eq('id', id).select('id');
  if (updated.error !== null) return toSaveFailure(updated.error, updated.status);

  const existing = await client.from('meal_foods').select('id').eq('meal_id', id);
  if (existing.error !== null) return toSaveFailure(existing.error, existing.status);

  const inserted = await client.from('meal_foods').insert(foodRows(id, recording.foods));
  if (inserted.error !== null) return { kind: 'refused', message: MEAL_NOT_SAVED };

  const previous = rowIds(existing.data);
  if (previous.length > 0) {
    const removed = await client.from('meal_foods').delete().in('id', previous);
    if (removed.error !== null) return toSaveFailure(removed.error, removed.status);
  }

  return { kind: 'saved', id };
};

export const supabaseLogStore = (client: SupabaseClient): LogStore => ({
  saveMeal: async (recording: MealRecording): Promise<SaveMealOutcome> => {
    try {
      return recording.id === null
        ? await recordNewMeal(client, recording)
        : await updateMeal(client, recording.id, recording);
    } catch {
      // The request never got an answer at all, so whether Postgres committed is
      // unknown. It is reported as worth retrying and never retried here.
      return { kind: 'retry', message: UNREACHABLE_SERVER };
    }
  },

  dayLog: async (date: IsoDate): Promise<DayLogOutcome> => {
    try {
      // Both reads select on the date column, never on the timestamp, so the
      // day a row belongs to is the one its writer meant and not whatever the
      // server's UTC offset would make of its clock time.
      const [mealsResult, nightResult] = await Promise.all([
        client
          .from('meals')
          .select(MEAL_SELECT)
          .eq('eaten_on', date)
          .order('eaten_at', { ascending: true }),
        client.from('night_insulin').select(NIGHT_SELECT).eq('night_on', date),
      ]);

      if (mealsResult.error !== null) return toFailure(mealsResult.error, mealsResult.status);
      if (nightResult.error !== null) return toFailure(nightResult.error, nightResult.status);

      const log: DayLog = {
        date,
        meals: ((mealsResult.data ?? []) as MealRow[]).map(toMeal),
        nightInsulin: ((nightResult.data ?? []) as NightRow[]).map(toNightInsulin),
      };
      return { kind: 'loaded', log };
    } catch {
      // The request never got an answer at all.
      return { kind: 'retry', message: UNREACHABLE_SERVER };
    }
  },
});
