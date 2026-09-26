// The identity boundary: sign in, sign out, and who is signed in now.
// Nothing here knows Supabase exists.

export type Account = {
  readonly id: string;
  readonly email: string;
};

export type Credentials = {
  readonly email: string;
  readonly password: string;
};

/** The named failure outcomes of a sign-in attempt, as the design declares them. */
export type SignInOutcome =
  | { readonly kind: 'signed-in'; readonly account: Account }
  /** Auth rejected the pair. The screen stays and the password is cleared. */
  | { readonly kind: 'refused'; readonly message: string }
  /** The server could not be reached. The attempt is worth repeating. */
  | { readonly kind: 'retry'; readonly message: string };

export const REFUSED_CREDENTIALS = 'Email or password is not correct';
export const UNREACHABLE_SERVER = 'Cannot reach the server. Try again.';
export const SESSION_ENDED = 'Your session ended. Sign in again.';

export type Identity = {
  /** The account of the persisted session, or null when there is none. */
  currentAccount: () => Promise<Account | null>;
  signIn: (credentials: Credentials) => Promise<SignInOutcome>;
  signOut: () => Promise<void>;
  /**
   * Observes session changes, including a refresh that failed and so ended the
   * session. Returns the function that stops observing.
   */
  onChange: (listener: (account: Account | null) => void) => () => void;
};
