import {
  AMOUNT_UNITS,
  FOOD_TYPES,
  foodTypeLabel,
  type AmountUnit,
  type FoodType,
} from '../domain/entry';
import type { FoodDraft } from '../domain/meal-draft';
import { choiceGroup, formScreen, notice, numberField, textField } from './meal-form';

// The Add food screen: a name, a type from the brief's seven, an amount and one
// of the brief's five units. It shares the meal screen's field builders, so a
// number here behaves exactly as a number there, and it shares the frame's Save
// control, so there is one way to hand the food back.

export const FOOD_FORM_TITLE = 'Add food';

export type FoodFormState = {
  readonly draft: FoodDraft;
  readonly message: string | null;
};

export type FoodFormHandlers = {
  readonly onName: (name: string) => void;
  readonly onFoodType: (type: FoodType) => void;
  readonly onAmount: (amount: string) => void;
  readonly onUnit: (unit: AmountUnit) => void;
};

export const foodForm = (state: FoodFormState, handlers: FoodFormHandlers): HTMLElement => {
  const screen = formScreen('form--food');
  const { draft } = state;

  if (state.message !== null) screen.append(notice(state.message));

  screen.append(
    textField('food-name', 'Food name', draft.name, handlers.onName),
    // A food must have a type, so nothing is preselected: a default would put a
    // classification the person never chose onto the row.
    choiceGroup<FoodType>(
      'food-type',
      'Type',
      FOOD_TYPES.map((type) => ({ value: type, label: foodTypeLabel(type) })),
      draft.foodType,
      handlers.onFoodType,
    ),
    numberField('food-amount', 'Amount', 'amount', draft.amount, handlers.onAmount),
    choiceGroup<AmountUnit>(
      'food-unit',
      'Unit',
      AMOUNT_UNITS.map((unit) => ({ value: unit, label: unit })),
      draft.unit,
      handlers.onUnit,
    ),
  );

  return screen;
};
