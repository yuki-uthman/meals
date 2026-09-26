import { test, expect, type Browser, type Locator, type Page } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { startLocalStack, type LocalStack } from '../support/local-stack';
import { createAccounts, removeAccounts, type Account, type SeededAccounts } from '../support/accounts';

/**
 * Public oracle for value 8: the expected-after estimate.
 *
 * Observation: while logging again, as soon as the before reading is typed the entry shows
 * an expected after reading equal to before plus the change of the most recent entry with
 * the same foods, the same slot and the same dose; changing slot or dose to one with no
 * such entry removes the estimate and says why.
 *
 * The oracle drives the built static bundle in a real browser against the Supabase CLI
 * local stack, as every earlier value does, so the history the estimate is computed from
 * is what Postgres actually gave back under real row-level security.
 *
 * The seeded history is built so that a wrong rule cannot pass by accident. Four dinners
 * and a lunch share the same foods: the estimate must pick the seven-day-old dinner at
 * 6 u and NOT the fourteen-day-old one (older at the same dose), NOT the ten-day-old one
 * (another dose), NOT the three-day-old one (no after reading, so no change was ever
 * measured), and NOT the lunch (another slot). Each of those four is a distinct way of
 * being wrong, and each would show a different number.
 *
 * Fields are located by their EXACT labels, as every form oracle here does, because a
 * loose pattern resolves to the stepper and pad controls beside them.
 */

const PHONE_VIEWPORT = { width: 360, height: 780 } as const;

/** This spec's own email prefix: it removes these accounts and their rows, and nothing else. */
const EMAIL_PREFIX = 'expected-after';

const LOG_AGAIN = /log again with these foods/i;

const NO_READING = 'Type your reading before eating to see an estimate.';
const NO_DOSE = 'Enter the dose to see an estimate.';
const NO_DINNER_AT_7 = 'No dinner at 7 u. Most recent was 6 u (+32).';
const NO_BREAKFAST = 'No breakfast on record with these foods.';

let stack: LocalStack;
let accounts: SeededAccounts;
/** The day the basis dinner was eaten: seven days before today in the browser's local terms. */
let basisDay: Date;

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

type SeededMeal = {
  readonly slot: 'breakfast' | 'lunch' | 'dinner';
  readonly daysAgo: number;
  readonly hour: number;
  readonly minute: number;
  readonly units: number;
  readonly before: number;
  /** Absent means the meal was never measured afterwards, so it has no change at all. */
  readonly after?: number;
};

/**
 * Every seeded meal carries the SAME foods -- Chicken rice mixed dish 250 g and Cucumber
 * salad vegetable 80 g -- so that value 6's identity rule pairs them all and the only
 * things that separate them are the slot, the dose, the date and whether an after reading
 * was ever taken. Those are exactly the four discriminations this value is judged on.
 */
const seedMeal = async (
  admin: SupabaseClient,
  owner: Account,
  today: Date,
  meal: SeededMeal,
): Promise<void> => {
  const day = daysBefore(today, meal.daysAgo);
  const inserted = await admin
    .from('meals')
    .insert({
      user_id: owner.id,
      slot: meal.slot,
      // Selected on eaten_on, never on eaten_at, so a seeded row cannot drift into the
      // neighbouring day when the server's offset is not the phone's.
      eaten_on: localDateOnly(day),
      eaten_at: localTime(day, meal.hour, meal.minute),
      glucose_before: meal.before,
      glucose_after: meal.after ?? null,
      insulin_units: meal.units,
    })
    .select('id')
    .single();
  if (inserted.error || !inserted.data) {
    throw new Error(
      `could not seed the ${meal.slot} ${meal.daysAgo} days ago: ${
        inserted.error?.message ?? 'no row returned'
      }`,
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
    throw new Error(`could not seed that meal's foods: ${foods.error.message}`);
  }
};

test.beforeAll(async () => {
  test.setTimeout(10 * 60 * 1000);
  stack = await startLocalStack();
  accounts = await createAccounts(stack, EMAIL_PREFIX);

  const admin = createClient(stack.supabaseUrl, stack.serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  basisDay = daysBefore(accounts.date, 7);

  // The one the estimate must be built from: the most recent dinner at 6 u with both
  // readings, change +32.
  await seedMeal(admin, accounts.owner, accounts.date, {
    slot: 'dinner',
    daysAgo: 7,
    hour: 19,
    minute: 5,
    units: 6,
    before: 110,
    after: 142,
  });
  // Same slot, same dose, but OLDER: choosing it would give 180 instead of 182.
  await seedMeal(admin, accounts.owner, accounts.date, {
    slot: 'dinner',
    daysAgo: 14,
    hour: 19,
    minute: 10,
    units: 6,
    before: 120,
    after: 150,
  });
  // Same slot, ANOTHER dose: the basis at 8 u, change −24.
  await seedMeal(admin, accounts.owner, accounts.date, {
    slot: 'dinner',
    daysAgo: 10,
    hour: 19,
    minute: 20,
    units: 8,
    before: 145,
    after: 121,
  });
  // The most recent dinner at 6 u by date, but it has NO after reading, so it measured no
  // change and must be skipped rather than treated as a change of zero.
  await seedMeal(admin, accounts.owner, accounts.date, {
    slot: 'dinner',
    daysAgo: 3,
    hour: 19,
    minute: 30,
    units: 6,
    before: 130,
  });
  // Same foods and same dose, ANOTHER slot: choosing it would give 200.
  await seedMeal(admin, accounts.owner, accounts.date, {
    slot: 'lunch',
    daysAgo: 5,
    hour: 12,
    minute: 55,
    units: 6,
    before: 100,
    after: 150,
  });
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

/**
 * Opens a meal's detail from its card body, the way value 6 established, and does not
 * return until the detail is on screen: opening reads the meal by id and then its history,
 * so a caller reading straight after the click would be reading the day log.
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

/** The panel this value adds, named for what it reports and for nothing else. */
const panel = (page: Page): Locator => page.getByRole('region', { name: /^expected after$/i });

/** The estimated number, which carries the change band of the change it is built from. */
const estimate = (page: Page): Locator => panel(page).locator('[data-change-band]');

test('the expected-after estimate reports one matching occasion, and says why when there is none', async ({
  browser,
}) => {
  const phone = await openPhone(browser);
  await signIn(phone, accounts.owner);

  // --- Reaching a fresh entry with these foods in it ------------------------

  for (let step = 0; step < 7; step += 1) {
    await phone.getByRole('button', { name: /^previous day$/i }).click();
  }
  await openDetail(phone, 'Dinner');
  await phone.getByRole('button', { name: LOG_AGAIN }).click();
  await expect(phone.getByRole('heading', { name: /^new meal$/i })).toBeVisible();

  const before = phone.getByLabel('Glucose before', { exact: true });
  const after = phone.getByLabel('Glucose after', { exact: true });
  const dose = phone.getByLabel('Rapid-acting units', { exact: true });

  // --- No before reading yet ------------------------------------------------

  // The panel is present from the start and says what it is waiting for. A blank panel
  // would read as 'nothing has ever happened', which is the opposite of the truth here.
  await expect(panel(phone), 'the panel is labelled Expected after').toHaveCount(1);
  await expect(panel(phone)).toContainText(NO_READING);
  await expect(estimate(phone), 'no number without a starting point').toHaveCount(0);

  // --- A before reading but no dose -----------------------------------------

  await before.fill('150');
  await expect(panel(phone)).toContainText(NO_DOSE);
  await expect(estimate(phone), 'no number until the person has chosen a dose').toHaveCount(0);

  // --- The dose the matching occasion was taken at --------------------------

  await dose.fill('6');

  // 150 + 32 = 182, the before reading plus the change of the seven-day-old dinner.
  // Each of the other four seeded meals would give a different number: 180 from the
  // older 6 u dinner, 126 from the 8 u dinner, 150 from treating the unmeasured dinner
  // as no change, 200 from the lunch.
  await expect(estimate(phone), 'before plus the matching change').toHaveText('182');
  await expect(
    estimate(phone),
    'the estimate carries the band of the change it is built from',
  ).toHaveAttribute('data-change-band', 'rose');

  // The estimate names the one recorded occasion it came from, or it would read as a
  // prediction the app had made up.
  const sourced = await textOf(panel(phone));
  for (const fragment of ['6 u', '110', '142', '+32']) {
    expect(sourced, `the panel names its source: ${fragment}`).toContain(fragment);
  }
  expect(sourced, "the panel names the source's date").toContain(String(basisDay.getDate()));

  // It reports; it never proposes. This product never recommends a dose, and a panel
  // that called itself a suggestion would be doing exactly that whatever it computed.
  expect(sourced.toLowerCase(), 'the panel never proposes').not.toMatch(
    /suggest|recommend|target|should take/,
  );
  await expect(after, 'the estimate is never written into the after reading').toHaveValue('');

  // --- Another dose that also has a match -----------------------------------

  await dose.fill('8');

  // 150 + (−24) = 126, from the ten-day-old dinner. The panel is live: no save, no
  // reopening, just the dose changing.
  await expect(estimate(phone), 'the panel recomputes when the dose changes').toHaveText('126');
  await expect(estimate(phone)).toHaveAttribute('data-change-band', 'stable');
  const atEight = await textOf(panel(phone));
  for (const fragment of ['8 u', '145', '121', '−24']) {
    expect(atEight, `the panel names its source: ${fragment}`).toContain(fragment);
  }

  // --- A dose with no match at all ------------------------------------------

  await dose.fill('7');

  // A dose is part of the match, not a tolerance: 7 u is not 6 u, so there is no number
  // -- but the panel still says what IS on record, so the person can see why.
  await expect(estimate(phone), 'no number at a dose never taken with these foods').toHaveCount(0);
  await expect(panel(phone)).toContainText(NO_DINNER_AT_7);

  // --- A slot with no match at all ------------------------------------------

  await phone.getByRole('radio', { name: /^breakfast$/i }).click();

  await expect(estimate(phone), 'no number in a slot these foods were never eaten in').toHaveCount(
    0,
  );
  await expect(panel(phone)).toContainText(NO_BREAKFAST);

  // --- The before reading cleared -------------------------------------------

  await phone.getByRole('radio', { name: /^dinner$/i }).click();
  await dose.fill('6');
  await expect(estimate(phone), 'the estimate is back once slot and dose match again').toHaveText(
    '182',
  );

  await before.fill('');
  await expect(panel(phone)).toContainText(NO_READING);
  await expect(estimate(phone), 'an estimate without a starting point is meaningless').toHaveCount(
    0,
  );

  await expect(after, 'the after reading was never filled in by the panel').toHaveValue('');
  expect(await scrollsHorizontally(phone)).toBe(false);
});
