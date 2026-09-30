import type { IsoDate, MealSlot } from './entry';

// A meal as the History grid reads it: its slot, its day and its two readings,
// and nothing else. No DOM and no SDK here.

/** One recorded meal, as much of it as a grid cell needs and no more. */
export type RecentMeal = {
  readonly id: string;
  readonly slot: MealSlot;
  readonly eatenOn: IsoDate;
  readonly eatenAt: Date;
  readonly glucoseBefore: number | null;
  readonly glucoseAfter: number | null;
};
