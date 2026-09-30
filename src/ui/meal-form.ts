import {
  EXERCISE_CONTEXTS,
  exerciseContextLabel,
  foodTypeLabel,
  localToday,
  MEAL_SLOTS,
  slotLabel,
  type ExerciseContext,
  type IsoDate,
  type MealSlot,
} from '../domain/entry';
import {
  EXPECTED_AFTER_LABEL,
  expectedAfterView,
  type ExpectedAfterView,
} from '../domain/expected-after';
import { repeatSourceText, type FoodDraft, type MealDraft } from '../domain/meal-draft';
import type { MealInstance } from '../domain/meal-identity';
import type { ReadingChip } from '../domain/recent-readings';
import { attachNumberPad, forgetOpenPad } from './number-pad';
import { doseStepper } from './stepper';

// The New meal and Edit meal screen, as a pure function from a draft to a DOM
// subtree. It renders the draft and reports what the person did; it decides
// nothing. Whether a draft may be saved is a rule in src/domain, and the Save
// control itself lives in the frame, so this screen has one job: show the meal.
//
// Every numeric field here is a real labelled input that works with the device
// keyboard. Value 5 adds the in-app number pad and the dose stepper as controls
// that write into these same inputs, so a field keeps one accessible name and one
// value for the whole delivery.

// ------------------------------------------------- fields, shared by both forms

export type NumericKind = 'glucose' | 'dose' | 'amount';

const NUMERIC_STEPS: Readonly<Record<NumericKind, string>> = {
  // Glucose is whole numbers in mg/dL; a dose and an amount may be fractional.
  glucose: '1',
  dose: '0.5',
  amount: '0.1',
};

const fieldWrapper = (): HTMLElement => {
  const wrapper = document.createElement('div');
  wrapper.className = 'field';
  return wrapper;
};

const fieldLabel = (id: string, text: string): HTMLElement => {
  const label = document.createElement('label');
  label.className = 'field__label';
  label.htmlFor = id;
  label.textContent = text;
  return label;
};

/** A labelled single-line input: the label is the field's accessible name. */
export const textField = (
  id: string,
  labelText: string,
  value: string,
  onInput: (value: string) => void,
): HTMLElement => {
  const wrapper = fieldWrapper();

  const input = document.createElement('input');
  input.className = 'field__input';
  input.id = id;
  input.name = id;
  input.type = 'text';
  input.value = value;
  input.addEventListener('input', () => onInput(input.value));

  wrapper.append(fieldLabel(id, labelText), input);
  return wrapper;
};

/**
 * The in-app pad attached to a glucose field: the chips it offers, whether it is
 * currently open on this field, and how it opens and closes. A field with no pad
 * keeps the device keyboard, which is what the food amount does.
 */
export type PadControl = {
  readonly chips: readonly ReadingChip[];
  readonly isOpen: boolean;
  readonly onOpen: () => void;
  readonly onClose: () => void;
};

export type NumberFieldControls = {
  readonly pad?: PadControl;
  /** A minus and a plus that move this dose by exactly one unit. */
  readonly stepper?: boolean;
};

/**
 * A labelled number input. With no controls the keyboard that opens is the
 * device's own.
 *
 * Where a pad or a stepper is asked for, it is added *around* this same input:
 * the field keeps its id, its label, its value and its editability, so the
 * accessible name a person and an oracle both find it by never moves, and every
 * screen built on this field goes on working untouched.
 */
export const numberField = (
  id: string,
  labelText: string,
  kind: NumericKind,
  value: string,
  onInput: (value: string) => void,
  controls: NumberFieldControls = {},
): HTMLElement => {
  const wrapper = fieldWrapper();

  const input = document.createElement('input');
  input.className = 'field__input';
  input.id = id;
  input.name = id;
  input.type = 'number';
  input.min = '0';
  input.step = NUMERIC_STEPS[kind];
  // A field with the in-app pad asks the phone for no keyboard at all, so the
  // pad has the screen to itself. It stays an ordinary focusable input, so a
  // hardware keyboard and an automated fill both still reach it.
  input.inputMode = controls.pad === undefined ? (kind === 'glucose' ? 'numeric' : 'decimal') : 'none';
  input.value = value;
  input.addEventListener('input', () => onInput(input.value));

  wrapper.append(
    fieldLabel(id, labelText),
    controls.stepper === true ? doseStepper(input, onInput) : input,
  );

  const { pad } = controls;
  if (pad !== undefined) {
    // The pad is mounted and unmounted beside this input rather than by redrawing
    // the screen. Opening it must not replace, reset or detach the field: a
    // re-render on focus would eat a hardware-keyboard user's first keystroke.
    attachNumberPad(
      wrapper,
      input,
      pad.chips,
      { onValue: onInput, onOpened: () => pad.onOpen(), onClosed: () => pad.onClose() },
      pad.isOpen,
    );
  }

  return wrapper;
};

const timeField = (id: string, value: string, onInput: (value: string) => void): HTMLElement => {
  const wrapper = fieldWrapper();

  const input = document.createElement('input');
  input.className = 'field__input';
  input.id = id;
  input.name = id;
  input.type = 'time';
  input.value = value;
  input.addEventListener('input', () => onInput(input.value));

  wrapper.append(fieldLabel(id, 'Time'), input);
  return wrapper;
};

const noteField = (id: string, value: string, onInput: (value: string) => void): HTMLElement => {
  const wrapper = fieldWrapper();

  const input = document.createElement('textarea');
  input.className = 'field__input field__input--note';
  input.id = id;
  input.name = id;
  input.rows = 2;
  input.value = value;
  input.addEventListener('input', () => onInput(input.value));

  wrapper.append(fieldLabel(id, 'Note'), input);
  return wrapper;
};

export type ChoiceOption<T extends string> = {
  readonly value: T;
  readonly label: string;
};

/**
 * One choice out of a fixed list, as a segmented group of radios. A radio group is
 * the honest widget for a closed vocabulary: the options are all readable at once,
 * each carries its own accessible name, and nothing can be chosen that the brief
 * does not fix.
 */
export const choiceGroup = <T extends string>(
  name: string,
  legendText: string,
  options: readonly ChoiceOption<T>[],
  selected: T | null,
  onPick: (value: T) => void,
): HTMLElement => {
  const group = document.createElement('fieldset');
  group.className = 'segmented';

  const legend = document.createElement('legend');
  legend.className = 'segmented__legend';
  legend.textContent = legendText;
  group.append(legend);

  for (const option of options) {
    const label = document.createElement('label');
    label.className = 'segmented__option';

    const input = document.createElement('input');
    input.className = 'segmented__radio';
    input.type = 'radio';
    input.name = name;
    input.value = option.value;
    input.checked = option.value === selected;
    input.addEventListener('change', () => {
      if (input.checked) onPick(option.value);
    });

    const text = document.createElement('span');
    text.className = 'segmented__text';
    text.textContent = option.label;

    label.append(input, text);
    group.append(label);
  }

  return group;
};

export const notice = (message: string): HTMLElement => {
  const element = document.createElement('p');
  element.className = 'notice';
  element.setAttribute('role', 'alert');
  element.textContent = message;
  return element;
};

export const formScreen = (className: string): HTMLElement => {
  // A fresh form screen has no pad open yet, and any pad from the screen it
  // replaces went with that screen's DOM.
  forgetOpenPad();
  const screen = document.createElement('div');
  screen.className = `form ${className}`;
  return screen;
};

// ------------------------------------------------------------- the meal screen

/** Which glucose field the in-app pad is currently open on, if any. */
export type MealPadTarget = 'glucose-before' | 'glucose-after' | null;

/**
 * The chips each glucose field's pad offers. They differ on purpose: the before
 * field is offered what this person tends to sit at going into this slot, while
 * the after field has no such thing and is offered only the last reading.
 */
export type MealPadChips = {
  readonly before: readonly ReadingChip[];
  readonly after: readonly ReadingChip[];
};

export const NO_PAD_CHIPS: MealPadChips = { before: [], after: [] };

export type MealFormState = {
  readonly draft: MealDraft;
  /** Closed unless a glucose field was tapped. */
  readonly padTarget?: MealPadTarget;
  /** Absent where nothing was recorded to put on a chip. */
  readonly chips?: MealPadChips;
  /**
   * Every meal this account has recorded, which is the material the expected-after
   * estimate is read off. Absent reads as no history at all, and the panel then
   * says there is no occasion on record rather than showing a number.
   */
  readonly history?: readonly MealInstance[];
  /**
   * Present when the history could not be read. The panel says so instead of a
   * reason of its own: 'no occasion on record' would be a claim about the person's
   * meals, and a read that failed says nothing whatever about them.
   */
  readonly historyMessage?: string | null;
  /** A refusal or retry message, shown in place with every value still filled in. */
  readonly message: string | null;
};

export type MealFormHandlers = {
  readonly onOpenPad?: (target: Exclude<MealPadTarget, null>) => void;
  readonly onClosePad?: () => void;
  readonly onSlot: (slot: MealSlot) => void;
  readonly onTime: (time: string) => void;
  readonly onGlucoseBefore: (value: string) => void;
  readonly onGlucoseAfter: (value: string) => void;
  readonly onInsulinUnits: (value: string) => void;
  readonly onExerciseContext: (context: ExerciseContext) => void;
  readonly onNote: (value: string) => void;
  readonly onAddFood: () => void;
  readonly onRemoveFood: (index: number) => void;
};

/** 'Edit meal' when a recorded meal was reopened, 'New meal' otherwise. */
export const mealFormTitle = (draft: MealDraft): string =>
  draft.mealId === null ? 'New meal' : 'Edit meal';

/**
 * The date this meal is being recorded against, said in full, and only when it is
 * not today: a meal backfilled from a History cell must never be mistakable for
 * today's. On today it is left unsaid, because saying it would be noise on the form
 * a person fills in several times a day.
 */
const recordingDateText = (date: IsoDate): string | null => {
  if (date === localToday()) return null;
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  const at = new Date(year, month - 1, day);
  return `Recording against ${at.toLocaleDateString(undefined, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  })}`;
};

const foodMeasure = (food: FoodDraft): string =>
  food.amount.trim() === '' ? '' : ` · ${food.amount.trim()} ${food.unit}`;

/**
 * One food as the meal screen reads it back: its name, its type and its amount.
 * The type is shown because it is part of the recording, so reopening a meal
 * cannot quietly lose what a food was classified as.
 */
const foodRow = (
  food: FoodDraft,
  index: number,
  onRemove: (index: number) => void,
): HTMLElement => {
  const row = document.createElement('li');
  row.className = 'food-list__row';

  const text = document.createElement('span');
  text.className = 'food-list__text';
  const type = food.foodType === null ? '' : ` · ${foodTypeLabel(food.foodType)}`;
  text.textContent = `${food.name}${type}${foodMeasure(food)}`;

  const remove = document.createElement('button');
  remove.className = 'button button--quiet';
  remove.type = 'button';
  remove.setAttribute('aria-label', `Remove ${food.name}`);
  remove.textContent = 'Remove';
  remove.addEventListener('click', () => onRemove(index));

  row.append(text, remove);
  return row;
};

const foodList = (state: MealFormState, handlers: MealFormHandlers): HTMLElement => {
  const section = document.createElement('div');
  section.className = 'food-list';

  const heading = document.createElement('h2');
  heading.className = 'form__heading';
  heading.textContent = 'Foods';
  section.append(heading);

  if (state.draft.foods.length > 0) {
    const list = document.createElement('ul');
    list.className = 'food-list__rows';
    state.draft.foods.forEach((food, index) => {
      list.append(foodRow(food, index, handlers.onRemoveFood));
    });
    section.append(list);
  }

  const add = document.createElement('button');
  add.className = 'button button--quiet';
  add.type = 'button';
  add.textContent = 'Add food';
  add.addEventListener('click', () => handlers.onAddFood());
  section.append(add);

  return section;
};

/**
 * The panel's contents for one view: either the number with the band of the change
 * it was built from and the occasion it came from, or the reason there is none.
 *
 * The estimate is never written into the after reading field: the person records
 * what they measured, not what was expected.
 */
const expectedAfterBody = (view: ExpectedAfterView): readonly HTMLElement[] => {
  const label = document.createElement('p');
  label.className = 'expected-after__label';
  label.textContent = EXPECTED_AFTER_LABEL;

  if (view.kind === 'reason') {
    const reason = document.createElement('p');
    reason.className = 'expected-after__reason';
    reason.textContent = view.message;
    return [label, reason];
  }

  const line = document.createElement('p');
  line.className = 'expected-after__line';
  const value = document.createElement('span');
  value.className = 'expected-after__value';
  value.textContent = view.reading;
  // Derived rather than recorded, so it carries its band by name and no data-entry
  // mark: the stylesheet binds the colour to the band exactly as everywhere else.
  value.setAttribute('data-change-band', view.band);
  line.append(value);

  const source = document.createElement('p');
  source.className = 'expected-after__source';
  source.textContent = view.source;

  return [label, line, source];
};

export const mealForm = (state: MealFormState, handlers: MealFormHandlers): HTMLElement => {
  const screen = formScreen('form--meal');
  const { draft } = state;
  const chips = state.chips ?? NO_PAD_CHIPS;
  const padTarget = state.padTarget ?? null;
  const openPad = (target: Exclude<MealPadTarget, null>): void => handlers.onOpenPad?.(target);
  const closePad = (): void => handlers.onClosePad?.();

  // The panel is live: the slot, the before reading and the dose all change what it
  // says, and none of them redraws the form. So this screen keeps its own copy of
  // the draft as it is edited and repaints just the panel, which leaves every input
  // -- and the caret in it -- exactly where it was.
  let live = state.draft;
  const history = state.history ?? [];
  const panel = document.createElement('section');
  panel.className = 'expected-after';
  panel.setAttribute('aria-label', EXPECTED_AFTER_LABEL);
  const historyMessage = state.historyMessage ?? null;
  const paintPanel = (): void => {
    panel.replaceChildren(
      ...expectedAfterBody(
        historyMessage === null
          ? expectedAfterView(live, history)
          : { kind: 'reason', message: historyMessage },
      ),
    );
  };
  paintPanel();

  /** Records the change the same way the form always has, then repaints the panel. */
  const andRepaint = <T>(change: (value: T) => Partial<MealDraft>, report: (value: T) => void) => (
    value: T,
  ): void => {
    live = { ...live, ...change(value) };
    report(value);
    paintPanel();
  };

  const onSlot = andRepaint<MealSlot>((slot) => ({ slot }), handlers.onSlot);
  const onGlucoseBefore = andRepaint<string>(
    (glucoseBefore) => ({ glucoseBefore }),
    handlers.onGlucoseBefore,
  );
  const onInsulinUnits = andRepaint<string>(
    (insulinUnits) => ({ insulinUnits }),
    handlers.onInsulinUnits,
  );

  // A panel needs foods to identify the meal by, and it belongs on ANY entry that
  // has them: the rule does not depend on how the foods got into the draft, so
  // somebody who typed them by hand is told the same thing as somebody who
  // repeated a meal.
  const hasFoods = draft.foods.some((food) => food.name.trim() !== '');

  if (state.message !== null) screen.append(notice(state.message));

  // A repeat names the meal it took its foods from, so a person cannot lose track
  // of what they are logging again. It is a statement about this form, not a
  // recorded value, so it carries no data-entry mark.
  // The date being recorded, whenever it is not today. It is a statement about
  // this form rather than a recorded value, so it carries no data-entry mark.
  const recordingDate = recordingDateText(draft.date);
  if (recordingDate !== null) {
    const line = document.createElement('p');
    line.className = 'form__recording-date';
    line.textContent = recordingDate;
    screen.append(line);
  }

  const copiedFrom = draft.copiedFrom ?? null;
  if (copiedFrom !== null) {
    const source = document.createElement('p');
    source.className = 'form__source';
    source.textContent = repeatSourceText(copiedFrom);
    screen.append(source);
  }

  screen.append(
    choiceGroup<MealSlot>(
      'meal-slot',
      'Slot',
      MEAL_SLOTS.map((slot) => ({ value: slot, label: slotLabel(slot) })),
      draft.slot,
      onSlot,
    ),
    timeField('meal-time', draft.time, handlers.onTime),
    numberField(
      'meal-glucose-before',
      'Glucose before',
      'glucose',
      draft.glucoseBefore,
      onGlucoseBefore,
      {
        pad: {
          chips: chips.before,
          isOpen: padTarget === 'glucose-before',
          onOpen: () => openPad('glucose-before'),
          onClose: () => closePad(),
        },
      },
    ),
    // The after reading sits directly below the before: the two are read as a
    // pair, and the after is what an edit most often comes back to add. Exercise
    // and the note matter less, so they sit last.
    numberField(
      'meal-glucose-after',
      'Glucose after',
      'glucose',
      draft.glucoseAfter,
      handlers.onGlucoseAfter,
      {
        pad: {
          chips: chips.after,
          isOpen: padTarget === 'glucose-after',
          onOpen: () => openPad('glucose-after'),
          onClose: () => closePad(),
        },
      },
    ),
    // The panel sits beside the after reading, because that is the number it is
    // about -- and it only ever reports beside it, never into it.
    ...(hasFoods ? [panel] : []),
    foodList(state, handlers),
    numberField(
      'meal-insulin-units',
      'Rapid-acting units',
      'dose',
      draft.insulinUnits,
      onInsulinUnits,
      { stepper: true },
    ),
    choiceGroup<ExerciseContext>(
      'meal-exercise',
      'Exercise',
      EXERCISE_CONTEXTS.map((context) => ({
        value: context,
        label: exerciseContextLabel(context),
      })),
      draft.exerciseContext,
      handlers.onExerciseContext,
    ),
    noteField('meal-note', draft.note, handlers.onNote),
  );

  return screen;
};
