import type { SupabaseClient, User } from '@supabase/supabase-js';
import {
  REFUSED_CREDENTIALS,
  UNREACHABLE_SERVER,
  type Account,
  type Credentials,
  type Identity,
  type SignInOutcome,
} from '../../ports/identity';

// Supabase Auth behind the identity port, with its errors mapped onto the named
// failure outcomes.

const toAccount = (user: User): Account => ({ id: user.id, email: user.email ?? '' });

/**
 * A rejected credential pair is a refusal; a transport that never got an answer
 * is a retry. Supabase marks the latter as retryable and gives it no HTTP
 * status, so anything without a status is treated as unreached rather than
 * reported to the person as a wrong password.
 */
const isUnreachable = (error: { status?: number; name?: string }): boolean =>
  error.status === undefined || error.name === 'AuthRetryableFetchError';

export const supabaseIdentity = (client: SupabaseClient): Identity => ({
  currentAccount: async () => {
    const { data, error } = await client.auth.getSession();
    if (error !== null || data.session === null) return null;
    return toAccount(data.session.user);
  },

  signIn: async ({ email, password }: Credentials): Promise<SignInOutcome> => {
    const { data, error } = await client.auth.signInWithPassword({ email, password });
    if (error !== null) {
      return isUnreachable(error)
        ? { kind: 'retry', message: UNREACHABLE_SERVER }
        : { kind: 'refused', message: REFUSED_CREDENTIALS };
    }
    if (data.session === null) {
      return { kind: 'refused', message: REFUSED_CREDENTIALS };
    }
    return { kind: 'signed-in', account: toAccount(data.session.user) };
  },

  signOut: async () => {
    await client.auth.signOut();
  },

  onChange: (listener) => {
    const { data } = client.auth.onAuthStateChange((_event, session) => {
      listener(session === null ? null : toAccount(session.user));
    });
    return () => data.subscription.unsubscribe();
  },
});
