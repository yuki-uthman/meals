import { test, expect, type Browser, type Locator, type Page } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { startLocalStack, type LocalStack } from '../support/local-stack';
import { createAccounts, removeAccounts, type Account, type SeededAccounts } from '../support/accounts';

/**
 * Public oracle for value 6: the meal detail and every instance of the same foods.
 *
 * Observation: opening a meal shows its foods with amounts, the dose, before to after
 * with the change, the note, and below that every instance with the same foods, newest
 * first, each as dose, before to after and change, with the instance being viewed marked.
 *
 * The oracle drives the built static bundle in a real browser against the Supabase CLI
 * local stack, like every earlier value, so the instance list is what Postgres gave back
 * through real row-level security rather than a fixture in the page.
 *
 * It judges the 'same foods' rule at the surface: a dinner of different foods and a
 * dinner differing only by an amount are both seeded, and neither may appear. Bands are
 * asserted by NAME, never by colour, because a band is the rule under test.
 */

const PHONE_VIEWPORT = { width: 360, height: 780 } as const;

/** This spec's own email prefix: it removes these accounts and their rows, and nothing else. */
const EMAIL_PREFIX = 'meal-detail';

const NOTE = 'Ate slowly, 20 min walk afterwards.';
const INSTANCES_HEADING = 'Every time you ate this · 4';

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

const daysBefore = (day: Date, count: number): Date =>
  new Date(day.getFullYear(), day.getMonth(), day.getDate() - count);

type SeedFood = {
  readonly name: string;
  readonly foodType: string;
  readonly amount: number;
  readonly unit: string;
};

type SeedMeal = {
  readonly day: Date;
  readonly hour: number;
  readonly minute: number;
  readonly before: number;
  readonly after: number;
  readonly units: number;
  readonly note?: string;
  readonly foods: readonly SeedFood[];
};

/** The two foods every instance of 'this meal' is made of. Identity ignores the type. */
const THE_FOODS: readonly SeedFood[] = [
  { name: 'Chicken rice', foodType: 'mixed dish', amount: 250, unit: 'g' },
  { name: 'Cucumber salad', foodType: 'vegetable', amount: 80, unit: 'g' },
];

const seedDinner = async (
  admin: SupabaseClient,
  owner: Account,
  meal: SeedMeal,
): Promise<void> => {
  const inserted = await admin
    .from('meals')
    .insert({
      user_id: owner.id,
      slot: 'dinner',
      // Selected on eaten_on, never on eaten_at, so a late row cannot drift into the
      // neighbouring day when the server's offset is not the phone's.
      eaten_on: localDateOnly(meal.day),
      eaten_at: localTime(meal.day, meal.hour, meal.minute),
      glucose_before: meal.before,
      glucose_after: meal.after,
      insulin_units: meal.units,
      ...(meal.note === undefined ? {} : { note: meal.note }),
    })
    .select('id')
    .single();
  if (inserted.error || !inserted.data) {
    throw new Error(
      `could not seed a dinner on ${localDateOnly(meal.day)}: ${inserted.error?.message ?? 'no row returned'}`,
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
    throw new Error(`could not seed that dinner's foods: ${foods.error.message}`);
  }
};

test.beforeAll(async () => {
  test.setTimeout(10 * 60 * 1000);
  stack = await startLocalStack();
  accounts = await createAccounts(stack, EMAIL_PREFIX);

  const admin = createClient(stack.supabaseUrl, stack.serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const today = accounts.date;

  // The four instances of the same two foods. Seeded oldest-last on purpose: the order
  // rows are written in must not be the order the list reads in.
  await seedDinner(admin, accounts.owner, {
    day: today,
    hour: 19,
    minute: 5,
    before: 110,
    after: 142,
    units: 6,
    note: NOTE,
    foods: THE_FOODS,
  });
  await seedDinner(admin, accounts.owner, {
    day: daysBefore(today, 7),
    hour: 19,
    minute: 30,
    before: 145,
    after: 121,
    units: 8,
    foods: THE_FOODS,
  });
  await seedDinner(admin, accounts.owner, {
    day: daysBefore(today, 30),
    hour: 18,
    minute: 45,
    before: 122,
    after: 178,
    units: 5,
    foods: THE_FOODS,
  });
  await seedDinner(admin, accounts.owner, {
    day: daysBefore(today, 36),
    hour: 20,
    minute: 10,
    before: 168,
    after: 120,
    units: 7,
    foods: THE_FOODS,
  });

  // A dinner of different foods entirely: it must not be gathered in.
  await seedDinner(admin, accounts.owner, {
    day: daysBefore(today, 3),
    hour: 19,
    minute: 0,
    before: 150,
    after: 110,
    units: 4,
    foods: [{ name: 'Soup', foodType: 'mixed dish', amount: 300, unit: 'ml' }],
  });

  // The same two food NAMES, one of them at a different amount. Sameness is the multiset
  // of name, amount and unit, so 90 g is a different meal. Its dose and readings are
  // deliberately unlike every other row's, so its appearance is visible in the text and
  // not only in the count.
  await seedDinner(admin, accounts.owner, {
    day: daysBefore(today, 5),
    hour: 19,
    minute: 20,
    before: 200,
    after: 150,
    units: 9,
    foods: [
      { name: 'Chicken rice', foodType: 'mixed dish', amount: 250, unit: 'g' },
      { name: 'Cucumber salad', foodType: 'vegetable', amount: 90, unit: 'g' },
    ],
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

/** The instance section: the heading that counts, and one row per instance. */
const instanceSection = (page: Page): Locator =>
  page.getByRole('region', { name: /every time you ate this/i });

const instanceRows = (page: Page): Locator => instanceSection(page).getByRole('listitem');

test('opening a meal shows what was eaten and every instance of the same foods, newest first', async ({
  browser,
}) => {
  const phone = await openPhone(browser);
  await signIn(phone, accounts.owner);

  const dinner = await card(phone, 'Dinner');

  // The Edit control keeps the place and the name value 3 gave it: the card body
  // becoming a way in must not move it.
  await expect(dinner.getByRole('button', { name: /^edit dinner$/i })).toHaveCount(1);

  // The card's body carries the link into the detail.
  const intoDetail = dinner.getByRole('link').first();
  await expect(intoDetail, 'the dinner card body opens its detail').toHaveCount(1);
  await intoDetail.click();

  // The meal in hand: its slot, its time and its note.
  const detail = phone.getByRole('region', { name: /meal detail/i });
  const summary = await textOf(detail);
  expect(summary, 'the detail names the slot').toContain('Dinner');
  expect(summary, 'the detail names the time').toContain('19:05');
  expect(summary, 'the detail names the day of the month').toContain(
    String(accounts.date.getDate()),
  );
  expect(summary, 'the note is shown as written').toContain(NOTE);

  // The summary: the two readings, the dose, and the change with its band by name.
  for (const fragment of ['110', '142', '6 u']) {
    expect(summary, `the summary reads ${fragment}`).toContain(fragment);
  }
  const summaryChange = detail.locator('[data-change-band]').first();
  await expect(summaryChange).toHaveAttribute('data-change-band', 'rose');
  expect(await textOf(summaryChange), 'the summary change is signed').toContain('+32');

  // What was eaten: each food with its type and its amount.
  expect(summary, 'the food is named').toContain('Chicken rice');
  expect(summary, 'the food keeps its type').toContain('Mixed dish');
  expect(summary, 'the food keeps its amount').toContain('250 g');
  expect(summary).toContain('Cucumber salad');
  expect(summary).toContain('Vegetable');
  expect(summary).toContain('80 g');

  // The instance list: counted in the heading and exactly that many rows.
  await expect(
    phone.getByRole('heading', { name: INSTANCES_HEADING }),
  ).toBeVisible();
  await expect(instanceRows(phone), 'one row per instance of these foods').toHaveCount(4);

  const expected = [
    { dose: '6 u', before: '110', after: '142', change: '+32', band: 'rose' },
    { dose: '8 u', before: '145', after: '121', change: '−24', band: 'stable' },
    { dose: '5 u', before: '122', after: '178', change: '+56', band: 'rose' },
    { dose: '7 u', before: '168', after: '120', change: '−48', band: 'dropped' },
  ] as const;

  for (const [index, row] of expected.entries()) {
    const instance = instanceRows(phone).nth(index);
    const text = await textOf(instance);
    for (const fragment of [row.dose, row.before, row.after]) {
      expect(text, `instance ${index + 1} reads ${fragment}`).toContain(fragment);
    }
    expect(text, `instance ${index + 1} names its slot`).toContain('Dinner');

    const band = instance.locator('[data-change-band]');
    await expect(band, `instance ${index + 1} publishes one change band`).toHaveCount(1);
    await expect(band).toHaveAttribute('data-change-band', row.band);
    expect(await textOf(band), `instance ${index + 1}'s change is signed`).toContain(row.change);
  }

  // Exactly one row is marked, and it is the one being viewed: the first, which is
  // today's 6 u meal.
  const marked = instanceRows(phone).filter({ hasText: /viewing/i });
  await expect(marked, 'exactly one row is marked as being viewed').toHaveCount(1);
  expect(await textOf(marked.first()), 'the marked row is the meal in hand').toContain('6 u');
  expect(await textOf(instanceRows(phone).nth(0))).toContain('viewing');

  // Sameness is the multiset of name, amount and unit. A dinner of other foods and a
  // dinner differing only by an amount are both other meals.
  const listText = await textOf(instanceSection(phone));
  expect(listText, 'the Soup dinner is a different meal').not.toContain('Soup');
  for (const fragment of ['9 u', '200', '150']) {
    expect(listText, `the 90 g dinner is a different meal: ${fragment}`).not.toContain(fragment);
  }

  expect(await scrollsHorizontally(phone)).toBe(false);
});

test('the detail offers an Edit control, so a meal is read first and corrected on purpose', async ({
  browser,
}) => {
  const phone = await openPhone(browser);
  await signIn(phone, accounts.owner);

  await (await card(phone, 'Dinner')).getByRole('link').first().click();
  const detail = phone.getByRole('region', { name: /meal detail/i });
  await expect(detail).toBeVisible();

  // One Edit control, named for the meal's slot as the card's is.
  const edit = phone.getByRole('button', { name: /^edit dinner$/i });
  await expect(edit, 'the detail carries exactly one Edit control').toHaveCount(1);
  await expect(edit, 'the pill reads Edit alone; the slot is in its accessible name').toHaveText('Edit');

  // It is a pill ON the meal's card, at its top right: inside the detail region, on the
  // same row as the slot label, and against the card's right edge -- not a row of its own.
  await expect(detail.getByRole('button', { name: /^edit dinner$/i }), 'Edit is on the card').toHaveCount(1);
  const box = await detail.boundingBox();
  const pill = await edit.boundingBox();
  const slot = await detail.getByText('Dinner', { exact: true }).boundingBox();
  if (box === null || pill === null || slot === null) throw new Error('the card, pill or slot has no box');
  expect(pill.y, 'the pill shares the slot label row').toBeLessThan(slot.y + slot.height);
  expect(pill.y + pill.height, 'the pill shares the slot label row').toBeGreaterThan(slot.y);
  expect(pill.x, 'the pill is to the right of the slot label').toBeGreaterThan(slot.x + slot.width);
  expect(box.x + box.width - (pill.x + pill.width), 'the pill sits at the right edge').toBeLessThan(32);
  const radius = await edit.evaluate((node) => parseFloat(getComputedStyle(node).borderTopLeftRadius));
  expect(radius, 'the pill has fully rounded ends').toBeGreaterThanOrEqual(pill.height / 2);

  await edit.click();

  // It opens this meal's EDIT form with its own readings in place.
  await expect(phone.getByText(/edit meal/i)).toBeVisible();
  await expect(phone.getByLabel('Glucose before', { exact: true })).toHaveValue('110');
  await expect(phone.getByLabel('Glucose after', { exact: true })).toHaveValue('142');

  // Leaving the form without saving returns to the detail it was opened from.
  await phone.getByRole('button', { name: /^cancel$/i }).click();
  await expect(detail, 'Cancel returns to the detail').toBeVisible();
  await expect(detail).toContainText('Chicken rice');

  expect(await scrollsHorizontally(phone)).toBe(false);
});
