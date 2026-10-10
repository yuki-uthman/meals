import { test, expect, type Browser, type Locator, type Page } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { startLocalStack, type LocalStack } from '../support/local-stack';
import { createAccounts, removeAccounts, type Account, type SeededAccounts } from '../support/accounts';

/**
 * Public oracle for value 7: logging the same foods again.
 *
 * Observation: from a meal, 'Log again' opens a new entry with only the foods and amounts
 * copied; time, readings, dose and context start empty or at today's values, and saving
 * creates a separate record while the original is unchanged.
 *
 * The oracle drives the built static bundle in a real browser against the Supabase CLI
 * local stack, like every earlier value, so the second record and the untouched first one
 * are what Postgres actually holds and gave back through real row-level security, never
 * what the form believed it wrote.
 *
 * Two claims carry this value and are asserted separately. The FIRST is that nothing but
 * the foods travels: the dose, both readings and the note arrive EMPTY and the exercise
 * context arrives at None, because a dose offered as a starting value is a dose
 * recommended however it is labelled, and this product never recommends one. The SECOND is
 * that the repeat is a separate row on TODAY while the source keeps every one of its own
 * values on the day it was eaten -- and that the two are nevertheless recognised as the
 * same meal, which is value 6's identity rule and is the whole point of copying exactly.
 *
 * Fields are located by their EXACT labels, as every form oracle here does, because a
 * loose pattern resolves to the stepper and pad controls that sit beside them.
 */

const PHONE_VIEWPORT = { width: 360, height: 780 } as const;

/** This spec's own email prefix: it removes these accounts and their rows, and nothing else. */
const EMAIL_PREFIX = 'log-again';

const SOURCE_NOTE = 'Ate slowly';
const LOG_AGAIN = /log again with these foods/i;

let stack: LocalStack;
let accounts: SeededAccounts;
/** The day the source dinner was eaten: yesterday in the browser's local terms. */
let sourceDay: Date;

test.describe.configure({ mode: 'serial' });
test.use({ viewport: PHONE_VIEWPORT });

const localDateOnly = (day: Date): string =>
  [
    String(day.getFullYear()).padStart(4, '0'),
    String(day.getMonth() + 1).padStart(2, '0'),
    String(day.getDate()).padStart(2, '0'),
  ].join('-');

const localTime = (day: Date, hour: number, minute: number): string =>
  new Date(day.getFullYear(), day.getMonth(), day.getDate(), hour, minute, 0, 0).toISOString();

const daysBefore = (day: Date, count: number): Date =>
  new Date(day.getFullYear(), day.getMonth(), day.getDate() - count);

/**
 * The source dinner, seeded through the service role outside the browser: the foods this
 * value copies, and the dose, readings, context and note it must NOT copy.
 */
const seedSourceDinner = async (admin: SupabaseClient, owner: Account, day: Date): Promise<void> => {
  const inserted = await admin
    .from('meals')
    .insert({
      user_id: owner.id,
      slot: 'dinner',
      // Selected on eaten_on, never on eaten_at, so the source cannot drift into the
      // neighbouring day when the server's offset is not the phone's.
      eaten_on: localDateOnly(day),
      eaten_at: localTime(day, 19, 5),
      glucose_before: 110,
      glucose_after: 142,
      insulin_units: 6,
      exercise_context: 'after',
      note: SOURCE_NOTE,
    })
    .select('id')
    .single();
  if (inserted.error || !inserted.data) {
    throw new Error(
      `could not seed the source dinner: ${inserted.error?.message ?? 'no row returned'}`,
    );
  }

  const foods = await admin.from('meal_foods').insert([
    {
      user_id: owner.id,
      meal_id: inserted.data.id,
      name: 'Chicken rice',
      food_type: 'mixed dish',
      amount: 250,
      unit: 'g',
      position: 1,
    },
    {
      user_id: owner.id,
      meal_id: inserted.data.id,
      name: 'Cucumber salad',
      food_type: 'vegetable',
      amount: 80,
      unit: 'g',
      position: 2,
    },
  ]);
  if (foods.error) {
    throw new Error(`could not seed the source dinner's foods: ${foods.error.message}`);
  }
};

test.beforeAll(async () => {
  test.setTimeout(10 * 60 * 1000);
  stack = await startLocalStack();
  accounts = await createAccounts(stack, EMAIL_PREFIX);

  const admin = createClient(stack.supabaseUrl, stack.serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Yesterday, so that 'lands on today rather than on the day being browsed' is a
  // claim with two different dates in it.
  sourceDay = daysBefore(accounts.date, 1);
  await seedSourceDinner(admin, accounts.owner, sourceDay);
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

/** The single card that names this slot. Two Dinner cards, or none, fails here. */
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

const save = (page: Page): Promise<void> => page.getByRole('button', { name: /^save$/i }).click();

/**
 * Opens a meal's detail from its card body, the way value 6 established, and does not
 * return until the detail is actually on screen. Opening a detail reads the meal by its
 * id and then its history, so the click alone leaves the day log up for a moment; a
 * caller that read the page straight after the click would be reading the wrong page.
 * 'Back to the day' is the control every detail carries, so it is what is waited for.
 */
const openDetail = async (page: Page, slot: string): Promise<void> => {
  const meal = await card(page, slot);
  const intoDetail = meal.getByRole('link').first();
  await expect(intoDetail, `the ${slot} card body opens its detail`).toHaveCount(1);
  await intoDetail.click();
  await expect(
    page.getByRole('button', { name: /back to the day/i }),
    `the ${slot} detail is on screen before anything is read from it`,
  ).toBeVisible();
};

test('a meal is logged again with only its foods copied, as a separate record that leaves the original untouched', async ({
  browser,
}) => {
  const phone = await openPhone(browser);
  await signIn(phone, accounts.owner);

  // --- Finding the source meal on the day it was eaten ----------------------

  await phone.getByRole('button', { name: /^previous day$/i }).click();
  await openDetail(phone, 'Dinner');

  // --- The form as it arrives -----------------------------------------------

  await phone.getByRole('button', { name: LOG_AGAIN }).click();

  // A repeat is a NEW meal, not an edit of the source. If this said 'Edit meal' the
  // save would be about to overwrite the very meal being compared against.
  await expect(phone.getByRole('heading', { name: /^new meal$/i })).toBeVisible();

  // The form names where the foods came from, so a person cannot lose track of what
  // they are repeating. The day of the month and the slot are the identifying parts;
  // how the date is spelled is a presentation choice.
  const subtitle = phone.getByText(/same foods as/i).first();
  await expect(subtitle, 'the form names its source meal').toHaveCount(1);
  const subtitleText = await textOf(subtitle);
  expect(subtitleText, "the source's slot is named").toMatch(/dinner/i);
  expect(subtitleText, "the source's day is named").toContain(String(sourceDay.getDate()));

  // Only the foods are copied: each name, its type, and its amount with its unit.
  const formText = await textOf(phone.locator('body'));
  for (const fragment of ['Chicken rice', 'Cucumber salad']) {
    expect(formText, `${fragment} is copied`).toContain(fragment);
  }
  expect(formText.toLowerCase(), "the copied food keeps its type").toContain('mixed dish');
  expect(formText.toLowerCase(), "the copied food keeps its type").toContain('vegetable');
  expect(formText, "the copied food keeps its amount and unit").toContain('250 g');
  expect(formText, "the copied food keeps its amount and unit").toContain('80 g');

  // The slot comes across, because repeating a dinner almost always means another
  // dinner and value 8 depends on the slot being a deliberate choice.
  await expect(
    phone.getByRole('radio', { name: /^dinner$/i }),
    "the slot starts at the source meal's slot",
  ).toBeChecked();

  // Nothing else comes across. The dose above all: a dose offered as a starting
  // value is a dose recommended, and this product never recommends one.
  await expect(
    phone.getByLabel('Rapid-acting units', { exact: true }),
    'the dose starts EMPTY: a pre-filled dose is a recommended dose',
  ).toHaveValue('');
  await expect(phone.getByLabel('Glucose before', { exact: true })).toHaveValue('');
  await expect(phone.getByLabel('Glucose after', { exact: true })).toHaveValue('');
  await expect(phone.getByLabel('Note', { exact: true })).toHaveValue('');
  await expect(
    phone.getByRole('radio', { name: /^none$/i }),
    'the exercise context starts at None',
  ).toBeChecked();

  // The time is today's clock time, not the source's. Asserting what it is NOT keeps
  // the oracle honest about a value that moves while the test runs.
  await expect(phone.getByLabel('Time', { exact: true })).not.toHaveValue(/19:05/);

  expect(await scrollsHorizontally(phone)).toBe(false);

  // --- Saving it as today's own record --------------------------------------

  await phone.getByLabel('Glucose before', { exact: true }).fill('145');
  await phone.getByLabel('Rapid-acting units', { exact: true }).fill('7');
  await save(phone);

  // A repeat is recorded against TODAY, whichever date was browsed to find the source.
  await expect(phone.getByRole('heading', { name: /^today$/i })).toBeVisible();

  const repeat = await card(phone, 'Dinner');
  const repeatText = await textOf(repeat);
  for (const fragment of ['Chicken rice 250 g · Cucumber salad 80 g', '145', '7 u']) {
    expect(repeatText, `today's Dinner card must read ${fragment}`).toContain(fragment);
  }
  // No after reading was entered, so no change may be drawn -- and in particular the
  // source's 142 must not have followed the foods across.
  await expect(
    repeat.locator('[data-change-band]'),
    'no change band before an after reading exists',
  ).toHaveCount(0);
  expect(repeatText, "the source's note did not travel").not.toContain(SOURCE_NOTE);
  expect(repeatText, "the source's dose did not travel").not.toContain('6 u');

  // --- The source, untouched ------------------------------------------------

  await phone.getByRole('button', { name: /^previous day$/i }).click();

  const source = await card(phone, 'Dinner');
  const sourceText = await textOf(source);
  for (const fragment of ['110', '142', '+32', '6 u']) {
    expect(sourceText, `the source Dinner still reads ${fragment}`).toContain(fragment);
  }
  await expect(source.locator('[data-change-band]')).toHaveAttribute('data-change-band', 'rose');
  // Saving created a second record; it did not move the first onto today.
  await expect(cards(phone).filter({ hasText: 'Dinner' }), 'the source is still one meal').toHaveCount(
    1,
  );

  // Its note and its context are its own and survive the repeat. The note reads on the
  // detail; the context is only readable on the form that recorded it, so it is read
  // there and the form is then abandoned.
  await openDetail(phone, 'Dinner');
  // An auto-retrying locator assertion rather than a one-shot snapshot of the body, so
  // this reads the source's own note and never whatever page a navigation had not yet
  // finished leaving.
  await expect(
    phone.getByText(SOURCE_NOTE, { exact: false }).first(),
    'the source keeps its note',
  ).toBeVisible();

  // The repeat copied the foods exactly, so the identity rule of value 6 must pair the
  // two: two instances of one meal is what this whole product exists to compare.
  await expect(
    phone.getByRole('heading', { name: 'Every time you ate this · 2' }),
    'the repeat and its source are the same meal',
  ).toBeVisible();

  // Back to the day, where value 3 put the Edit control, to read the context.
  await phone.getByRole('button', { name: /back to the day/i }).click();
  await phone.getByRole('button', { name: /^edit dinner$/i }).click();
  await expect(phone.getByRole('heading', { name: /^edit meal$/i })).toBeVisible();
  await expect(phone.getByLabel('Glucose before', { exact: true })).toHaveValue('110');
  await expect(phone.getByLabel('Glucose after', { exact: true })).toHaveValue('142');
  await expect(phone.getByLabel('Rapid-acting units', { exact: true })).toHaveValue('6');
  await expect(phone.getByLabel('Note', { exact: true })).toHaveValue(SOURCE_NOTE);
  await expect(
    phone.getByRole('radio', { name: /^after meal$/i }),
    'the source keeps its own exercise context',
  ).toBeChecked();
  await expect(phone.getByLabel('Time', { exact: true })).toHaveValue(/19:05/);
  await phone.getByRole('button', { name: /^cancel$/i }).click();

  expect(await scrollsHorizontally(phone)).toBe(false);
});

test("logging again over a dinner already begun today replaces it, keeping only its before reading", async ({
  browser,
}) => {
  const admin = createClient(stack.supabaseUrl, stack.serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Today starts from a single dinner with only the before reading recorded, as when a
  // person takes the reading and has not yet eaten. Whatever the earlier test left on
  // today is cleared, so the only dinner is the begun one.
  const today = localDateOnly(accounts.date);
  const cleared = await admin
    .from('meals')
    .delete()
    .eq('user_id', accounts.owner.id)
    .eq('eaten_on', today);
  if (cleared.error) throw new Error(`could not clear today: ${cleared.error.message}`);
  const begun = await admin.from('meals').insert({
    user_id: accounts.owner.id,
    slot: 'dinner',
    eaten_on: today,
    eaten_at: localTime(accounts.date, 18, 30),
    glucose_before: 120,
  });
  if (begun.error) throw new Error(`could not seed the begun dinner: ${begun.error.message}`);

  const phone = await openPhone(browser);
  await signIn(phone, accounts.owner);

  // Yesterday's dinner is the one being eaten again.
  await phone.getByRole('button', { name: /^previous day$/i }).click();
  await openDetail(phone, 'Dinner');
  await phone.getByRole('button', { name: LOG_AGAIN }).click();

  // It is today's dinner being completed, so it opens on that meal rather than on a
  // second one, with the foods copied and the before reading already in.
  await expect(phone.getByRole('heading', { name: /^edit meal$/i })).toBeVisible();
  const formText = await textOf(phone.locator('body'));
  for (const fragment of ['Chicken rice', 'Cucumber salad', '250 g', '80 g']) {
    expect(formText, `${fragment} is copied`).toContain(fragment);
  }
  await expect(
    phone.getByLabel('Glucose before', { exact: true }),
    "today's before reading is filled in",
  ).toHaveValue('120');

  // Nothing else of either meal comes across.
  await expect(phone.getByLabel('Glucose after', { exact: true })).toHaveValue('');
  await expect(phone.getByLabel('Rapid-acting units', { exact: true })).toHaveValue('');
  await expect(phone.getByLabel('Note', { exact: true })).toHaveValue('');

  await phone.getByLabel('Rapid-acting units', { exact: true }).fill('5');
  await save(phone);

  // One dinner on the day, not two: the begun one now holds the foods.
  await expect(phone.getByRole('heading', { name: /^today$/i })).toBeVisible();
  const dinner = await card(phone, 'Dinner');
  const dinnerText = await textOf(dinner);
  for (const fragment of ['Chicken rice 250 g · Cucumber salad 80 g', '120', '5 u']) {
    expect(dinnerText, `today's Dinner card must read ${fragment}`).toContain(fragment);
  }

  // The database holds the same single row, the one that was begun.
  const rows = await admin
    .from('meals')
    .select('slot, glucose_before, insulin_units')
    .eq('user_id', accounts.owner.id)
    .eq('eaten_on', today)
    .eq('slot', 'dinner');
  expect(rows.error).toBeNull();
  expect(rows.data, 'exactly one dinner on today').toHaveLength(1);
  expect(Number(rows.data?.[0]?.glucose_before)).toBe(120);
  expect(Number(rows.data?.[0]?.insulin_units)).toBe(5);

  // Yesterday's dinner is untouched.
  await phone.getByRole('button', { name: /^previous day$/i }).click();
  const source = await card(phone, 'Dinner');
  for (const fragment of ['110', '142', '6 u']) {
    expect(await textOf(source), `the source Dinner still reads ${fragment}`).toContain(fragment);
  }
});
