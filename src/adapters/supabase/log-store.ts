import type { PostgrestError, SupabaseClient } from '@supabase/supabase-js';
import { SESSION_ENDED, UNREACHABLE_SERVER } from '../../ports/identity';
import {
  MEAL_NOT_HERE,
  MEAL_NOT_SAVED,
  NIGHT_NOT_SAVED,
  type CreateFoodOutcome,
  type DayLogOutcome,
  type FoodCatalogueOutcome,
  type HistoryWindowOutcome,
  type LogStore,
  type MealHistoryOutcome,
  type MealOutcome,
  type NightWindowOutcome,
  type SaveMealOutcome,
  type SaveNightOutcome,
} from '../../ports/log-store';
import { ALREADY_OWNED, type CatalogueFood } from '../../domain/food-catalogue';
import type { MealInstance } from '../../domain/meal-identity';
import type { RecentMeal } from '../../domain/recent-readings';
import { shiftDate } from '../../domain/entry';
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
import type { MorningMeal, NightRecording, NightWindow } from '../../domain/night';

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

/** The night with what was eaten with it, for the screens that show the foods. */
const NIGHT_WITH_FOODS_SELECT = `
  ${NIGHT_SELECT},
  night_foods ( id, name, food_type, amount, unit, position )
`;

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
  night_foods?: unknown;
};

const toNightInsulin = (row: NightRow): NightInsulin => ({
  id: String(row.id),
  nightOn: String(row.night_on),
  units: asNumber(row.units) ?? 0,
  takenAt: row.taken_at === null || row.taken_at === undefined ? null : new Date(String(row.taken_at)),
  bedtimeGlucose: asNumber(row.bedtime_glucose),
  foods: Array.isArray(row.night_foods)
    ? [...(row.night_foods as FoodRow[])].sort(byPosition).map(toFood)
    : [],
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

/** And for the night's write path, read exactly the same way. */
const toNightFailure = (error: PostgrestError, status: number): SaveNightOutcome =>
  isSessionGone(error, status)
    ? { kind: 'session-ended', message: SESSION_ENDED }
    : { kind: 'retry', message: UNREACHABLE_SERVER };

/** And for the five-night read. */
const toWindowFailure = (error: PostgrestError, status: number): NightWindowOutcome =>
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

/** A recording's foods as rows, each written against the record it belongs to. */
const foodLines = (
  owner: { readonly meal_id: string } | { readonly night_id: string },
  foods: readonly FoodRecording[],
): Record<string, unknown>[] =>
  foods.map((food, index) => ({
    ...owner,
    name: food.name,
    food_type: food.foodType,
    amount: food.amount,
    unit: food.unit,
    // Position is what the reading path sorts by, so the foods come back in the
    // order they were entered rather than in whatever order Postgres returns.
    position: index + 1,
  }));

const foodRows = (mealId: string, foods: readonly FoodRecording[]): Record<string, unknown>[] =>
  foodLines({ meal_id: mealId }, foods);

/** The same lines, written against a night rather than a meal. */
const nightFoodRows = (nightId: string, foods: readonly FoodRecording[]): Record<string, unknown>[] =>
  foodLines({ night_id: nightId }, foods);

const rowIds = (rows: unknown): string[] =>
  (Array.isArray(rows) ? (rows as { id?: unknown }[]) : []).map((row) => String(row.id));

/**
 * A new meal and its foods, written together. PostgREST has no transaction
 * across two requests, so the meal row is created first and removed again if its
 * foods do not land: a half-written meal would quietly corrupt every later
 * lookup. A meal recorded with no foods yet -- the reading now, the foods later --
 * has nothing to write after its row.
 */
const recordNewMeal = async (
  client: SupabaseClient,
  recording: MealRecording,
): Promise<SaveMealOutcome> => {
  const created = await client.from('meals').insert(mealFields(recording)).select('id').single();
  if (created.error !== null) return toSaveFailure(created.error, created.status);

  const id = String((created.data as { id?: unknown }).id);
  if (recording.foods.length === 0) return { kind: 'saved', id };

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

  if (recording.foods.length > 0) {
    const inserted = await client.from('meal_foods').insert(foodRows(id, recording.foods));
    if (inserted.error !== null) return { kind: 'refused', message: MEAL_NOT_SAVED };
  }

  const previous = rowIds(existing.data);
  if (previous.length > 0) {
    const removed = await client.from('meal_foods').delete().in('id', previous);
    if (removed.error !== null) return toSaveFailure(removed.error, removed.status);
  }

  return { kind: 'saved', id };
};

/**
 * The night row's own columns. No user_id here either: the column defaults to
 * auth.uid() and the insert policy checks it, so who owns a written night is
 * decided by Postgres and cannot be asked for by the browser.
 */
const nightFields = (recording: NightRecording): Record<string, unknown> => ({
  // night_on, never taken_at, is what a day is selected on, so a 22:30 dose
  // cannot drift into the neighbouring day when the server's offset differs.
  night_on: recording.nightOn,
  units: recording.units,
  taken_at: recording.takenAt === null ? null : recording.takenAt.toISOString(),
  bedtime_glucose: recording.bedtimeGlucose,
});

/**
 * The night already recorded for the date, if any. One night per account per
 * date is the rule, so a save that did not come from an opened record still
 * updates that night rather than adding a second one.
 */
const existingNightId = async (
  client: SupabaseClient,
  nightOn: IsoDate,
): Promise<{ readonly id: string | null } | SaveNightOutcome> => {
  // No user_id filter: row-level security is what limits this to the caller's
  // own night, so the id that comes back can only ever be theirs.
  const found = await client.from('night_insulin').select('id').eq('night_on', nightOn).limit(1);
  if (found.error !== null) return toNightFailure(found.error, found.status);
  const rows = Array.isArray(found.data) ? (found.data as { id?: unknown }[]) : [];
  return { id: rows.length === 0 ? null : String(rows[0]?.id) };
};

/**
 * The night's foods replaced by what the recording holds. The new rows are written
 * before the old ones are removed, so a failed insert leaves what was recorded
 * standing rather than emptying the night.
 */
const replaceNightFoods = async (
  client: SupabaseClient,
  id: string,
  foods: readonly FoodRecording[],
): Promise<SaveNightOutcome> => {
  const existing = await client.from('night_foods').select('id').eq('night_id', id);
  if (existing.error !== null) return toNightFailure(existing.error, existing.status);

  if (foods.length > 0) {
    const inserted = await client.from('night_foods').insert(nightFoodRows(id, foods));
    if (inserted.error !== null) return { kind: 'refused', message: NIGHT_NOT_SAVED };
  }

  const previous = rowIds(existing.data);
  if (previous.length > 0) {
    const removed = await client.from('night_foods').delete().in('id', previous);
    if (removed.error !== null) return toNightFailure(removed.error, removed.status);
  }

  return { kind: 'saved', id };
};

const MORNING_SELECT = 'slot, eaten_on, eaten_at, glucose_before';

type MorningRow = {
  slot?: unknown;
  eaten_on?: unknown;
  eaten_at?: unknown;
  glucose_before?: unknown;
};

const toMorningMeal = (row: MorningRow): MorningMeal => ({
  slot: String(row.slot) as MealSlot,
  eatenOn: String(row.eaten_on),
  eatenAt: new Date(String(row.eaten_at)),
  glucoseBefore: asNumber(row.glucose_before),
});

const RECENT_MEAL_SELECT =
  'id, slot, eaten_on, eaten_at, glucose_before, glucose_after, meal_foods ( name )';

type RecentMealRow = {
  id?: unknown;
  slot?: unknown;
  eaten_on?: unknown;
  eaten_at?: unknown;
  glucose_before?: unknown;
  glucose_after?: unknown;
  meal_foods?: unknown;
};

const toRecentMeal = (row: RecentMealRow): RecentMeal => ({
  id: String(row.id),
  slot: String(row.slot) as MealSlot,
  eatenOn: String(row.eaten_on),
  eatenAt: new Date(String(row.eaten_at)),
  glucoseBefore: asNumber(row.glucose_before),
  glucoseAfter: asNumber(row.glucose_after),
  foods: Array.isArray(row.meal_foods)
    ? (row.meal_foods as { name?: unknown }[]).map((food) => String(food.name))
    : [],
});

/** A meal as the instance list reads it: the day it belongs to, and its foods. */
const toMealInstance = (row: MealRow & { eaten_on?: unknown }): MealInstance => {
  const foods = Array.isArray(row.meal_foods) ? (row.meal_foods as FoodRow[]) : [];
  return {
    id: String(row.id),
    slot: String(row.slot) as MealSlot,
    eatenOn: String(row.eaten_on),
    eatenAt: new Date(String(row.eaten_at)),
    glucoseBefore: asNumber(row.glucose_before),
    glucoseAfter: asNumber(row.glucose_after),
    insulinUnits: asNumber(row.insulin_units),
    foods: [...foods].sort(byPosition).map(toFood),
  };
};

/** And for the history read, read exactly the same way. */
const toHistoryFailure = (error: PostgrestError, status: number): MealHistoryOutcome =>
  isSessionGone(error, status)
    ? { kind: 'session-ended', message: SESSION_ENDED }
    : { kind: 'retry', message: UNREACHABLE_SERVER };

/** And for the History grid's read, read exactly the same way. */
const toHistoryWindowFailure = (error: PostgrestError, status: number): HistoryWindowOutcome =>
  isSessionGone(error, status)
    ? { kind: 'session-ended', message: SESSION_ENDED }
    : { kind: 'retry', message: UNREACHABLE_SERVER };

/** And for the single-meal read, read exactly the same way. */
const toMealFailure = (error: PostgrestError, status: number): MealOutcome =>
  isSessionGone(error, status)
    ? { kind: 'session-ended', message: SESSION_ENDED }
    : { kind: 'retry', message: UNREACHABLE_SERVER };

// ------------------------------------------------------------ the catalogue

/**
 * A food of its own, with the meals it has been eaten in. The uses come back so the
 * domain can order the offer by when each food was last used; which foods a typed
 * name offers, and how many, is decided there and never here.
 */
const FOOD_SELECT = 'id, name, food_type, created_at, meal_foods ( meals ( eaten_at ) )';

type FoodUseRow = { meals?: unknown };

type CatalogueRow = {
  id?: unknown;
  name?: unknown;
  food_type?: unknown;
  created_at?: unknown;
  meal_foods?: unknown;
};

/** PostgREST returns a to-one embed as an object; older shapes return an array. */
const embeddedMeal = (value: unknown): { eaten_at?: unknown } | null => {
  const one = Array.isArray(value) ? value[0] : value;
  return typeof one === 'object' && one !== null ? (one as { eaten_at?: unknown }) : null;
};

const lastEatenAt = (uses: unknown): Date | null => {
  const rows = Array.isArray(uses) ? (uses as FoodUseRow[]) : [];
  const times = rows.flatMap((use): Date[] => {
    const meal = embeddedMeal(use.meals);
    const at = meal === null ? null : asText(meal.eaten_at);
    return at === null ? [] : [new Date(at)];
  });
  if (times.length === 0) return null;
  return times.reduce((latest, at) => (at > latest ? at : latest));
};

const toCatalogueFood = (row: CatalogueRow): CatalogueFood => ({
  id: String(row.id),
  name: typeof row.name === 'string' ? row.name : '',
  // The column is constrained to the seven types, so whatever came back is one.
  foodType: String(row.food_type) as FoodType,
  addedAt: new Date(String(row.created_at)),
  lastEatenAt: lastEatenAt(row.meal_foods),
});

/** And for the catalogue read, read exactly the same way. */
const toCatalogueFailure = (error: PostgrestError, status: number): FoodCatalogueOutcome =>
  isSessionGone(error, status)
    ? { kind: 'session-ended', message: SESSION_ENDED }
    : { kind: 'retry', message: UNREACHABLE_SERVER };

/** Postgres's unique violation: this account already owns that normalised name. */
const UNIQUE_VIOLATION = '23505';

const toCreateFoodFailure = (error: PostgrestError, status: number): CreateFoodOutcome => {
  if (error.code === UNIQUE_VIOLATION) return { kind: 'refused', message: ALREADY_OWNED };
  return isSessionGone(error, status)
    ? { kind: 'session-ended', message: SESSION_ENDED }
    : { kind: 'retry', message: UNREACHABLE_SERVER };
};

export const supabaseLogStore = (client: SupabaseClient): LogStore => ({
  foodCatalogue: async (): Promise<FoodCatalogueOutcome> => {
    try {
      // No user_id filter here either: row-level security is the only thing that
      // decides whose foods an Add food screen can ever offer, so another
      // account's food is never sent rather than being filtered out afterwards.
      const result = await client.from('foods').select(FOOD_SELECT);
      if (result.error !== null) return toCatalogueFailure(result.error, result.status);
      return {
        kind: 'loaded',
        foods: ((result.data ?? []) as CatalogueRow[]).map(toCatalogueFood),
      };
    } catch {
      return { kind: 'retry', message: UNREACHABLE_SERVER };
    }
  },

  createFood: async (name: string, foodType: FoodType): Promise<CreateFoodOutcome> => {
    try {
      // No user_id: the column defaults to auth.uid() and the insert policy checks
      // it, so who owns a created food is decided by Postgres. The name is written
      // trimmed; the unique index normalises it further to decide identity, and a
      // second entry differing only in case is refused by that index rather than
      // by a guess made here.
      const created = await client
        .from('foods')
        .insert({ name: name.trim(), food_type: foodType })
        .select('id, name, food_type, created_at')
        .single();
      if (created.error !== null) return toCreateFoodFailure(created.error, created.status);
      return { kind: 'created', food: toCatalogueFood(created.data as CatalogueRow) };
    } catch {
      return { kind: 'retry', message: UNREACHABLE_SERVER };
    }
  },

  meal: async (id: string): Promise<MealOutcome> => {
    try {
      // No user_id filter here either: the select policy is the only thing that
      // decides whether this row exists for the caller, so a guessed id comes
      // back empty rather than being filtered out afterwards. 'Not yours' and
      // 'not there' are therefore one answer, which is exactly what is said.
      const result = await client.from('meals').select(MEAL_SELECT).eq('id', id).limit(1);
      if (result.error !== null) return toMealFailure(result.error, result.status);
      const rows = (result.data ?? []) as MealRow[];
      const row = rows[0];
      if (row === undefined) return { kind: 'missing', message: MEAL_NOT_HERE };
      return { kind: 'loaded', meal: toMeal(row) };
    } catch {
      return { kind: 'retry', message: UNREACHABLE_SERVER };
    }
  },

  mealHistory: async (): Promise<MealHistoryOutcome> => {
    try {
      // No user_id filter here either: row-level security is the only thing that
      // decides whose meals an instance list can ever contain, so another
      // account's meal is never sent rather than being filtered out afterwards.
      const result = await client
        .from('meals')
        .select(MEAL_SELECT)
        .order('eaten_on', { ascending: false })
        .order('eaten_at', { ascending: false });
      if (result.error !== null) return toHistoryFailure(result.error, result.status);
      return {
        kind: 'loaded',
        meals: ((result.data ?? []) as MealRow[]).map(toMealInstance),
      };
    } catch {
      return { kind: 'retry', message: UNREACHABLE_SERVER };
    }
  },

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

  saveNight: async (recording: NightRecording): Promise<SaveNightOutcome> => {
    try {
      let id = recording.id;
      if (id === null) {
        const found = await existingNightId(client, recording.nightOn);
        if ('kind' in found) return found;
        id = found.id;
      }

      if (id === null) {
        const created = await client
          .from('night_insulin')
          .insert(nightFields(recording))
          .select('id')
          .single();
        if (created.error !== null) return toNightFailure(created.error, created.status);
        const createdId = String((created.data as { id?: unknown }).id);
        if (recording.foods.length === 0) return { kind: 'saved', id: createdId };

        // A new night and its foods together: if the foods do not land, the night is
        // removed again, so a save either records what was entered or nothing.
        const foods = await client
          .from('night_foods')
          .insert(nightFoodRows(createdId, recording.foods));
        if (foods.error !== null) {
          await client.from('night_insulin').delete().eq('id', createdId);
          return { kind: 'refused', message: NIGHT_NOT_SAVED };
        }
        return { kind: 'saved', id: createdId };
      }

      // Updating the night the date already holds, so recording twice corrects
      // the night rather than putting two nights on one date.
      const updated = await client
        .from('night_insulin')
        .update(nightFields(recording))
        .eq('id', id)
        .select('id');
      if (updated.error !== null) return toNightFailure(updated.error, updated.status);
      return await replaceNightFoods(client, id, recording.foods);
    } catch {
      // The request never got an answer at all, so whether Postgres committed is
      // unknown. It is reported as worth retrying and never retried here.
      return { kind: 'retry', message: UNREACHABLE_SERVER };
    }
  },

  recentNights: async (before: IsoDate, count: number): Promise<NightWindowOutcome> => {
    try {
      // Strictly before the date being recorded, newest first, and no more than
      // the screen lists. Selected on night_on, never on taken_at.
      const nightResult = await client
        .from('night_insulin')
        .select(NIGHT_SELECT)
        .lt('night_on', before)
        .order('night_on', { ascending: false })
        .limit(count);
      if (nightResult.error !== null) return toWindowFailure(nightResult.error, nightResult.status);

      const nights = ((nightResult.data ?? []) as NightRow[]).map(toNightInsulin);
      if (nights.length === 0) {
        return { kind: 'loaded', window: { nights, mornings: [] } };
      }

      // The meals that could supply a morning: the ones on the date following
      // each night. Which of them is the morning is the domain's rule, not this
      // query's, so every candidate on those dates comes back.
      const morningDates = nights.map((night) => shiftDate(night.nightOn, 1));
      const mealResult = await client
        .from('meals')
        .select(MORNING_SELECT)
        .in('eaten_on', morningDates)
        .order('eaten_at', { ascending: true });
      if (mealResult.error !== null) return toWindowFailure(mealResult.error, mealResult.status);

      const window: NightWindow = {
        nights,
        mornings: ((mealResult.data ?? []) as MorningRow[]).map(toMorningMeal),
      };
      return { kind: 'loaded', window };
    } catch {
      return { kind: 'retry', message: UNREACHABLE_SERVER };
    }
  },

  historyWindow: async (from: IsoDate, to: IsoDate): Promise<HistoryWindowOutcome> => {
    try {
      // No user_id filter here either: row-level security is the only thing that
      // scopes this read, so a grid can never contain another account's
      // readings. Both reads select on the date column and never on the
      // timestamp, so a late row stays on the day its writer meant.
      //
      // The nights reach back one further date than the meals, because the night
      // in a row is the one dated the day BEFORE that row.
      const [mealResult, nightResult] = await Promise.all([
        client
          .from('meals')
          .select(RECENT_MEAL_SELECT)
          .gte('eaten_on', from)
          .lte('eaten_on', to)
          .order('eaten_at', { ascending: true }),
        client
          .from('night_insulin')
          .select(NIGHT_SELECT)
          .gte('night_on', shiftDate(from, -1))
          .lte('night_on', to)
          .order('night_on', { ascending: false }),
      ]);

      if (mealResult.error !== null) {
        return toHistoryWindowFailure(mealResult.error, mealResult.status);
      }
      if (nightResult.error !== null) {
        return toHistoryWindowFailure(nightResult.error, nightResult.status);
      }

      return {
        kind: 'loaded',
        window: {
          meals: ((mealResult.data ?? []) as RecentMealRow[]).map(toRecentMeal),
          nights: ((nightResult.data ?? []) as NightRow[]).map(toNightInsulin),
        },
      };
    } catch {
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
        client.from('night_insulin').select(NIGHT_WITH_FOODS_SELECT).eq('night_on', date),
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
