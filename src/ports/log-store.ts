import type { DayLog, IsoDate } from '../domain/entry';
import type { MealRecording } from '../domain/meal-draft';

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

export type LogStore = {
  dayLog: (date: IsoDate) => Promise<DayLogOutcome>;
  /**
   * Records a meal with its foods, or updates the meal the recording names. One
   * entry point for both, because adding the after reading later must update that
   * row rather than write a second meal on the date.
   */
  saveMeal: (recording: MealRecording) => Promise<SaveMealOutcome>;
};
