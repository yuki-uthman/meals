import type { DayLog, IsoDate } from '../domain/entry';

// Reading the signed-in account's own entries for one date.
//
// The port takes no account identifier, because ownership is not a parameter of
// the read: the store reads as whoever is signed in, and Postgres decides which
// rows that is. A port that accepted a user id would invite a caller to ask for
// somebody else's rows.

export type DayLogOutcome =
  | { readonly kind: 'loaded'; readonly log: DayLog }
  /** The server could not be reached. Show no entries rather than stale ones. */
  | { readonly kind: 'retry'; readonly message: string }
  /** The session is gone, so the read had no owner to run as. */
  | { readonly kind: 'session-ended'; readonly message: string };

export type LogStore = {
  dayLog: (date: IsoDate) => Promise<DayLogOutcome>;
};
