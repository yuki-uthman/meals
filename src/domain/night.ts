// The night dose a person is filling in, the rules that say when it may be
// recorded, and the five-night list the night screen reads. No DOM and no SDK
// here, so both the refusal and the derivation of the next-morning reading are
// testable without a browser.
//
// The next-morning reading is DERIVED, never recorded: the brief's list of what
// the person records for a night is the dose, the time and the bedtime glucose,
// and nothing else. It is the glucose before the earliest meal on the following
// calendar date, and a night whose following date has no such reading is
// indeterminate rather than zero.

import { levelBand, type LevelBand } from './band';
import { clockTime, doseText, shiftDate, type IsoDate, type NightInsulin } from './entry';

/**
 * The night being filled in. Like a meal draft it holds what the person typed, as
 * text, so a half-typed dose is a real state the form can be in and the field
 * keeps showing what was entered.
 */
export type NightDraft = {
  /** The night row being updated, or null when nothing is recorded for the date. */
  readonly nightId: string | null;
  /**
   * The date the night is recorded against: the one the Today screen is reading.
   * The schema holds one night per account per date, so saving twice updates that
   * night rather than adding another.
   */
  readonly date: IsoDate;
  readonly units: string;
  /** Local clock time as 'HH:MM', or empty when the person did not say. */
  readonly takenAt: string;
  readonly bedtimeGlucose: string;
};

/**
 * The dose is required; the time and the bedtime glucose are not, because a
 * person who took their basal and did not measure must still be able to record
 * the dose. The app never fills one in on their behalf.
 */
export const NO_DOSE_REFUSAL = 'Enter the dose.';

/**
 * The three labels, fixed here rather than in the screen. 'Taken at' rather than
 * 'Time' on purpose: 'Time' is a substring of 'Bedtime glucose', so a label match
 * on it would resolve to two fields. Labels on one screen must not contain one
 * another, and keeping the three together is what makes that checkable.
 */
/**
 * The accessible name of the control on Today's night card, which is the way in
 * to this screen. It names the thing rather than the position, so a person using
 * a screen reader hears what the card opens.
 */
export const OPEN_NIGHT_LABEL = 'Record night insulin';

export const DOSE_LABEL = 'Dose';
export const TAKEN_AT_LABEL = 'Taken at';
export const BEDTIME_GLUCOSE_LABEL = 'Bedtime glucose';

/** The time field opens on the current clock time; the person may change it. */
export const newNightDraft = (date: IsoDate, now: Date = new Date()): NightDraft => ({
  nightId: null,
  date,
  units: '',
  takenAt: clockTime(now),
  bedtimeGlucose: '',
});

/** A recorded number back in a field: 18 reads as '18', never as '18.00'. */
const fieldText = (value: number | null): string =>
  value === null ? '' : String(Number(value.toFixed(2)));

/**
 * The night already recorded for the date, as a draft. It keeps the row's id,
 * which is what makes saving update that night instead of writing a second one.
 */
export const nightDraftFrom = (night: NightInsulin, date: IsoDate): NightDraft => ({
  nightId: night.id,
  date,
  units: fieldText(night.units),
  takenAt: night.takenAt === null ? '' : clockTime(night.takenAt),
  bedtimeGlucose: fieldText(night.bedtimeGlucose),
});

// ------------------------------------------------------------- recording

/**
 * A draft that has passed its rules, as the store is asked to write it. `id` is
 * the existing night for the date, or null, so one write path covers recording
 * tonight and correcting it later.
 */
export type NightRecording = {
  readonly id: string | null;
  readonly nightOn: IsoDate;
  readonly units: number;
  readonly takenAt: Date | null;
  readonly bedtimeGlucose: number | null;
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

const TIME_PATTERN = /^\d{1,2}:\d{2}$/;

const localDate = (date: IsoDate): Date => {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  return new Date(year, month - 1, day);
};

const atLocalTime = (date: IsoDate, time: string): Date => {
  const [hours, minutes] = time.split(':').map(Number) as [number, number];
  const at = localDate(date);
  return new Date(at.getFullYear(), at.getMonth(), at.getDate(), hours, minutes, 0, 0);
};

/** Why this night cannot be saved yet, or null when it can. */
export const nightDraftRefusal = (draft: NightDraft): string | null => {
  const units = numberField(draft.units);
  if (units === null || units <= 0) return NO_DOSE_REFUSAL;
  return null;
};

/**
 * The draft as a recording, or null when its rules refuse it. Returning null
 * rather than throwing keeps the refusal a value the screen can show, and makes
 * a recording the rules would have rejected impossible to build.
 */
export const nightRecording = (draft: NightDraft): NightRecording | null => {
  if (nightDraftRefusal(draft) !== null) return null;
  const units = numberField(draft.units);
  if (units === null) return null;
  const time = draft.takenAt.trim();
  return {
    id: draft.nightId,
    nightOn: draft.date,
    units,
    // A time that was not entered is left unrecorded, never guessed at: taken_at
    // says when the dose was taken, and nobody but the person knows that.
    takenAt: TIME_PATTERN.test(time) ? atLocalTime(draft.date, time) : null,
    bedtimeGlucose: glucoseField(draft.bedtimeGlucose),
  };
};

// ------------------------------------------------------- the five-night list

/**
 * A meal that could supply a morning reading: only the date it belongs to, when
 * it was eaten and the reading before it. Which meal of the day supplies the
 * morning is decided here and not by the store, so the rule is one pure
 * function rather than a shape of query.
 */
export type MorningMeal = {
  readonly eatenOn: IsoDate;
  readonly eatenAt: Date;
  readonly glucoseBefore: number | null;
};

/**
 * The raw material the list is read from: the nights themselves, and the meals on
 * the dates that follow them.
 */
export type NightWindow = {
  readonly nights: readonly NightInsulin[];
  readonly mornings: readonly MorningMeal[];
};

/** How many nights the screen lists. */
export const NIGHT_WINDOW = 5;

/** The morning reading, with the level band it falls in. Never a change band. */
export type MorningReading = {
  readonly text: string;
  readonly band: LevelBand;
};

export type NightRow = {
  readonly nightOn: IsoDate;
  /** The short date, 'Mon 21', which is what says which night this row is. */
  readonly date: string;
  readonly dose: string;
  /** Null when nobody measured that morning: indeterminate, and drawn as such. */
  readonly morning: MorningReading | null;
};

/** U+2014, for a morning nobody measured. A missing reading is not a value. */
export const MORNING_UNMEASURED = '—';

/**
 * Deliberately not toLocaleDateString: the row's date is part of what the screen
 * is judged on, so it is built from a fixed vocabulary rather than from whatever
 * the runtime's locale data happens to say.
 */
const SHORT_WEEKDAYS: readonly string[] = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export const shortNightDate = (date: IsoDate): string => {
  const at = localDate(date);
  return `${SHORT_WEEKDAYS[at.getDay()]} ${at.getDate()}`;
};

const byTimeAscending = (a: MorningMeal, b: MorningMeal): number =>
  a.eatenAt.getTime() - b.eatenAt.getTime();

/**
 * The glucose before the EARLIEST meal on the given date that carries one. A
 * later meal's reading is not a morning reading, however much later it is the
 * only one there.
 */
export const morningReading = (
  mornings: readonly MorningMeal[],
  date: IsoDate,
): number | null => {
  const onDate = mornings
    .filter((meal) => meal.eatenOn === date && meal.glucoseBefore !== null)
    .sort(byTimeAscending);
  return onDate.length === 0 ? null : (onDate[0] as MorningMeal).glucoseBefore;
};

const newestFirst = (a: NightInsulin, b: NightInsulin): number =>
  a.nightOn < b.nightOn ? 1 : a.nightOn > b.nightOn ? -1 : 0;

/**
 * The nights as the screen lists them, newest first. The list reports what
 * happened and draws no conclusion from it: there is no average here, no trend
 * and no suggested dose.
 */
export const nightRows = (window: NightWindow): readonly NightRow[] =>
  [...window.nights].sort(newestFirst).map((night): NightRow => {
    const morning = morningReading(window.mornings, shiftDate(night.nightOn, 1));
    return {
      nightOn: night.nightOn,
      date: shortNightDate(night.nightOn),
      dose: doseText(night.units) ?? '',
      morning:
        morning === null
          ? null
          : { text: String(Math.round(morning)), band: levelBand(morning) },
    };
  });
