import { dayLogEntries, type DayLog, type DayLogEntry } from '../domain/entry';

// The reading surface: the signed-in account's own entries for one date, one
// plain line each. No cards and no slot grouping yet; value 2 reshapes these
// same rows.

export const EMPTY_DAY_LOG = 'No entries yet.';

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
 * One line, split exactly where ownership is. The recorded part carries
 * data-entry, because it is on the page only because this account wrote it
 * down; the slot label does not, because it reads the same for every account.
 * Marking the parts rather than the whole line keeps the mark honest when a
 * later value reshapes these lines into fixed cards.
 */
const lineItem = (entry: DayLogEntry): HTMLElement => {
  const item = document.createElement('li');
  item.className = 'day-log__line';

  if (entry.furniture !== null) {
    const furniture = document.createElement('span');
    furniture.className = 'day-log__slot';
    furniture.textContent = `${entry.furniture} · `;
    item.append(furniture);
  }

  const recorded = document.createElement('span');
  recorded.className = 'day-log__recorded';
  recorded.setAttribute('data-entry', '');
  recorded.textContent = entry.recorded;
  item.append(recorded);

  return item;
};

const lineList = (entries: readonly DayLogEntry[]): HTMLElement => {
  const list = document.createElement('ul');
  list.className = 'day-log__lines';
  for (const entry of entries) list.append(lineItem(entry));
  return list;
};

export const dayLogSection = (state: DayLogState, handlers: DayLogHandlers): HTMLElement => {
  const section = document.createElement('section');
  section.className = 'day-log';
  section.setAttribute('aria-label', 'Day log');
  section.setAttribute('aria-busy', String(state.kind === 'loading'));

  if (state.kind === 'loading') {
    // Deliberately no empty message while the read is in flight: 'No entries
    // yet.' is a statement about what the account owns, not about progress.
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

  // 'No entries yet.' is furniture: it is the same sentence for every account and
  // carries nobody's data, so it is not marked as an entry.
  const entries = dayLogEntries(state.log);
  section.append(
    entries.length === 0 ? paragraph('day-log__empty', EMPTY_DAY_LOG) : lineList(entries),
  );
  return section;
};
