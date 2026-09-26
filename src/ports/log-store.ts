import type { DayLog, IsoDate } from '../domain/entry';
import type { MealRecording } from '../domain/meal-draft';
import type { NightRecording, NightWindow } from '../domain/night';
import type { RecentMeal } from '../domain/recent-readings';

// Reading the signed-in account's own entries for one date, and recording a meal.
//
// The port takes no account identifier, because ownership is not a parameter of
// the read: the store reads as whoever is signed in, and Postgres decides which
// rows that is. A port that accepted a user id would invite a caller to ask for
// somebody else's rows.

export type DayLogOutcome =
  | { readonly kind: 'loaded'; readonly log: DayLog }
  /** The server could not be reached. Show no entries rather than stale ones. */
  | { readonly kind: 'retry'; readonly message: string }
  /** The session is gone, so the read had no owner to run as. */
  | { readonly kind: 'session-ended'; readonly message: string };

/**
 * What the store says when a recording was not written whole. A meal with no
 * foods is not a thing this product can compare, so a write that got the meal
 * row down but not its foods is undone and refused rather than left behind.
 */
export const MEAL_NOT_SAVED = 'Could not save the meal. Nothing was recorded.';

export type SaveMealOutcome =
  | { readonly kind: 'saved'; readonly id: string }
  /** The write was undone or never happened. Nothing on the date changed. */
  | { readonly kind: 'refused'; readonly message: string }
  /** The server could not be reached. The person's values are kept and the attempt repeats. */
  | { readonly kind: 'retry'; readonly message: string }
  /** The session is gone, so the write had no owner to run as. */
  | { readonly kind: 'session-ended'; readonly message: string };

/**
 * What the store says when the night could not be written. The dose is the whole
 * record, so a write that did not land leaves the date exactly as it was.
 */
export const NIGHT_NOT_SAVED = 'Could not save the night. Nothing was recorded.';

export type SaveNightOutcome =
  | { readonly kind: 'saved'; readonly id: string }
  /** The write was undone or never happened. Nothing on the date changed. */
  | { readonly kind: 'refused'; readonly message: string }
  /** The server could not be reached. The person's values are kept on screen. */
  | { readonly kind: 'retry'; readonly message: string }
  /** The session is gone, so the write had no owner to run as. */
  | { readonly kind: 'session-ended'; readonly message: string };

export type NightWindowOutcome =
  | { readonly kind: 'loaded'; readonly window: NightWindow }
  /** The server could not be reached. Show no nights rather than stale ones. */
  | { readonly kind: 'retry'; readonly message: string }
  | { readonly kind: 'session-ended'; readonly message: string };

export type RecentMealsOutcome =
  | { readonly kind: 'loaded'; readonly meals: readonly RecentMeal[] }
  /** The server could not be reached. The pad simply carries no chips. */
  | { readonly kind: 'retry'; readonly message: string }
  | { readonly kind: 'session-ended'; readonly message: string };

export type LogStore = {
  dayLog: (date: IsoDate) => Promise<DayLogOutcome>;
  /**
   * The `count` most recent meals on or before `onOrBefore`, newest first, with
   * just the readings a chip needs. Which of them is 'the last reading' is the
   * domain's rule, not this query's, so every candidate comes back and nothing
   * about the pad's offer is decided in SQL.
   */
  recentMeals: (onOrBefore: IsoDate, count: number) => Promise<RecentMealsOutcome>;
  /**
   * Records a meal with its foods, or updates the meal the recording names. One
   * entry point for both, because adding the after reading later must update that
   * row rather than write a second meal on the date.
   */
  saveMeal: (recording: MealRecording) => Promise<SaveMealOutcome>;
  /**
   * Records the night dose for its date, or updates the night already there. One
   * night per account per date, so this never adds a second one.
   */
  saveNight: (recording: NightRecording) => Promise<SaveNightOutcome>;
  /**
   * The `count` most recent nights strictly before `before`, newest first, with
   * the meals on the dates that follow them. The store hands back the material
   * and the domain decides which meal supplies a morning reading, so the
   * derivation is not buried in a query.
   */
  recentNights: (before: IsoDate, count: number) => Promise<NightWindowOutcome>;
};
