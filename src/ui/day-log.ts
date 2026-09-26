import {
  dayCards,
  NOT_LOGGED_YET,
  type DayCard,
  type DayLog,
  type MealCard,
  type NightCard,
} from '../domain/entry';

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

const mealCardItem = (card: MealCard): HTMLElement => {
  const item = cardItem('card--meal');
  item.append(cardHead(card.label, recorded('p', 'card__time', card.time)));
  if (card.foods !== null) item.append(recorded('p', 'card__foods', card.foods));
  if (card.dose !== null) item.append(recorded('p', 'card__dose', card.dose));
  const row = readings(card);
  if (row !== null) item.append(row);
  return item;
};

const nightCardItem = (card: NightCard): HTMLElement => {
  const item = cardItem('card--night');
  item.append(cardHead(card.label, null));
  if (card.doses.length === 0) {
    item.append(placeholder());
    return item;
  }
  for (const dose of card.doses) item.append(recorded('p', 'card__dose', dose));
  return item;
};

const cardElement = (card: DayCard): HTMLElement => {
  if (card.kind === 'meal') return mealCardItem(card);
  if (card.kind === 'night') return nightCardItem(card);

  const item = cardItem('card--empty');
  item.append(cardHead(card.label, null), placeholder());
  return item;
};

const cardList = (cards: readonly DayCard[]): HTMLElement => {
  const list = document.createElement('ul');
  list.className = 'day-log__cards';
  for (const card of cards) list.append(cardElement(card));
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
  section.append(cardList(dayCards(state.log)));
  return section;
};
