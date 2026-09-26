import {
  EXERCISE_CONTEXTS,
  exerciseContextLabel,
  foodTypeLabel,
  MEAL_SLOTS,
  slotLabel,
  type ExerciseContext,
  type MealSlot,
} from '../domain/entry';
import type { FoodDraft, MealDraft } from '../domain/meal-draft';
import type { ReadingChip } from '../domain/recent-readings';
import { numberPad } from './number-pad';
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

  const { pad } = controls;
  if (pad !== undefined) {
    const open = (): void => {
      if (!pad.isOpen) pad.onOpen();
    };
    // Tapping the field opens the pad, and so does reaching it with a keyboard:
    // arriving at the field is what asks for a way to fill it in.
    input.addEventListener('click', open);
    input.addEventListener('focus', open);
  }

  wrapper.append(
    fieldLabel(id, labelText),
    controls.stepper === true ? doseStepper(input, onInput) : input,
  );

  if (pad !== undefined && pad.isOpen) {
    wrapper.append(
      numberPad(input, pad.chips, { onValue: onInput, onDone: () => pad.onClose() }),
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

export const mealForm = (state: MealFormState, handlers: MealFormHandlers): HTMLElement => {
  const screen = formScreen('form--meal');
  const { draft } = state;
  const chips = state.chips ?? NO_PAD_CHIPS;
  const padTarget = state.padTarget ?? null;
  const openPad = (target: Exclude<MealPadTarget, null>): void => handlers.onOpenPad?.(target);
  const closePad = (): void => handlers.onClosePad?.();

  if (state.message !== null) screen.append(notice(state.message));

  screen.append(
    choiceGroup<MealSlot>(
      'meal-slot',
      'Slot',
      MEAL_SLOTS.map((slot) => ({ value: slot, label: slotLabel(slot) })),
      draft.slot,
      handlers.onSlot,
    ),
    timeField('meal-time', draft.time, handlers.onTime),
    numberField(
      'meal-glucose-before',
      'Glucose before',
      'glucose',
      draft.glucoseBefore,
      handlers.onGlucoseBefore,
      {
        pad: {
          chips: chips.before,
          isOpen: padTarget === 'glucose-before',
          onOpen: () => openPad('glucose-before'),
          onClose: () => closePad(),
        },
      },
    ),
    foodList(state, handlers),
    numberField(
      'meal-insulin-units',
      'Rapid-acting units',
      'dose',
      draft.insulinUnits,
      handlers.onInsulinUnits,
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
    // The after reading is optional and often arrives later: a person has only
    // just eaten when they record the meal. It sits last for that reason.
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
  );

  return screen;
};
