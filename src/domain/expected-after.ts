// The expected-after estimate: what the after reading would be if this meal did
// again exactly what it did the last time it was eaten the same way.
//
// The rule is deliberately narrow, and the narrowness IS the value. The estimate
// is the before reading plus the change of ONE recorded occasion: the most recent
// meal with the same foods (value 6's identity rule), in the same slot, at the
// same dose. Averaging several occasions, widening the dose to a tolerance or
// borrowing another slot would all produce a number no single recorded meal ever
// produced, and this product only ever reports what happened.
//
// It reports; it never proposes. Nothing here suggests, targets or recommends a
// dose: the dose is one the person has already chosen, and the estimate says what
// one occasion at that dose was followed by. When there is no such occasion there
// is no number, and the reason is said out loud rather than left blank, because a
// blank panel reads as 'nothing has ever happened', which is a different claim.

import { changeBand, type ChangeBand } from './band';
import {
  changeText,
  doseText,
  type FoodPortion,
  type IsoDate,
  type MealSlot,
} from './entry';
import type { FoodDraft, MealDraft } from './meal-draft';
import { instanceDateText, sameFoods, type MealInstance } from './meal-identity';

/** The panel's name. It names what it reports and makes no offer of any kind. */
export const EXPECTED_AFTER_LABEL = 'Expected after';

/** An estimate with no starting point is not an estimate, so the panel asks for one. */
export const NO_READING_REASON = 'Type your reading before eating to see an estimate.';

/**
 * A dose is part of the match, so until the person has chosen one there is
 * nothing to match on. The wording asks for the dose they have decided to take;
 * it does not hint at which.
 */
export const NO_DOSE_REASON = 'Enter the dose to see an estimate.';

/** 'No dinner on record with these foods.' */
export const noOccasionReason = (slot: MealSlot): string =>
  `No ${slot} on record with these foods.`;

/**
 * 'No dinner at 7 u. Most recent was 6 u (+32).' The second sentence names what
 * IS on record at any dose, so a person who typed a dose they have never taken
 * with these foods can see why the number went away rather than guessing.
 */
export const noDoseMatchReason = (
  slot: MealSlot,
  dose: number,
  mostRecentDose: number | null,
  mostRecentChange: number,
): string => {
  const asked = doseText(dose) ?? '';
  const had = doseText(mostRecentDose);
  const change = changeText(mostRecentChange);
  return had === null
    ? `No ${slot} at ${asked}. Most recent had no dose recorded (${change}).`
    : `No ${slot} at ${asked}. Most recent was ${had} (${change}).`;
};

/**
 * What the panel shows. Either a number with the band of the change it was built
 * from and the one occasion it came from, or the reason there is no number.
 */
export type ExpectedAfterView =
  | {
      readonly kind: 'estimate';
      /** The estimated reading, in whole mg/dL. */
      readonly reading: string;
      /** The band of the CHANGE the estimate is built from, never of the reading. */
      readonly band: ChangeBand;
      /** The occasion the estimate is traceable to, as one line. */
      readonly source: string;
    }
  | { readonly kind: 'reason'; readonly message: string };

/** One recorded occasion that could be a basis: both readings taken, so a change exists. */
type Measured = {
  readonly instance: MealInstance;
  readonly change: number;
};

const numberOf = (text: string): number | null => {
  const trimmed = text.trim();
  if (trimmed === '') return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
};

/** Glucose is whole numbers in mg/dL, so a typed decimal is read as one. */
const readingOf = (text: string): number | null => {
  const parsed = numberOf(text);
  return parsed === null ? null : Math.round(parsed);
};

/**
 * The draft's foods as identity sees them. A food with no name is not yet a food,
 * so it takes no part in identity: a half-typed row must not make a draft stop
 * matching the meal it is a repeat of.
 */
const draftPortions = (foods: readonly FoodDraft[]): readonly FoodPortion[] =>
  foods.flatMap((food): readonly FoodPortion[] => {
    const name = food.name.trim();
    if (name === '') return [];
    const amount = numberOf(food.amount);
    return [
      { name, foodType: food.foodType, amount, unit: amount === null ? null : food.unit },
    ];
  });

/** Newest first: by the day the meal belongs to, then by its clock time. */
const newestFirst = (a: Measured, b: Measured): number => {
  const left: IsoDate = a.instance.eatenOn;
  const right: IsoDate = b.instance.eatenOn;
  if (left === right) return b.instance.eatenAt.getTime() - a.instance.eatenAt.getTime();
  return left < right ? 1 : -1;
};

/**
 * The occasions that could be a basis, newest first: the same foods, the same
 * slot, not this draft's own row, and BOTH readings taken.
 *
 * An occasion with no after reading is skipped as though it did not match at all.
 * It is not a change of zero: nobody measured what followed it, and reporting
 * zero would be reporting something that never happened -- even though such an
 * occasion may well be the most recent one on the calendar.
 */
const basisCandidates = (
  history: readonly MealInstance[],
  draft: MealDraft,
): readonly Measured[] =>
  history
    .filter((instance) => instance.id !== draft.mealId)
    .filter((instance) => instance.slot === draft.slot)
    .filter((instance) => sameFoods(instance.foods, draftPortions(draft.foods)))
    .flatMap((instance): readonly Measured[] =>
      instance.glucoseBefore === null || instance.glucoseAfter === null
        ? []
        : [{ instance, change: instance.glucoseAfter - instance.glucoseBefore }],
    )
    .sort(newestFirst);

/**
 * The occasion the estimate came from, in the person's own recorded terms: when
 * it was, the dose, the two readings and the change between them. An estimate
 * that could not be traced back to one occasion would read as a prediction the
 * app had made up.
 */
const sourceText = (basis: Measured): string => {
  const { instance } = basis;
  const dose = doseText(instance.insulinUnits);
  const when = instanceDateText(instance.eatenOn);
  const readings = `${String(instance.glucoseBefore)} → ${String(instance.glucoseAfter)}`;
  return `Last ${instance.slot} like this, ${when}${dose === null ? '' : ` · ${dose}`} · ${readings} · ${changeText(basis.change)}`;
};

/**
 * What the panel says for this draft against this history. A total function: every
 * state of the draft has an answer, and four of them are reasons rather than
 * numbers.
 */
export const expectedAfterView = (
  draft: MealDraft,
  history: readonly MealInstance[],
): ExpectedAfterView => {
  const before = readingOf(draft.glucoseBefore);
  if (before === null) return { kind: 'reason', message: NO_READING_REASON };

  const dose = numberOf(draft.insulinUnits);
  if (dose === null) return { kind: 'reason', message: NO_DOSE_REASON };

  const candidates = basisCandidates(history, draft);
  const mostRecent = candidates[0];
  if (mostRecent === undefined) {
    return { kind: 'reason', message: noOccasionReason(draft.slot) };
  }

  // Doses are compared as numbers, so 6 and 6.00 are the same dose -- and 6 and
  // 7 are different doses, which is the whole point of matching on it.
  const basis = candidates.find(
    (candidate) => candidate.instance.insulinUnits === dose,
  );
  if (basis === undefined) {
    return {
      kind: 'reason',
      message: noDoseMatchReason(
        draft.slot,
        dose,
        mostRecent.instance.insulinUnits,
        mostRecent.change,
      ),
    };
  }

  return {
    kind: 'estimate',
    reading: String(before + basis.change),
    // The band belongs to the change, so the same arithmetic is never coloured
    // two different ways anywhere in the app.
    band: changeBand(basis.change),
    source: sourceText(basis),
  };
};
