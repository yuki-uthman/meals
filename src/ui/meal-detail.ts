import { changeBand } from '../domain/band';
import {
  changeText,
  doseText,
  foodTypeLabel,
  glucoseChange,
  slotLabel,
  type FoodPortion,
  type Meal,
} from '../domain/entry';
import {
  eatenAtText,
  instancesHeading,
  VIEWING_MARK,
  type InstanceRow,
} from '../domain/meal-identity';

// The meal detail: what was eaten, and every instance of the same foods.
//
// Two regions, deliberately siblings rather than one inside the other: the meal
// in hand is one statement and its history is another, and a screen reader gets
// to move between them. Nothing here recommends anything -- the list reports what
// each dose was followed by and draws no conclusion of any kind.

export type MealDetailView = {
  readonly meal: Meal;
  /** Every instance of these foods, newest first, the viewed one among them. */
  readonly instances: readonly InstanceRow[];
  /** Present when the history could not be read. Shown instead of an empty list. */
  readonly message: string | null;
};

export type MealDetailHandlers = {
  readonly onBack: () => void;
};

export const BACK_LABEL = 'Back to the day';

const element = (tag: string, className: string, text?: string): HTMLElement => {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

/** A part of the screen that exists only because this account recorded it. */
const recorded = (tag: string, className: string, text: string): HTMLElement => {
  const node = element(tag, className, text);
  node.setAttribute('data-entry', '');
  return node;
};

const amountText = (value: number): string =>
  Number.isInteger(value) ? String(value) : String(Number(value.toFixed(2)));

/** The change, published with its band by name so a colour is never the message. */
const changeSpan = (change: number): HTMLElement => {
  const span = element('span', 'detail__change', changeText(change));
  span.setAttribute('data-change-band', changeBand(change));
  return span;
};

const arrow = (): HTMLElement => {
  const span = element('span', 'detail__arrow', '→');
  span.setAttribute('aria-hidden', 'true');
  return span;
};

/**
 * The summary: the before, the change and the after, and the dose. Nothing else
 * numeric, and in particular no 'after 2 h' claim -- the record holds no interval
 * between the two readings, so naming one would be an invention.
 */
const summary = (meal: Meal): HTMLElement => {
  const row = element('p', 'detail__readings');
  if (meal.glucoseBefore !== null) {
    row.append(recorded('span', 'detail__reading', amountText(meal.glucoseBefore)));
  }
  if (meal.glucoseBefore !== null && meal.glucoseAfter !== null) row.append(arrow());
  if (meal.glucoseAfter !== null) {
    row.append(recorded('span', 'detail__reading', amountText(meal.glucoseAfter)));
  }
  const change = glucoseChange(meal);
  if (change !== null) row.append(changeSpan(change));
  return row;
};

const foodItem = (food: FoodPortion): HTMLElement => {
  const item = element('li', 'detail__food');
  item.append(recorded('span', 'detail__food-name', food.name));
  if (food.foodType !== null) {
    item.append(recorded('span', 'detail__food-type', foodTypeLabel(food.foodType)));
  }
  if (food.amount !== null) {
    const measure =
      food.unit === null ? amountText(food.amount) : `${amountText(food.amount)} ${food.unit}`;
    item.append(recorded('span', 'detail__food-amount', measure));
  }
  return item;
};

const foodList = (foods: readonly FoodPortion[]): HTMLElement => {
  const list = element('ul', 'detail__foods');
  for (const food of foods) list.append(foodItem(food));
  return list;
};

const detailRegion = (meal: Meal): HTMLElement => {
  const section = document.createElement('section');
  section.className = 'detail';
  section.setAttribute('aria-label', 'Meal detail');

  const head = element('div', 'detail__head');
  head.append(element('p', 'detail__slot', slotLabel(meal.slot)));
  head.append(recorded('p', 'detail__when', eatenAtText(meal.eatenAt)));
  section.append(head);

  section.append(summary(meal));

  const dose = doseText(meal.insulinUnits);
  if (dose !== null) section.append(recorded('p', 'detail__dose', dose));

  if (meal.foods.length > 0) section.append(foodList(meal.foods));

  // The note section appears only when there is a note: an empty one would say
  // something false about a meal nobody annotated.
  if (meal.note !== null) section.append(recorded('p', 'detail__note', meal.note));

  return section;
};

const instanceItem = (row: InstanceRow): HTMLElement => {
  const item = element('li', row.viewing ? 'instance instance--viewing' : 'instance');

  // The day is the account's own record; the slot label is furniture that reads
  // the same for every account, so only the first of the two is marked.
  item.append(recorded('span', 'instance__date', row.date));
  item.append(element('span', 'instance__slot', row.slot));
  if (row.dose !== null) item.append(recorded('span', 'instance__dose', row.dose));
  if (row.before !== null) item.append(recorded('span', 'instance__reading', row.before));
  if (row.before !== null && row.after !== null) item.append(arrow());
  if (row.after !== null) item.append(recorded('span', 'instance__reading', row.after));
  if (row.change !== null) {
    const change = element('span', 'instance__change', row.change.text);
    change.setAttribute('data-change-band', row.change.band);
    item.append(change);
  }
  // The mark is a word, so it is readable without colour, and exactly one row
  // ever carries it.
  if (row.viewing) item.append(element('span', 'instance__mark', VIEWING_MARK));

  return item;
};

/** One detail screen exists at a time, so this id can only ever name one heading. */
const INSTANCES_HEADING_ID = 'instances-heading';

const instancesRegion = (view: MealDetailView): HTMLElement => {
  const section = document.createElement('section');
  section.className = 'instances';

  const heading = document.createElement('h2');
  heading.className = 'instances__heading';
  heading.id = INSTANCES_HEADING_ID;
  heading.textContent = instancesHeading(view.instances.length);
  // The region is named by its own heading, so the count is said once.
  section.setAttribute('aria-labelledby', heading.id);
  section.append(heading);

  if (view.message !== null) {
    const notice = element('p', 'notice', view.message);
    notice.setAttribute('role', 'alert');
    section.append(notice);
    return section;
  }

  const list = element('ul', 'instances__rows');
  for (const row of view.instances) list.append(instanceItem(row));
  section.append(list);

  return section;
};

export const mealDetailScreen = (
  view: MealDetailView,
  handlers: MealDetailHandlers,
): HTMLElement => {
  const screen = element('div', 'detail-screen');

  const back = document.createElement('button');
  back.className = 'button button--quiet';
  back.type = 'button';
  back.textContent = BACK_LABEL;
  back.addEventListener('click', () => handlers.onBack());

  screen.append(back, detailRegion(view.meal), instancesRegion(view));
  return screen;
};
