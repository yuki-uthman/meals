import { test, expect, type Browser, type Locator, type Page } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { startLocalStack, type LocalStack } from '../support/local-stack';
import { seedAccounts, type Account, type SeededAccounts } from '../support/accounts';

/**
 * Public oracle for value 2: the Today screen.
 *
 * Observation: after sign-in the Today screen shows the date, a card per logged meal
 * (slot, time, foods, dose, before to after with the change), a 'not logged yet' card
 * for an empty slot, and a night insulin card.
 *
 * The oracle drives the built static bundle in a real browser against the Supabase CLI
 * local stack, exactly as value 1 does, so the cards are drawn from rows that came back
 * through real row-level security rather than from a fixture in the page.
 *
 * It asserts band NAMES, never colours: a band is the rule under test, and a hex value
 * is merely how that band happens to be painted.
 */

const PHONE_VIEWPORT = { width: 360, height: 780 } as const;

/**
 * Value 1's rule, carried forward unchanged: an element carries data-entry exactly when
 * it renders something the signed-in account recorded. A slot label, a heading, the date
 * and a 'Not logged yet' placeholder never do, because they read the same for every
 * account.
 */
const DATA_ENTRY = '[data-entry]';

const NOT_LOGGED_YET = 'Not logged yet';

let stack: LocalStack;
let accounts: SeededAccounts;

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

const dayBefore = (day: Date): Date =>
  new Date(day.getFullYear(), day.getMonth(), day.getDate() - 1);

type SeedFood = {
  readonly name: string;
  readonly foodType: string;
  readonly amount: number;
  readonly unit: string;
};

type SeedMeal = {
  readonly slot: 'breakfast' | 'lunch' | 'dinner' | 'snack';
  readonly day: Date;
  readonly hour: number;
  readonly minute: number;
  readonly before: number;
  readonly after: number;
  readonly units: number;
  readonly foods: readonly SeedFood[];
};

/**
 * The extra rows this value's stimulus names, beyond the breakfast and night insulin the
 * shared account support already seeds: today's lunch and yesterday's dinner. Seeded
 * through the service role outside the browser, like every other fixture row, so the
 * browser only ever reads as the signed-in account.
 */
const seedMeal = async (
  admin: SupabaseClient,
  owner: Account,
  meal: SeedMeal,
): Promise<void> => {
  const inserted = await admin
    .from('meals')
    .insert({
      user_id: owner.id,
      slot: meal.slot,
      // Selected on eaten_on, never on eaten_at, so a late row cannot drift into the
      // neighbouring day when the server's offset is not the phone's.
      eaten_on: localDateOnly(meal.day),
      eaten_at: localTime(meal.day, meal.hour, meal.minute),
      glucose_before: meal.before,
      glucose_after: meal.after,
      insulin_units: meal.units,
    })
    .select('id')
    .single();
  if (inserted.error || !inserted.data) {
    throw new Error(
      `could not seed the ${meal.slot}: ${inserted.error?.message ?? 'no row returned'}`,
    );
  }

  const foods = await admin.from('meal_foods').insert(
    meal.foods.map((food, index) => ({
      user_id: owner.id,
      meal_id: inserted.data.id,
      name: food.name,
      food_type: food.foodType,
      amount: food.amount,
      unit: food.unit,
      position: index + 1,
    })),
  );
  if (foods.error) {
    throw new Error(`could not seed the ${meal.slot}'s foods: ${foods.error.message}`);
  }
};

test.beforeAll(async () => {
  test.setTimeout(10 * 60 * 1000);
  stack = await startLocalStack();
  accounts = await seedAccounts(stack);

  const admin = createClient(stack.supabaseUrl, stack.serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const today = accounts.date;

  // Today's lunch: a small rise, so the stable band is exercised beside breakfast's.
  await seedMeal(admin, accounts.owner, {
    slot: 'lunch',
    day: today,
    hour: 12,
    minute: 55,
    before: 112,
    after: 133,
    units: 6,
    foods: [
      { name: 'Chicken rice', foodType: 'mixed dish', amount: 250, unit: 'g' },
      { name: 'Cucumber salad', foodType: 'vegetable', amount: 80, unit: 'g' },
    ],
  });

  // Yesterday's dinner: a fall of exactly 40, the boundary the dropped band opens at,
  // and the only row on that date, so stepping back must change what is on screen.
  await seedMeal(admin, accounts.owner, {
    slot: 'dinner',
    day: dayBefore(today),
    hour: 19,
    minute: 10,
    before: 150,
    after: 110,
    units: 4,
    foods: [{ name: 'Soup', foodType: 'mixed dish', amount: 300, unit: 'ml' }],
  });
});

test.afterAll(async () => {
  await stack?.stop();
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

/** The day log region value 1 already publishes, now holding one card per slot. */
const dayLog = (page: Page): Locator => page.getByRole('region', { name: /day log/i });

const cards = (page: Page): Locator => dayLog(page).getByRole('listitem');

/**
 * The single card that names this slot. Asserting the count keeps 'attached to the wrong
 * slot' falsifiable: two Dinner cards, or none, fails here rather than silently passing
 * because some other card happened to carry the text being looked for.
 */
const card = async (page: Page, name: string): Promise<Locator> => {
  const matching = cards(page).filter({ hasText: name });
  await expect(matching, `exactly one ${name} card`).toHaveCount(1);
  return matching.first();
};

const textOf = async (locator: Locator): Promise<string> =>
  (await locator.innerText()).replace(/\s+/g, ' ').trim();

/** The text of every element inside this card that claims to render recorded data. */
const recordedTextOf = async (locator: Locator): Promise<string> => {
  const texts = await locator.locator(DATA_ENTRY).allInnerTexts();
  return texts.join(' | ').replace(/\s+/g, ' ');
};

const expectMealCard = async (
  page: Page,
  slot: string,
  expected: {
    readonly time: string;
    readonly foods: string;
    readonly dose: string;
    readonly before: string;
    readonly after: string;
    readonly change: string;
    readonly band: string;
  },
): Promise<void> => {
  const meal = await card(page, slot);
  const text = await textOf(meal);

  for (const fragment of [
    expected.time,
    expected.foods,
    expected.dose,
    expected.before,
    expected.after,
  ]) {
    expect(text, `the ${slot} card must read ${fragment}`).toContain(fragment);
  }

  // The change is published with its band, so the name of the rule and the number it
  // judges are the same element. A colour is deliberately not asserted.
  const change = meal.locator('[data-change-band]');
  await expect(change, `the ${slot} card publishes one change band`).toHaveCount(1);
  await expect(change).toHaveAttribute('data-change-band', expected.band);
  expect(await textOf(change), `the ${slot} change is signed`).toContain(expected.change);

  // A logged card is the account's own data, and every part of it says so.
  const recorded = await recordedTextOf(meal);
  for (const fragment of [
    expected.time,
    expected.foods,
    expected.dose,
    expected.before,
    expected.after,
  ]) {
    expect(recorded, `${fragment} on the ${slot} card carries data-entry`).toContain(fragment);
  }

  // The slot label is furniture: the same word for every account, so never an entry.
  expect(recorded, `the ${slot} label is furniture, not data`).not.toContain(slot);
};

/** An empty fixed slot: the label, exactly 'Not logged yet', and nobody's data. */
const expectEmptyCard = async (page: Page, slot: string): Promise<void> => {
  const empty = await card(page, slot);
  expect(await textOf(empty)).toBe(`${slot} ${NOT_LOGGED_YET}`);
  await expect(empty.locator(DATA_ENTRY)).toHaveCount(0);
};

const scrollsHorizontally = (page: Page): Promise<boolean> =>
  page.evaluate(() => {
    const root = document.documentElement;
    return root.scrollWidth > root.clientWidth || document.body.scrollWidth > root.clientWidth;
  });

test('the Today screen shows a card per logged meal, an empty slot card and the night dose', async ({
  browser,
}) => {
  const phone = await openPhone(browser);
  await signIn(phone, accounts.owner);

  // The heading names the date being read, and the date being read is today.
  await expect(phone.getByRole('heading', { name: 'Today' })).toBeVisible();

  // Three fixed slots in order, then the night insulin card.
  await expect(cards(phone).nth(0)).toContainText('Breakfast');
  await expect(cards(phone).nth(1)).toContainText('Lunch');
  await expect(cards(phone).nth(2)).toContainText('Dinner');

  await expectMealCard(phone, 'Breakfast', {
    time: '07:40',
    foods: 'Oats 60 g · Milk 200 ml',
    dose: '5 u',
    before: '104',
    after: '186',
    change: '+82',
    band: 'rose-high',
  });

  await expectMealCard(phone, 'Lunch', {
    time: '12:55',
    foods: 'Chicken rice 250 g · Cucumber salad 80 g',
    dose: '6 u',
    before: '112',
    after: '133',
    change: '+21',
    band: 'stable',
  });

  // Nothing was eaten at dinner, and the screen says so rather than leaving a hole.
  await expectEmptyCard(phone, 'Dinner');

  const night = await card(phone, 'Night insulin');
  expect(await textOf(night)).toContain('18 u at 22:30');
  expect(await recordedTextOf(night), 'the night dose is the account\'s own data').toContain(
    '18 u at 22:30',
  );

  // The log has no future.
  await expect(phone.getByRole('button', { name: 'Next day' })).toBeDisabled();

  expect(await scrollsHorizontally(phone)).toBe(false);

  // Stepping back re-reads the day log for the previous date through the same port.
  await phone.getByRole('button', { name: 'Previous day' }).click();

  const yesterday = dayBefore(accounts.date);
  const heading = phone.getByRole('heading', { name: /\S/ }).first();
  await expect(heading).not.toHaveText('Today');
  await expect(heading).toContainText(String(yesterday.getDate()));

  await expectMealCard(phone, 'Dinner', {
    time: '19:10',
    foods: 'Soup 300 ml',
    dose: '4 u',
    before: '150',
    after: '110',
    change: '−40',
    band: 'dropped',
  });

  // Yesterday's breakfast and lunch were never logged, and no night dose was recorded,
  // so nothing from today may have been cached into this date.
  await expectEmptyCard(phone, 'Breakfast');
  await expectEmptyCard(phone, 'Lunch');
  const emptyNight = await card(phone, 'Night insulin');
  expect(await textOf(emptyNight)).toBe(`Night insulin ${NOT_LOGGED_YET}`);
  await expect(emptyNight.locator(DATA_ENTRY)).toHaveCount(0);

  // A past date has a tomorrow, so the control that was refused on today is usable here.
  await expect(phone.getByRole('button', { name: 'Next day' })).toBeEnabled();

  expect(await scrollsHorizontally(phone)).toBe(false);
});
