// The keying rules behind the in-app number pad and the dose stepper, as pure
// functions from the value in a field to the value that replaces it. No DOM
// here, so what a key does is one statement rather than an event handler.

/**
 * A reading above 999 mg/dL is not a reading, so the pad refuses a fourth digit
 * at the point of entry. The schema's wider bound stays where it is, as a guard
 * against bad data rather than as an invitation to key it.
 */
export const MAX_GLUCOSE_DIGITS = 3;

export const DIGITS: readonly string[] = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'];

/** Only what the pad can have produced; anything else came from a keyboard. */
const digitsOf = (value: string): string => value.replace(/\D/g, '');

/**
 * A digit appends to the right, and the digit past the limit is refused
 * outright: the field keeps exactly what it had, rather than losing its leading
 * digit to make room.
 */
export const appendDigit = (value: string, digit: string): string => {
  const current = digitsOf(value);
  if (current.length >= MAX_GLUCOSE_DIGITS) return current;
  return `${current}${digit}`;
};

/** Delete removes exactly the rightmost digit. On an empty field it is refused. */
export const deleteLastDigit = (value: string): string => digitsOf(value).slice(0, -1);

/** Clear empties the field. One tap undoes a mistaken chip. */
export const CLEARED = '';

/** A chip replaces whatever was there, rather than appending to it. */
export const chipValue = (value: number): string => String(value);

/** One unit, the amount a dose control moves by. It never moves by more. */
export const DOSE_STEP = 1;

const asDose = (value: string): number => {
  const parsed = Number(value.trim());
  return Number.isFinite(parsed) ? parsed : 0;
};

/** Whole doses read whole: 2, never 2.0, and 2.5 keeps its half. */
const doseText = (units: number): string =>
  Number.isInteger(units) ? String(units) : String(Number(units.toFixed(2)));

/**
 * The dose one step away. A dose never goes below zero, so decreasing at zero
 * does nothing: a negative dose is not a thing that can be taken. An empty field
 * counts as zero, so the first increase reads 1.
 *
 * This moves a number the person is choosing. It does not propose one.
 */
export const stepDose = (value: string, steps: number): string => {
  const next = asDose(value) + steps * DOSE_STEP;
  return doseText(next < 0 ? 0 : next);
};
