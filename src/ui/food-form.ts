import {
  AMOUNT_UNITS,
  FOOD_TYPES,
  foodTypeLabel,
  type AmountUnit,
  type FoodType,
} from '../domain/entry';
import {
  catalogueFoodLabel,
  createFoodLabel,
  exactlyNamedFood,
  matchingFoods,
  type CatalogueFood,
} from '../domain/food-catalogue';
import type { FoodDraft } from '../domain/meal-draft';
import { choiceGroup, formScreen, notice, numberField, textField } from './meal-form';

// The Add food screen: a name, an amount and one of the brief's five units -- and,
// beneath the name, the person's own foods that match what they are typing. It
// shares the meal screen's field builders, so a number here behaves exactly as a
// number there, and it shares the frame's Save control, so there is one way to hand
// the food back.
//
// The type is NOT always asked for, because a food's type is a property of the
// food: choosing a food answers it, and only creating a new one asks it.

export const FOOD_FORM_TITLE = 'Add food';

/**
 * What the name field currently is. `typed` is a name still being worked out;
 * `chosen` is one of the account's own foods, which brings its type; `creating` is a
 * name the person has asked to make a food of, which is the one state that asks for
 * a type. Nothing moves to `creating` on its own: a name one letter off an existing
 * food must never quietly become a second entry.
 */
export type NameState =
  | { readonly kind: 'typed' }
  | { readonly kind: 'chosen'; readonly food: CatalogueFood }
  | { readonly kind: 'creating' };

export type FoodFormState = {
  readonly draft: FoodDraft;
  readonly message: string | null;
  /** The account's own foods, as read through the port. Never another's. */
  readonly catalogue: readonly CatalogueFood[];
  readonly name: NameState;
};

export type FoodFormHandlers = {
  readonly onName: (name: string) => void;
  readonly onFoodType: (type: FoodType) => void;
  readonly onAmount: (amount: string) => void;
  readonly onUnit: (unit: AmountUnit) => void;
  /** One of the person's own foods, which fills the name and brings the type. */
  readonly onChoose: (food: CatalogueFood) => void;
  /** Asks for the typed name to become a food. Only this reveals the type chooser. */
  readonly onCreate: () => void;
};

const chooseButton = (food: CatalogueFood, onChoose: () => void): HTMLElement => {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'catalogue__food';
  // The food AND its type: the type is what choosing brings with it, so it is
  // published here rather than being a surprise once the chooser disappears.
  button.textContent = catalogueFoodLabel(food);
  button.addEventListener('click', onChoose);
  return button;
};

const createButton = (typed: string, onCreate: () => void): HTMLElement => {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'catalogue__create';
  button.textContent = createFoodLabel(typed);
  button.addEventListener('click', onCreate);
  return button;
};

/**
 * What the name field is offering: the account's own matching foods, and -- when the
 * typed name is not one of them character for character -- the offer to create it.
 *
 * This subtree is redrawn on its own as the person types, deliberately NOT by
 * rebuilding the screen: a redraw on every keystroke would replace the very input
 * being typed into and take the caret with it.
 */
const offers = (state: FoodFormState, handlers: FoodFormHandlers, typed: string): HTMLElement => {
  const list = document.createElement('div');
  list.className = 'catalogue';

  // Once a food is being created the question is settled, so neither offer is made
  // again: what is left to answer is its type, below.
  if (state.name.kind === 'creating') return list;

  for (const food of matchingFoods(state.catalogue, typed)) {
    list.append(chooseButton(food, () => handlers.onChoose(food)));
  }

  if (typed.trim() !== '' && exactlyNamedFood(state.catalogue, typed) === null) {
    list.append(createButton(typed, handlers.onCreate));
  }

  return list;
};

/** The type a chosen food already has, stated rather than asked for again. */
const chosenType = (food: CatalogueFood): HTMLElement => {
  const line = document.createElement('p');
  line.className = 'catalogue__type';
  line.textContent = `Type: ${foodTypeLabel(food.foodType)}`;
  return line;
};

export const foodForm = (state: FoodFormState, handlers: FoodFormHandlers): HTMLElement => {
  const screen = formScreen('form--food');
  const { draft } = state;

  if (state.message !== null) screen.append(notice(state.message));

  // What the person has typed so far, held here so the offers below the field can be
  // redrawn from it without the field itself being rebuilt.
  let typed = draft.name;
  let offered = offers(state, handlers, typed);

  const name = textField('food-name', 'Food name', draft.name, (value) => {
    typed = value;
    handlers.onName(value);
    const next = offers(state, handlers, typed);
    offered.replaceWith(next);
    offered = next;
  });

  screen.append(name, offered);

  // The type is a property of the food. A chosen food has already answered it, so it
  // is stated and not asked; a food being created has not, so the chooser appears --
  // with nothing preselected, because a default would put a classification the
  // person never chose onto the row.
  if (state.name.kind === 'chosen') {
    screen.append(chosenType(state.name.food));
  } else if (state.name.kind === 'creating') {
    screen.append(
      choiceGroup<FoodType>(
        'food-type',
        'Type',
        FOOD_TYPES.map((type) => ({ value: type, label: foodTypeLabel(type) })),
        draft.foodType,
        handlers.onFoodType,
      ),
    );
  }

  screen.append(
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
