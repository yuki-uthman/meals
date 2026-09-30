import { test, expect, type Browser, type Locator, type Page } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { startLocalStack, type LocalStack } from '../support/local-stack';
import { createAccounts, removeAccounts, type Account, type SeededAccounts } from '../support/accounts';

/**
 * Public oracle for value 5, as revised: glucose is typed on the device's own number
 * keyboard, and a dose steps by one unit.
 *
 * Observation: tapping a glucose field opens the phone's number keyboard and nothing is
 * drawn into the page for it -- no in-app pad and no 'last reading' suggestion; dose fields
 * change by one unit with minus and plus buttons.
 *
 * Like every earlier value the oracle drives the built static bundle in a real browser
 * against the Supabase CLI local stack. Readings are seeded so that a suggestion, if one
 * were still offered, would have a number to show: its absence is then a real absence.
 *
 * The keyboard itself is the device's, so what is asserted is what asks for it: the field's
 * inputmode is 'numeric', which is the attribute a phone reads to open its number keyboard,
 * and never 'none', which is what an in-app pad would set to keep that keyboard away.
 */

const PHONE_VIEWPORT = { width: 360, height: 780 } as const;

/** This spec's own email prefix: it removes these accounts and their rows, and nothing else. */
const EMAIL_PREFIX = 'number-pad';

const NOT_LOGGED_YET = 'Not logged yet';

const DAY_MS = 24 * 60 * 60 * 1000;

/** What an in-app suggestion used to say, with the readings the seeds would put on it. */
const SUGGESTIONS = [/last reading/i, /before last/i] as const;

let stack: LocalStack;
let accounts: SeededAccounts;

test.describe.configure({ mode: 'serial' });
test.use({ viewport: PHONE_VIEWPORT });

const startOfLocalDay = (daysAgo: number): Date => {
  const now = new Date();
  const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return new Date(midnight.getTime() - daysAgo * DAY_MS);
};

const localDateOnly = (day: Date): string =>
  [
    String(day.getFullYear()).padStart(4, '0'),
    String(day.getMonth() + 1).padStart(2, '0'),
    String(day.getDate()).padStart(2, '0'),
  ].join('-');

const localTime = (day: Date, hour: number, minute: number): string =>
  new Date(day.getFullYear(), day.getMonth(), day.getDate(), hour, minute, 0, 0).toISOString();

/**
 * Today's lunch and yesterday's dinner are recorded readings a suggestion could repeat.
 * Today's dinner is deliberately absent: it is the slot the person records into.
 */
const seededMeals = [
  { daysAgo: 0, slot: 'lunch', hour: 12, minute: 55, before: 112, after: 133 },
  { daysAgo: 1, slot: 'dinner', hour: 19, minute: 10, before: 110, after: null },
] as const;

const seedMeals = async (owner: Account): Promise<void> => {
  const admin = createClient(stack.supabaseUrl, stack.serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  for (const meal of seededMeals) {
    const day = startOfLocalDay(meal.daysAgo);
    const inserted = await admin
      .from('meals')
      .insert({
        user_id: owner.id,
        slot: meal.slot,
        // eaten_on, never eaten_at, is what a day is selected on, so no seeded row can
        // drift into the neighbouring day when the server's offset is not the phone's.
        eaten_on: localDateOnly(day),
        eaten_at: localTime(day, meal.hour, meal.minute),
        glucose_before: meal.before,
        glucose_after: meal.after,
        insulin_units: 6,
      })
      .select('id')
      .single();
    if (inserted.error || !inserted.data) {
      throw new Error(
        `could not seed the ${meal.slot} ${meal.daysAgo} day(s) ago: ${
          inserted.error?.message ?? 'no row returned'
        }`,
      );
    }
    const food = await admin.from('meal_foods').insert({
      user_id: owner.id,
      meal_id: inserted.data.id,
      name: 'Oats',
      food_type: 'carb-heavy',
      amount: 60,
      unit: 'g',
      position: 1,
    });
    if (food.error) {
      throw new Error(`could not seed that meal's food: ${food.error.message}`);
    }
  }
};

test.beforeAll(async () => {
  test.setTimeout(10 * 60 * 1000);
  stack = await startLocalStack();
  accounts = await createAccounts(stack, EMAIL_PREFIX);
  await seedMeals(accounts.owner);
});

test.afterAll(async () => {
  if (stack) await removeAccounts(stack, EMAIL_PREFIX);
});

const signIn = async (page: Page, account: Account): Promise<void> => {
  await page.getByLabel(/email/i).fill(account.email);
  await page.getByLabel(/password/i).fill(account.password);
  await page.getByRole('button', { name: /sign in/i }).click();
};

const openPhone = async (browser: Browser): Promise<Page> => {
  const context = await browser.newContext({ viewport: PHONE_VIEWPORT });
  const page = await context.newPage();
  await page.goto(stack.siteUrl);
  return page;
};

const dayLog = (page: Page): Locator => page.getByRole('region', { name: /day log/i });

const cards = (page: Page): Locator => dayLog(page).getByRole('listitem');

const card = async (page: Page, slot: string): Promise<Locator> => {
  const matching = cards(page).filter({ hasText: slot });
  await expect(matching, `exactly one ${slot} card`).toHaveCount(1);
  return matching.first();
};

const textOf = async (locator: Locator): Promise<string> =>
  (await locator.innerText()).replace(/\s+/g, ' ').trim();

const scrollsHorizontally = (page: Page): Promise<boolean> =>
  page.evaluate(() => {
    const root = document.documentElement;
    return root.scrollWidth > root.clientWidth || document.body.scrollWidth > root.clientWidth;
  });

/** Opens New meal from an empty slot card, exactly as value 3's oracle does. */
const logFromEmptyCard = async (page: Page, slot: string): Promise<void> => {
  const empty = await card(page, slot);
  expect(await textOf(empty), `${slot} starts unlogged`).toContain(NOT_LOGGED_YET);
  const inner = empty.getByRole('button');
  if ((await inner.count()) > 0) {
    await inner.first().click();
  } else {
    await empty.click();
  }
};

/**
 * The fields, each by its EXACT label, as value 3 settled and this value's design repeats.
 * This is not a stylistic choice: the stepper's buttons are named 'Decrease dose' and
 * 'Increase dose', so a loose match like /units|dose/i resolves to three elements on this
 * very screen and the oracle would end up asserting a value on a button. On one screen a
 * label and a control name must be distinguishable by exact match, and the oracle must use
 * that exact match rather than a pattern that is unique only by accident.
 */
const glucoseBeforeField = (page: Page): Locator =>
  page.getByLabel('Glucose before', { exact: true });
const glucoseAfterField = (page: Page): Locator =>
  page.getByLabel('Glucose after', { exact: true });
const doseField = (page: Page): Locator =>
  page.getByLabel('Rapid-acting units', { exact: true });

test('a glucose field opens the device keyboard with nothing drawn in the page, and a dose steps by one unit', async ({
  browser,
}) => {
  const phone = await openPhone(browser);
  await signIn(phone, accounts.owner);
  await logFromEmptyCard(phone, 'Dinner');

  const before = glucoseBeforeField(phone);
  const after = glucoseAfterField(phone);

  for (const [name, field] of [
    ['Glucose before', before],
    ['Glucose after', after],
  ] as const) {
    await expect(field, `'${name}' names one input`).toHaveCount(1);
    // numeric, never none: 'none' is what keeps the phone's keyboard away for an in-app pad.
    await expect(field, `'${name}' asks the phone for its number keyboard`).toHaveAttribute(
      'inputmode',
      'numeric',
    );

    await field.click();
    await expect(field, `'${name}' takes focus`).toBeFocused();
    await expect(
      phone.getByRole('group', { name: /number pad/i }),
      `tapping '${name}' draws no in-app pad`,
    ).toHaveCount(0);
    const body = await textOf(phone.locator('body'));
    for (const suggestion of SUGGESTIONS) {
      expect(body, `tapping '${name}' offers no ${String(suggestion)} suggestion`).not.toMatch(
        suggestion,
      );
    }

    // Typed straight in, as the device keyboard types it.
    await field.fill('');
    await phone.keyboard.type('142');
    await expect(field, `'${name}' takes what is typed on the keyboard`).toHaveValue('142');
  }

  expect(await scrollsHorizontally(phone)).toBe(false);

  // --- The dose steps by exactly one unit ---------------------------------

  const dose = doseField(phone);
  await expect(dose, 'the dose still names one input').toHaveCount(1);
  await expect(dose, 'the dose input stays typeable').toBeEditable();

  const increase = phone.getByRole('button', { name: 'Increase dose' });
  const decrease = phone.getByRole('button', { name: 'Decrease dose' });
  await expect(increase, "one 'Increase dose' control").toHaveCount(1);
  await expect(decrease, "one 'Decrease dose' control").toHaveCount(1);

  // One unit per press, read after every press, so a control that moved by two or by ten
  // cannot hide inside the final number.
  await increase.click();
  await expect(dose, 'the first increase makes the dose 1').toHaveValue('1');
  await increase.click();
  await expect(dose, 'the second increase makes it 2').toHaveValue('2');
  await increase.click();
  await expect(dose, 'the third increase makes it 3').toHaveValue('3');

  await decrease.click();
  await expect(dose, 'one decrease makes it 2').toHaveValue('2');

  // A dose of zero does not go below zero: a negative dose is not a thing that can be
  // taken. The dose is typed rather than stepped down, because the input stays typeable.
  await dose.fill('0');
  await decrease.click();
  await expect(dose, 'decrease at zero leaves the dose at zero').toHaveValue('0');

  expect(await scrollsHorizontally(phone)).toBe(false);
});
