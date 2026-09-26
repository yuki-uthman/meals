import { dayLogLines, type DayLog } from '../domain/entry';

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

const lineList = (lines: readonly string[]): HTMLElement => {
  const list = document.createElement('ul');
  list.className = 'day-log__lines';
  for (const line of lines) {
    const item = document.createElement('li');
    item.className = 'day-log__line';
    // The line is the whole text of the element, so it reads as one line.
    item.textContent = line;
    list.append(item);
  }
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

  const lines = dayLogLines(state.log);
  section.append(lines.length === 0 ? paragraph('day-log__empty', EMPTY_DAY_LOG) : lineList(lines));
  return section;
};
