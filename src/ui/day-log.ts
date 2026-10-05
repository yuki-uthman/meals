import {
  dayCards,
  editMealLabel,
  logSlotLabel,
  NOT_LOGGED_YET,
  type DayCard,
  type DayLog,
  type EmptySlotCard,
  type MealCard,
  type MealSlot,
  type NightCard,
} from '../domain/entry';
import { openMealLabel } from '../domain/meal-identity';
import { OPEN_NIGHT_LABEL } from '../domain/night';

// The reading surface: the signed-in account's own entries for one date, as the
// Today screen's cards. 'No entries yet.' is retired -- a date with nothing on it
// reads as three fixed slots and a night dose that all say 'Not logged yet',
// which is a truer statement about the day than a sentence about the database.

export type DayLogState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'loaded'; readonly log: DayLog }
  | { readonly kind: 'failed'; readonly message: string };

export type DayLogHandlers = {
  readonly onRetry: () => void;
  /** The empty slot card is the way to log that slot, with the slot already chosen. */
  readonly onLogSlot: (slot: MealSlot) => void;
  /** A logged card's Edit control, which is how the after reading arrives later. */
  readonly onEditMeal: (id: string) => void;
  /** The night card is the way in to the night screen, recorded or not. */
  readonly onOpenNight: () => void;
  /** A logged card's body is the way in to that meal's detail. */
  readonly onOpenMeal: (id: string) => void;
};

const paragraph = (className: string, text: string): HTMLElement => {
  const element = document.createElement('p');
  element.className = className;
  element.textContent = text;
  return element;
};

/**
 * A part of a card that exists only because this account recorded it. Marking
 * the parts rather than the whole card is what keeps ownership falsifiable: the
 * slot label beside it reads the same for every account and carries no mark.
 */
const recorded = (tag: 'p' | 'span', className: string, text: string): HTMLElement => {
  const element = document.createElement(tag);
  element.className = className;
  element.setAttribute('data-entry', '');
  element.textContent = text;
  return element;
};

/** The label line every card opens with, plus whatever sits beside it. */
const cardHead = (label: string, aside: HTMLElement | null): HTMLElement => {
  const head = document.createElement('div');
  head.className = 'card__head';
  head.append(paragraph('card__slot', label));
  if (aside !== null) head.append(aside);
  return head;
};

const placeholder = (): HTMLElement => paragraph('card__placeholder', NOT_LOGGED_YET);

const cardItem = (className: string): HTMLElement => {
  const item = document.createElement('li');
  item.className = `card ${className}`;
  return item;
};

/**
 * The two readings and the change between them. The change publishes its band by
 * name, so the rule under test is an attribute rather than a colour, and the
 * stylesheet is what decides how that band is painted. It carries no data-entry:
 * the account recorded two readings, not the arithmetic between them.
 */
const readings = (card: MealCard): HTMLElement | null => {
  if (card.before === null && card.after === null) return null;

  const row = document.createElement('p');
  row.className = 'card__readings';

  if (card.before !== null) row.append(recorded('span', 'card__reading', card.before));
  if (card.before !== null && card.after !== null) {
    const arrow = document.createElement('span');
    arrow.className = 'card__arrow';
    arrow.setAttribute('aria-hidden', 'true');
    arrow.textContent = '→';
    row.append(arrow);
  }
  if (card.after !== null) row.append(recorded('span', 'card__reading', card.after));

  if (card.change !== null) {
    const change = document.createElement('span');
    change.className = 'card__change';
    change.setAttribute('data-change-band', card.change.band);
    change.textContent = card.change.text;
    row.append(change);
  }

  return row;
};

/**
 * The Edit control, named for its slot: 'Edit dinner'. It carries no data-entry,
 * because 'Edit' reads the same for every account. The name and the place are
 * fixed for the rest of the delivery: value 6 gives the card body its own
 * behaviour, and this control keeps working exactly as it does here.
 */
const editControl = (card: MealCard, onEditMeal: (id: string) => void): HTMLElement => {
  const control = document.createElement('button');
  control.className = 'button button--edit';
  control.type = 'button';
  control.setAttribute('aria-label', editMealLabel(card.slot));
  control.textContent = 'Edit';
  control.addEventListener('click', () => onEditMeal(card.id));
  return control;
};

/**
 * The card's body as the way into the meal's detail. It is a link rather than a
 * button because it goes somewhere, and it holds exactly the elements the body
 * held before -- the same foods, dose and readings, each still carrying its own
 * data-entry mark -- so becoming a way in adds no words to the card and changes
 * nothing about what it reads as. The Edit control stays where it was, in the
 * head, and keeps its own name.
 */
const openLink = (card: MealCard, onOpenMeal: (id: string) => void): HTMLAnchorElement => {
  const link = document.createElement('a');
  link.className = 'card__open';
  // A real destination, so this is a link to assistive technology and to the
  // reader's own habits; the app takes it over rather than reloading.
  link.href = `#meal/${card.id}`;
  link.setAttribute('aria-label', openMealLabel(card.slot));
  link.addEventListener('click', (event) => {
    event.preventDefault();
    onOpenMeal(card.id);
  });
  return link;
};

const mealCardItem = (card: MealCard, handlers: DayLogHandlers): HTMLElement => {
  const item = cardItem('card--meal');
  const head = cardHead(card.label, recorded('p', 'card__time', card.time));
  head.append(editControl(card, handlers.onEditMeal));
  item.append(head);

  const body = openLink(card, handlers.onOpenMeal);
  if (card.foods !== null) body.append(recorded('p', 'card__foods', card.foods));
  if (card.dose !== null) body.append(recorded('p', 'card__dose', card.dose));
  const row = readings(card);
  if (row !== null) body.append(row);
  item.append(body);

  return item;
};

/**
 * The night dose card, which is now the way in to the night screen. The whole
 * card is the control, exactly as an empty slot card is, and the words on it are
 * unchanged: it still reads as 'Night insulin' and either the recorded doses or
 * 'Not logged yet'. Opening the screen is how a night is recorded and also how a
 * recorded one is corrected, because there is one night per date either way.
 */
const nightCardItem = (card: NightCard, handlers: DayLogHandlers): HTMLElement => {
  const item = cardItem('card--night');

  const open = document.createElement('button');
  open.className = 'card__log';
  open.type = 'button';
  open.setAttribute('aria-label', OPEN_NIGHT_LABEL);
  open.append(cardHead(card.label, null));
  if (card.doses.length === 0) {
    open.append(placeholder());
  } else {
    for (const dose of card.doses) open.append(recorded('p', 'card__dose', dose));
  }
  if (card.foods !== null) open.append(recorded('p', 'card__foods', card.foods));
  open.addEventListener('click', () => handlers.onOpenNight());

  item.append(open);
  return item;
};

/**
 * An empty fixed slot, which is now how that slot gets logged. The whole card is
 * the control, and it holds exactly the label and the placeholder it held before:
 * the words on the card are unchanged, so the reading this surface was judged on
 * still reads as 'Breakfast' and 'Not logged yet' and nothing else.
 */
const emptySlotItem = (card: EmptySlotCard, handlers: DayLogHandlers): HTMLElement => {
  const item = cardItem('card--empty');

  const open = document.createElement('button');
  open.className = 'card__log';
  open.type = 'button';
  open.setAttribute('aria-label', logSlotLabel(card.slot));
  open.append(cardHead(card.label, null), placeholder());
  open.addEventListener('click', () => handlers.onLogSlot(card.slot));

  item.append(open);
  return item;
};

const cardElement = (card: DayCard, handlers: DayLogHandlers): HTMLElement => {
  if (card.kind === 'meal') return mealCardItem(card, handlers);
  if (card.kind === 'night') return nightCardItem(card, handlers);
  return emptySlotItem(card, handlers);
};

const cardList = (cards: readonly DayCard[], handlers: DayLogHandlers): HTMLElement => {
  const list = document.createElement('ul');
  list.className = 'day-log__cards';
  for (const card of cards) list.append(cardElement(card, handlers));
  return list;
};

export const dayLogSection = (state: DayLogState, handlers: DayLogHandlers): HTMLElement => {
  const section = document.createElement('section');
  section.className = 'day-log';
  section.setAttribute('aria-label', 'Day log');
  section.setAttribute('aria-busy', String(state.kind === 'loading'));

  if (state.kind === 'loading') {
    // Deliberately no cards while the read is in flight: a grid of empty slots
    // would read as a day with nothing logged rather than as a day not yet read.
    section.append(paragraph('day-log__empty', 'Loading…'));
    return section;
  }

  if (state.kind === 'failed') {
    // Show the failure and no entries at all, rather than stale ones.
    const notice = paragraph('notice', state.message);
    notice.setAttribute('role', 'alert');

    const retry = document.createElement('button');
    retry.className = 'button button--quiet';
    retry.type = 'button';
    retry.textContent = 'Try again';
    retry.addEventListener('click', () => handlers.onRetry());

    section.append(notice, retry);
    return section;
  }

  // The cards are always the same shape: three fixed slots, any snacks, then the
  // night dose. A 'Not logged yet' card is furniture -- the same words for every
  // account -- so it carries nobody's data and is not marked as an entry.
  section.append(cardList(dayCards(state.log), handlers));
  return section;
};
