import { test, expect, type Browser, type Locator, type Page } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { startLocalStack, type LocalStack } from '../support/local-stack';
import { createAccounts, removeAccounts, type Account, type SeededAccounts } from '../support/accounts';

/**
 * Public oracle for value 5: the in-app number pad and the dose stepper.
 *
 * Observation: tapping a glucose field opens an in-app number pad with chips for the last
 * reading; dose fields change by one unit with minus and plus buttons.
 *
 * Like every earlier value the oracle drives the built static bundle in a real browser
 * against the Supabase CLI local stack, so the chips carry readings Postgres actually
 * holds and handed back through real row-level security, not numbers a fixture invented
 * inside the page.
 *
 * Four claims carry this value and the oracle is built around them:
 *
 *  - The pad writes into the SAME labelled input value 3 declared. So the field is located
 *    by its label, is asserted editable rather than readonly, and its value is read back
 *    after every key. A pad that replaced the field with its own display would fail here,
 *    and would also have broken record-a-meal.
 *  - The keying rules are exact: a digit appends to the right, a fourth digit is refused,
 *    Delete removes exactly the rightmost digit, Clear empties, and a chip REPLACES the
 *    value without closing the pad. Each is read off the field after one single action, so
 *    no two rules can cover for each other.
 *  - The two chips come from what the account recorded: 'Last reading 133 · 12:55' is the
 *    most recent glucose value -- today's lunch AFTER reading, which counts as later than
 *    that same meal's before reading of 112 -- and 'Before last dinner 110' is the before
 *    reading of the most recent meal in the slot being recorded. A rule that took the
 *    before reading, or the wrong slot, would show 112 and fail here.
 *  - A value typed straight into a glucose field SURVIVES being focused, and the pad opens
 *    seeded from it. This is judged by filling the field without the pad, focusing it, and
 *    then asking the pad to Delete: the value must lose exactly its rightmost digit. An
 *    implementation that re-rendered or reset the input on focus would eat a
 *    hardware-keyboard user's first keystroke, and would break value 3's oracle too.
 *
 * Widgets are located tolerantly by their accessible names, because whether a key is a
 * button in a fieldset or a cell in a grid is a presentation choice, while the pad's name,
 * its controls and the numbers it puts in the field are what the design fixes.
 */

const PHONE_VIEWPORT = { width: 360, height: 780 } as const;

/** This spec's own email prefix: it removes these accounts and their rows, and nothing else. */
const EMAIL_PREFIX = 'number-pad';

const NOT_LOGGED_YET = 'Not logged yet';

const DAY_MS = 24 * 60 * 60 * 1000;

/** The chip texts the design fixes, with the readings the seeds put behind them. */
const LAST_READING_CHIP = 'Last reading 133 · 12:55';
const BEFORE_LAST_DINNER_CHIP = 'Before last dinner 110';

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
 * Today's lunch supplies the last reading: before 112 and after 133 at 12:55, so the most
 * recent glucose value is 133 and the time shown is the meal's own time. Yesterday's
 * dinner supplies the slot chip with its before reading of 110. Today's dinner is
 * deliberately absent: it is the slot the person records into.
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

const pad = (page: Page): Locator => page.getByRole('group', { name: /^number pad$/i });

/** A pad control -- a digit, Clear, Delete, Done or a chip -- by its accessible name. */
const key = (page: Page, name: string | RegExp): Locator => {
  const exact = typeof name === 'string' ? new RegExp(`^${name}$`) : name;
  return pad(page).getByRole('button', { name: exact });
};

const press = async (page: Page, name: string | RegExp): Promise<void> => {
  const control = key(page, name);
  await expect(control, `the pad offers exactly one '${String(name)}' control`).toHaveCount(1);
  await control.click();
};

test('a glucose field opens the pad with its chips, keys exactly, and a dose steps by one unit', async ({
  browser,
}) => {
  const phone = await openPhone(browser);
  await signIn(phone, accounts.owner);

  // Dinner today is unrecorded: it is the slot being recorded, which is what makes
  // yesterday's dinner 'the most recent meal in the slot'.
  await logFromEmptyCard(phone, 'Dinner');

  const glucose = glucoseBeforeField(phone);
  await expect(glucose, "'glucose before' still names one input").toHaveCount(1);

  // The pad is not on screen until the field is tapped: it opens on the field, it is not
  // simply always there.
  await expect(pad(phone), 'the pad is closed before the field is tapped').toHaveCount(0);

  // --- Tapping the field opens the pad, carrying both chips -----------------

  await glucose.click();

  await expect(pad(phone), 'tapping the field reveals the number pad').toHaveCount(1);
  await expect(pad(phone)).toBeVisible();

  // The field keeps its label and stays an editable input: the pad writes into the very
  // field value 3 declared, and a readonly field would break that value's oracle while
  // looking like an improvement.
  await expect(glucose, 'the field the pad writes into is never readonly').toBeEditable();

  const padText = await textOf(pad(phone));
  expect(padText, 'the last reading chip carries the most recent value and its time').toContain(
    LAST_READING_CHIP,
  );
  expect(padText, 'the slot chip carries the before reading of the most recent dinner').toContain(
    BEFORE_LAST_DINNER_CHIP,
  );
  // The most recent reading is the lunch's AFTER value, because both readings hang off the
  // meal's own time and the after one counts as later. 112 is that meal's before reading
  // and must not be what the chip offers.
  expect(padText, 'the last reading is the after value, not the before value').not.toContain('112');

  // Every digit the pad claims to have.
  for (const digit of ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9']) {
    await expect(key(phone, digit), `the pad carries the digit ${digit}`).toHaveCount(1);
  }

  expect(await scrollsHorizontally(phone)).toBe(false);

  // --- Keying: a digit appends to the right --------------------------------

  await press(phone, '1');
  await expect(glucose, 'the first digit lands in the field').toHaveValue('1');
  await press(phone, '5');
  await expect(glucose, 'a digit appends to the right').toHaveValue('15');
  await press(phone, '0');
  await expect(glucose, 'three digits key 150').toHaveValue('150');

  // A fourth digit is refused: a reading above 999 is not a reading.
  await press(phone, '7');
  await expect(glucose, 'the fourth digit changes nothing').toHaveValue('150');

  // Delete removes exactly the rightmost digit -- one, not all of them.
  await press(phone, 'Delete');
  await expect(glucose, 'Delete removes the rightmost digit').toHaveValue('15');

  // Clear empties the field.
  await press(phone, 'Clear');
  await expect(glucose, 'Clear empties the field').toHaveValue('');

  // Delete on an empty field is refused, and changes nothing else.
  await press(phone, 'Delete');
  await expect(glucose, 'Delete on an empty field leaves it empty').toHaveValue('');
  await expect(pad(phone), 'a refused Delete does not close the pad').toBeVisible();

  // --- A chip fills the field and leaves the pad open ----------------------

  await press(phone, BEFORE_LAST_DINNER_CHIP);
  await expect(glucose, 'the chip puts its own number in the field').toHaveValue('110');
  await expect(pad(phone), 'a chip does not close the pad, so a mistap is one Clear away').toBeVisible();

  // --- Done closes the pad and leaves the value ----------------------------

  await press(phone, 'Done');
  await expect(pad(phone), 'Done closes the pad').toHaveCount(0);
  await expect(glucose, 'Done leaves the value in the field').toHaveValue('110');

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

  // --- A value put into a glucose field directly survives being focused ----

  // Filled without the pad at all, exactly the way value 3's oracle fills it, so the field
  // is still an ordinary input a hardware keyboard and an automated fill can both reach.
  const after = glucoseAfterField(phone);
  await expect(after, "'Glucose after' still names one editable input").toBeEditable();
  await after.fill('182');
  await expect(after, 'the field takes a value typed straight into it').toHaveValue('182');

  await after.focus();

  // Focusing is how a person with a hardware keyboard starts typing, and it is what opens
  // the pad. The pad must assist the field rather than replace it: a re-render that
  // discarded or reset the input would eat that first keystroke, and would break value 3's
  // oracle in the same breath.
  await expect(pad(phone), 'focusing a glucose field opens the pad').toBeVisible();
  await expect(after, 'the value already in the field survives being focused').toHaveValue('182');

  // And the pad genuinely SEEDED itself from that value rather than starting blank beside
  // it: Delete takes the rightmost digit of 182. A pad holding its own empty entry would
  // leave the field at 182 or would clear it, and either way fails here.
  await press(phone, 'Delete');
  await expect(after, 'the pad opened on the value the field already held').toHaveValue('18');

  expect(await scrollsHorizontally(phone)).toBe(false);
});
