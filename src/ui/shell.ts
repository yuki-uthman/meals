import type { IsoDate } from '../domain/entry';

// The signed-in frame: a header, the sign-out control, and the slot the day log
// renders into.

export type ShellState = {
  readonly date: IsoDate;
};

export type ShellHandlers = {
  readonly onSignOut: () => void;
};

/**
 * 'Saturday 26 September'. The heading names the date being read and nothing
 * else; no account data of any kind reaches the frame.
 */
export const dateHeading = (date: IsoDate): string => {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  const at = new Date(year, month - 1, day);
  return at.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
};

export const shell = (
  state: ShellState,
  handlers: ShellHandlers,
  content: HTMLElement,
): HTMLElement => {
  const frame = document.createElement('div');
  frame.className = 'shell';

  const header = document.createElement('header');
  header.className = 'shell__header';

  const title = document.createElement('h1');
  title.className = 'shell__title';
  title.textContent = dateHeading(state.date);

  const signOut = document.createElement('button');
  signOut.className = 'button button--quiet';
  signOut.type = 'button';
  signOut.textContent = 'Sign out';
  signOut.addEventListener('click', () => handlers.onSignOut());

  header.append(title, signOut);

  const main = document.createElement('main');
  main.className = 'shell__main';
  main.append(content);

  frame.append(header, main);
  return frame;
};
