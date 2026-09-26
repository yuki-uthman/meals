import type { PostgrestError, SupabaseClient } from '@supabase/supabase-js';
import { SESSION_ENDED, UNREACHABLE_SERVER } from '../../ports/identity';
import type { DayLogOutcome, LogStore } from '../../ports/log-store';
import type { DayLog, FoodPortion, IsoDate, Meal, MealSlot, NightInsulin } from '../../domain/entry';

// PostgREST behind the log-store port.
//
// Note what is absent: there is no .eq('user_id', ...) anywhere below. The
// requests ask for a date range and nothing else, so row-level security is the
// only thing that decides which rows come back. A row belonging to another
// account is not filtered out here; it is never sent.

const MEAL_SELECT = `
  id, slot, eaten_at, glucose_before, glucose_after, insulin_units,
  meal_foods ( name, food_type, amount, unit, position )
`;

const NIGHT_SELECT = 'id, night_on, units, taken_at, bedtime_glucose';

/** The reader's own midnight-to-midnight window, not UTC's. */
const dayBounds = (date: IsoDate): { readonly from: string; readonly to: string } => {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  const from = new Date(year, month - 1, day, 0, 0, 0, 0);
  const to = new Date(year, month - 1, day + 1, 0, 0, 0, 0);
  return { from: from.toISOString(), to: to.toISOString() };
};

const asNumber = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isNaN(parsed) ? null : parsed;
};

const asText = (value: unknown): string | null =>
  typeof value === 'string' && value !== '' ? value : null;

type FoodRow = { name?: unknown; amount?: unknown; unit?: unknown; position?: unknown };

const toFood = (row: FoodRow): FoodPortion => ({
  name: typeof row.name === 'string' ? row.name : '',
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
  meal_foods?: unknown;
};

const toMeal = (row: MealRow): Meal => {
  const foods = Array.isArray(row.meal_foods) ? (row.meal_foods as FoodRow[]) : [];
  return {
    id: String(row.id),
    slot: String(row.slot) as MealSlot,
    eatenAt: new Date(String(row.eaten_at)),
    glucoseBefore: asNumber(row.glucose_before),
    glucoseAfter: asNumber(row.glucose_after),
    insulinUnits: asNumber(row.insulin_units),
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
 * sign-in; anything else that came back wrong is worth retrying. An empty
 * result is not a failure at all: owning no rows for the date is the ordinary
 * empty day log.
 */
const toFailure = (error: PostgrestError, status: number): DayLogOutcome =>
  status === 401 || error.code === 'PGRST301'
    ? { kind: 'session-ended', message: SESSION_ENDED }
    : { kind: 'retry', message: UNREACHABLE_SERVER };

export const supabaseLogStore = (client: SupabaseClient): LogStore => ({
  dayLog: async (date: IsoDate): Promise<DayLogOutcome> => {
    const { from, to } = dayBounds(date);

    try {
      const [mealsResult, nightResult] = await Promise.all([
        client
          .from('meals')
          .select(MEAL_SELECT)
          .gte('eaten_at', from)
          .lt('eaten_at', to)
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
