import { createClient } from '@supabase/supabase-js';
import type { LocalStack } from './local-stack';

/**
 * Acceptance support: creates the two test accounts and seeds account A's named
 * rows through the service role, outside the browser. Account B is left empty.
 */

export type Account = {
  readonly email: string;
  readonly password: string;
  readonly id: string;
};

export type SeededAccounts = {
  readonly owner: Account;
  readonly stranger: Account;
  /** The calendar date, in the browser's local terms, the seeded rows belong to. */
  readonly date: Date;
};

const ownerCredentials = { email: 'owner-a@example.test', password: 'correct-horse-A1' } as const;
const strangerCredentials = { email: 'stranger-b@example.test', password: 'correct-horse-B2' } as const;

const adminClient = (stack: LocalStack) =>
  createClient(stack.supabaseUrl, stack.serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

/**
 * Removes every account whose email starts with this prefix, and with it every row
 * those accounts own, because each user table cascades on the owner. This is how a
 * spec isolates itself now that the stack is brought up once per run instead of
 * being reset per spec: it owns an email prefix and nothing else touches it.
 */
export const removeAccounts = async (stack: LocalStack, prefix: string): Promise<void> => {
  const admin = adminClient(stack);
  const { data, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (error) {
    throw new Error(`could not list accounts to clean up '${prefix}': ${error.message}`);
  }
  for (const user of data.users) {
    if ((user.email ?? '').startsWith(prefix)) {
      const removed = await admin.auth.admin.deleteUser(user.id);
      if (removed.error) {
        throw new Error(`could not remove ${user.email}: ${removed.error.message}`);
      }
    }
  }
};

/**
 * Two confirmed accounts under this spec's own email prefix, owning no rows at all.
 * A value whose observation starts from an empty log needs exactly this: accounts
 * that exist and can sign in, with nothing recorded to read.
 */
export const createAccounts = async (
  stack: LocalStack,
  prefix: string,
): Promise<SeededAccounts> => {
  await removeAccounts(stack, prefix);
  const admin = adminClient(stack);

  const createAccount = async (credentials: { email: string; password: string }): Promise<Account> => {
    const { data, error } = await admin.auth.admin.createUser({
      email: credentials.email,
      password: credentials.password,
      email_confirm: true,
    });
    if (error || !data.user) {
      throw new Error(`could not create ${credentials.email}: ${error?.message ?? 'no user returned'}`);
    }
    return { ...credentials, id: data.user.id };
  };

  return {
    owner: await createAccount({ email: `${prefix}-owner@example.test`, password: 'correct-horse-A1' }),
    stranger: await createAccount({
      email: `${prefix}-stranger@example.test`,
      password: 'correct-horse-B2',
    }),
    date: new Date(),
  };
};

const localDateOnly = (day: Date): string =>
  [
    String(day.getFullYear()).padStart(4, '0'),
    String(day.getMonth() + 1).padStart(2, '0'),
    String(day.getDate()).padStart(2, '0'),
  ].join('-');

const localTime = (day: Date, hour: number, minute: number): string =>
  new Date(day.getFullYear(), day.getMonth(), day.getDate(), hour, minute, 0, 0).toISOString();

export const seedAccounts = async (stack: LocalStack): Promise<SeededAccounts> => {
  // The stack is brought up once per run, so these two fixed accounts may already
  // exist from an earlier spec. Remove them and their rows first: a spec isolates
  // itself through the service role rather than through a ninety-second reset.
  await removeAccounts(stack, 'owner-a@');
  await removeAccounts(stack, 'stranger-b@');

  const admin = adminClient(stack);

  const createAccount = async (credentials: { email: string; password: string }): Promise<Account> => {
    const { data, error } = await admin.auth.admin.createUser({
      email: credentials.email,
      password: credentials.password,
      email_confirm: true,
    });
    if (error || !data.user) {
      throw new Error(`could not create ${credentials.email}: ${error?.message ?? 'no user returned'}`);
    }
    return { ...credentials, id: data.user.id };
  };

  const owner = await createAccount(ownerCredentials);
  const stranger = await createAccount(strangerCredentials);

  const today = new Date();

  const meal = await admin
    .from('meals')
    .insert({
      user_id: owner.id,
      slot: 'breakfast',
      // The day log selects on eaten_on, never on eaten_at, so a 22:30 row cannot
      // drift into the neighbouring day when the server's offset is not the phone's.
      eaten_on: localDateOnly(today),
      eaten_at: localTime(today, 7, 40),
      glucose_before: 104,
      glucose_after: 186,
      insulin_units: 5,
    })
    .select('id')
    .single();
  if (meal.error || !meal.data) {
    throw new Error(`could not seed account A's meal: ${meal.error?.message ?? 'no row returned'}`);
  }

  const foods = await admin.from('meal_foods').insert([
    {
      user_id: owner.id,
      meal_id: meal.data.id,
      name: 'Oats',
      food_type: 'carb-heavy',
      amount: 60,
      unit: 'g',
      position: 1,
    },
    {
      user_id: owner.id,
      meal_id: meal.data.id,
      name: 'Milk',
      food_type: 'dairy',
      amount: 200,
      unit: 'ml',
      position: 2,
    },
  ]);
  if (foods.error) {
    throw new Error(`could not seed account A's foods: ${foods.error.message}`);
  }

  const night = await admin.from('night_insulin').insert({
    user_id: owner.id,
    night_on: localDateOnly(today),
    units: 18,
    taken_at: localTime(today, 22, 30),
    bedtime_glucose: 132,
  });
  if (night.error) {
    throw new Error(`could not seed account A's night insulin: ${night.error.message}`);
  }

  return { owner, stranger, date: today };
};
