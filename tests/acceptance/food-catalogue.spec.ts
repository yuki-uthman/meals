import { test, expect, type Browser, type Locator, type Page } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { startLocalStack, type LocalStack } from '../support/local-stack';
import { createAccounts, removeAccounts, type SeededAccounts, type Account } from '../support/accounts';

/**
 * Public oracle for value 14: a food is a record of its own.
 *
 * Observation: in Add food, typing a name lists the person's own foods that match and lets
 * one be chosen, which fills in its type; a name that matches nothing offers to create that
 * food, and a food created once never has to be typed again.
 *
 * As in every earlier value the oracle drives the built static bundle in a real browser
 * against the Supabase CLI local stack, so the catalogue it reads is what Postgres held and
 * gave back through real row-level security -- never a list the screen kept to itself.
 *
 * The claims this oracle is built around:
 *
 *  - Typing a few letters lists the account's OWN matching foods, each naming the food and
 *    its type, and choosing one fills the name and takes the type, with the type chooser not
 *    shown at all: the type is a property of the food and is already answered.
 *  - A name that matches nothing offers a control reading Create "Lentil soup", and pressing
 *    it -- not saving the meal, and never silently -- is what reveals the type chooser.
 *  - A food created once is offered the next time its first letters are typed. The stimulus
 *    asks this after the meal is saved, so that is what is asserted here; a food created and
 *    then abandoned is a stronger claim the declared stimulus does not make and this oracle
 *    does not invent.
 *  - A name differing only in CASE does not create a second entry. 'CHICKEN RICE' is not the
 *    stored 'Chicken rice' character for character, so the create control is offered for it,
 *    and the attempt is then refused with 'You already have that food.' because the account is
 *    unique on the NORMALISED name. That is the only way this refusal is reachable through the
 *    public port, and it is exactly the distinction the design draws between the exact match
 *    that decides the offer and the normalised match that decides identity. The attempt
 *    deliberately chooses a DIFFERENT type, so 'nothing is written' can be judged: the food
 *    must still be listed as Mixed dish afterwards.
 *  - A creation with no type is refused with 'Choose a type for this food.' and writes
 *    nothing, which is judged by typing the name again and finding no such food offered.
 *  - Neither account's catalogue reaches the other, judged in both directions.
 *  - No existing meal changes: the meal seeded three days ago still reads 'Chicken rice 250 g'
 *    and still carries its recorded type, even though the same food is now eaten at 300 g.
 *
 * Widgets are located tolerantly where the design leaves them to presentation and strictly
 * where it does not. A match item is located by its ACCESSIBLE NAME, because a thing that can
 * be chosen must be exposed as a button, an option or a radio whatever it is drawn as, and
 * its name is where the food and its type are published. Fields are located by their EXACT
 * label -- 'Food name', 'Amount' -- as value 3 settled, never by a loose word.
 */

const PHONE_VIEWPORT = { width: 360, height: 780 } as const;

/** This spec's own email prefix: it removes these accounts and their rows, and nothing else. */
const EMAIL_PREFIX = 'food-catalogue';

const ALREADY_HAVE = 'You already have that food.';
const NEEDS_TYPE = 'Choose a type for this food.';

let stack: LocalStack;
let accounts: SeededAccounts;

test.describe.configure({ mode: 'serial' });
test.use({ viewport: PHONE_VIEWPORT });

// --- Seeding ----------------------------------------------------------------

const localDateOnly = (day: Date): string =>
  [
    String(day.getFullYear()).padStart(4, '0'),
    String(day.getMonth() + 1).padStart(2, '0'),
    String(day.getDate()).padStart(2, '0'),
  ].join('-');

const localTime = (day: Date, hour: number, minute: number): string =>
  new Date(day.getFullYear(), day.getMonth(), day.getDate(), hour, minute, 0, 0).toISOString();

const startOfLocalDay = (daysAgo: number): Date => {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysAgo);
};

const admin = (): SupabaseClient =>
  createClient(stack.supabaseUrl, stack.serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

/** One catalogue food for an account, returning its id so a meal can be linked to it. */
const seedFood = async (owner: Account, name: string, foodType: string): Promise<string> => {
  const created = await admin()
    .from('foods')
    .insert({ user_id: owner.id, name, food_type: foodType })
    .select('id')
    .single();
  if (created.error || !created.data) {
    throw new Error(`could not seed the food '${name}': ${created.error?.message ?? 'no row returned'}`);
  }
  return created.data.id as string;
};

/**
 * Account A's already-eaten meal: Chicken rice of type Mixed dish, 250 g, three days ago,
 * linked to the catalogue food of the same name. The meal carries its own name and type, as
 * it always has, and the link is what the migration establishes for rows that already exist.
 */
const seedPastMeal = async (owner: Account, foodId: string): Promise<void> => {
  const day = startOfLocalDay(3);
  const meal = await admin()
    .from('meals')
    .insert({
      user_id: owner.id,
      slot: 'dinner',
      eaten_on: localDateOnly(day),
      eaten_at: localTime(day, 19, 10),
      glucose_before: 140,
      glucose_after: 170,
      insulin_units: 5,
    })
    .select('id')
    .single();
  if (meal.error || !meal.data) {
    throw new Error(`could not seed the past meal: ${meal.error?.message ?? 'no row returned'}`);
  }

  const food = await admin().from('meal_foods').insert({
    user_id: owner.id,
    meal_id: meal.data.id,
    food_id: foodId,
    name: 'Chicken rice',
    food_type: 'mixed dish',
    amount: 250,
    unit: 'g',
    position: 1,
  });
  if (food.error) {
    throw new Error(`could not seed the past meal's food: ${food.error.message}`);
  }
};

test.beforeAll(async () => {
  test.setTimeout(10 * 60 * 1000);
  stack = await startLocalStack();
  accounts = await createAccounts(stack, EMAIL_PREFIX);

  const chickenRice = await seedFood(accounts.owner, 'Chicken rice', 'mixed dish');
  await seedPastMeal(accounts.owner, chickenRice);
  // Account B owns a food of its own, so 'neither account sees the other's' is judged in
  // both directions rather than only against an empty catalogue.
  await seedFood(accounts.stranger, 'Porridge', 'carb-heavy');
});

test.afterAll(async () => {
  if (stack) await removeAccounts(stack, EMAIL_PREFIX);
});

// --- Driving the phone ------------------------------------------------------

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

const bodyText = (page: Page): Promise<string> => textOf(page.locator('body'));

const scrollsHorizontally = (page: Page): Promise<boolean> =>
  page.evaluate(() => {
    const root = document.documentElement;
    return root.scrollWidth > root.clientWidth || document.body.scrollWidth > root.clientWidth;
  });

const save = (page: Page): Promise<void> => page.getByRole('button', { name: /^save$/i }).click();

const cancel = (page: Page): Promise<void> => page.getByRole('button', { name: /^cancel$/i }).click();

/** Opens New meal from a slot that has nothing logged, as value 3 established. */
const logFromEmptyCard = async (page: Page, slot: string): Promise<void> => {
  const empty = await card(page, slot);
  const inner = empty.getByRole('button');
  if ((await inner.count()) > 0) {
    await inner.first().click();
  } else {
    await empty.click();
  }
};

const openAddFood = (page: Page): Promise<void> =>
  page.getByRole('button', { name: /add food/i }).click();

const nameField = (page: Page): Locator => page.getByLabel('Food name', { exact: true });

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const exactly = (name: string): RegExp => new RegExp(`^${escapeRegExp(name)}$`, 'i');

/**
 * The foods the match list is offering, located by accessible name. A match item must carry
 * every fragment given -- the food's name, and its type where the design says the item names
 * it -- and must NOT be the create control, which carries the typed text too and is a
 * different offer entirely.
 */
const offered = (page: Page, fragments: readonly string[]): Locator => {
  const lookaheads = fragments.map((fragment) => `(?=.*${escapeRegExp(fragment)})`).join('');
  const pattern = new RegExp(`^(?!\\s*create\\b)${lookaheads}`, 'i');
  return page
    .getByRole('button', { name: pattern })
    .or(page.getByRole('option', { name: pattern }))
    .or(page.getByRole('radio', { name: pattern }))
    .or(page.getByRole('menuitem', { name: pattern }));
};

/** The control that offers to create the typed name, reading Create "Lentil soup". */
const createControl = (page: Page, typed: string): Locator => {
  const pattern = new RegExp(`^\\s*create\\b.*${escapeRegExp(typed)}`, 'i');
  return page
    .getByRole('button', { name: pattern })
    .or(page.getByRole('option', { name: pattern }))
    .or(page.getByRole('menuitem', { name: pattern }));
};

/**
 * How many controls offer this option by exact name. The brief fixes the option names --
 * 'Mixed dish', 'Vegetable', 'g' -- and leaves the widget to the design, so the oracle counts
 * the option and not the widget. Zero means the chooser is not on screen.
 */
const offersOption = async (page: Page, name: string): Promise<number> => {
  const pattern = exactly(name);
  const radios = await page.getByRole('radio', { name: pattern }).count();
  const buttons = await page.getByRole('button', { name: pattern }).count();
  let options = 0;
  const selects = page.locator('select');
  for (let index = 0; index < (await selects.count()); index += 1) {
    const labels = await selects.nth(index).locator('option').allInnerTexts();
    if (labels.some((label) => pattern.test(label.trim()))) options += 1;
  }
  return radios + buttons + options;
};

/** Chooses a named option from whichever control offers it, exactly as value 3's oracle does. */
const chooseOption = async (page: Page, name: string): Promise<void> => {
  const pattern = exactly(name);

  const radio = page.getByRole('radio', { name: pattern });
  if ((await radio.count()) > 0) {
    await radio.first().check();
    return;
  }

  const selects = page.locator('select');
  for (let index = 0; index < (await selects.count()); index += 1) {
    const candidate = selects.nth(index);
    const labels = await candidate.locator('option').allInnerTexts();
    const match = labels.find((label) => pattern.test(label.trim()));
    if (match !== undefined) {
      await candidate.selectOption({ label: match });
      return;
    }
  }

  const button = page.getByRole('button', { name: pattern });
  if ((await button.count()) > 0) {
    await button.first().click();
    return;
  }

  throw new Error(`no control offers the option '${name}'`);
};

test('a typed name offers the account\'s own foods, a chosen one brings its type, and a new one is created once', async ({
  browser,
}) => {
  const phone = await openPhone(browser);
  await signIn(phone, accounts.owner);

  // --- Choosing a food already recorded ------------------------------------

  await logFromEmptyCard(phone, 'Dinner');
  await openAddFood(phone);

  // An empty field offers the most recently used, and what it offers is this account's:
  // account B's Porridge is not reachable from here, and row-level security is the only
  // thing keeping it away.
  await expect(offered(phone, ['Chicken rice']), 'the catalogue is offered unprompted').toHaveCount(1);
  await expect(offered(phone, ['Porridge']), "account B's food is never offered").toHaveCount(0);
  expect(await bodyText(phone), "account B's food never reaches this page").not.toContain('Porridge');

  await nameField(phone).fill('chick');

  // One matching food, naming the food AND its type, and nothing that does not match.
  await expect(
    offered(phone, ['Chicken rice', 'Mixed dish']),
    "'chick' lists Chicken rice with its type",
  ).toHaveCount(1);
  await expect(offered(phone, ['Porridge'])).toHaveCount(0);

  await offered(phone, ['Chicken rice', 'Mixed dish']).first().click();

  // Choosing fills the name and takes the type, and the type is NOT asked for again.
  await expect(nameField(phone), 'choosing a food fills its name').toHaveValue('Chicken rice');
  expect((await bodyText(phone)).toLowerCase(), 'the chosen food shows its type').toContain(
    'mixed dish',
  );
  expect(
    await offersOption(phone, 'Vegetable'),
    'the type chooser is not shown at all once a food is chosen',
  ).toBe(0);

  // Only the amount is left to give: the point of the catalogue.
  await phone.getByLabel('Amount', { exact: true }).fill('300');
  await chooseOption(phone, 'g');
  await save(phone);
  await expect(phone.getByText('Chicken rice').first()).toBeVisible();

  // --- A name that matches nothing is created, once ------------------------

  await openAddFood(phone);
  await nameField(phone).fill('Lentil soup');

  await expect(offered(phone, ['Lentil soup']), "'Lentil soup' matches no food").toHaveCount(0);

  const create = createControl(phone, 'Lentil soup');
  await expect(create, 'a name matching nothing offers to create it').toHaveCount(1);
  await expect(create, 'the create control names the food in quotes').toHaveAccessibleName(
    /create\s*["'“‘]?Lentil soup["'”’]?/i,
  );

  // Nothing is created silently: pressing the control is what makes the food new, and only
  // then is a type asked for, because a food cannot enter the catalogue without one.
  await create.first().click();
  expect(
    await offersOption(phone, 'Mixed dish'),
    'pressing create reveals the type chooser',
  ).toBeGreaterThan(0);

  await chooseOption(phone, 'Mixed dish');
  await phone.getByLabel('Amount', { exact: true }).fill('200');
  await chooseOption(phone, 'ml');
  await save(phone);
  await expect(phone.getByText('Lentil soup').first()).toBeVisible();

  await save(phone);

  const dinner = await card(phone, 'Dinner');
  expect(await textOf(dinner), 'the meal records both foods with their amounts').toContain(
    'Chicken rice 300 g · Lentil soup 200 ml',
  );

  expect(await scrollsHorizontally(phone)).toBe(false);

  // --- Typed once, offered ever after --------------------------------------

  await logFromEmptyCard(phone, 'Lunch');
  await openAddFood(phone);
  await nameField(phone).fill('lentil');
  await expect(
    offered(phone, ['Lentil soup', 'Mixed dish']),
    'a food created once is offered the next time its first letters are typed',
  ).toHaveCount(1);

  // --- A name differing only in case is not a second food ------------------

  await nameField(phone).fill('CHICKEN RICE');
  const createShouty = createControl(phone, 'CHICKEN RICE');
  await expect(createShouty, 'a name not stored character for character offers creation').toHaveCount(
    1,
  );
  await createShouty.first().click();

  // A different type is chosen on purpose: if anything were written, the food would come back
  // as Vegetable, and it must come back as Mixed dish.
  await chooseOption(phone, 'Vegetable');
  await phone.getByLabel('Amount', { exact: true }).fill('250');
  await chooseOption(phone, 'g');
  await save(phone);

  await expect(phone.getByText(ALREADY_HAVE), 'the normalised name is already owned').toBeVisible();

  // Out of Add food, out of the meal form, and back in from Today: the list is re-read from
  // the store rather than from whatever the abandoned screen was holding.
  await cancel(phone);
  await cancel(phone);
  await logFromEmptyCard(phone, 'Lunch');
  await openAddFood(phone);
  await nameField(phone).fill('chicken');
  await expect(
    offered(phone, ['Chicken rice']),
    'no second entry for a name differing only in case',
  ).toHaveCount(1);
  await expect(
    offered(phone, ['Chicken rice', 'Mixed dish']),
    'the existing food kept its own type, so nothing was written',
  ).toHaveCount(1);

  // --- A food cannot be created without a type -----------------------------

  await nameField(phone).fill('Rye toast');
  await createControl(phone, 'Rye toast').first().click();
  await phone.getByLabel('Amount', { exact: true }).fill('100');
  await chooseOption(phone, 'g');
  await save(phone);

  await expect(phone.getByText(NEEDS_TYPE), 'a food must have a type').toBeVisible();
  // Refused in place: the name the person typed is still there to correct.
  await expect(nameField(phone)).toHaveValue('Rye toast');

  await cancel(phone);
  await cancel(phone);
  await logFromEmptyCard(phone, 'Lunch');
  await openAddFood(phone);
  await nameField(phone).fill('rye');
  await expect(offered(phone, ['Rye toast']), 'the refused food was not written').toHaveCount(0);
  await cancel(phone);
  await cancel(phone);

  expect(await scrollsHorizontally(phone)).toBe(false);

  // --- No existing meal lost or changed what it says was eaten -------------

  for (let step = 0; step < 3; step += 1) {
    await phone.getByRole('button', { name: /^previous day$/i }).click();
  }

  const past = await card(phone, 'Dinner');
  expect(
    await textOf(past),
    'the already-recorded meal still says what was eaten, at its own amount',
  ).toContain('Chicken rice 250 g');

  await phone.getByRole('button', { name: 'Edit dinner' }).click();
  const reopened = await bodyText(phone);
  expect(reopened, 'the recorded name is unchanged').toContain('Chicken rice');
  expect(reopened.toLowerCase(), 'the recorded type is unchanged').toContain('mixed dish');
  await cancel(phone);

  expect(await scrollsHorizontally(phone)).toBe(false);
});

test("one account's foods never reach another's Add food screen", async ({ browser }) => {
  const phone = await openPhone(browser);
  await signIn(phone, accounts.stranger);

  await logFromEmptyCard(phone, 'Dinner');
  await openAddFood(phone);

  // Account B's own catalogue is there, so an empty list would not be what is being proved.
  await expect(offered(phone, ['Porridge']), "account B is offered its own food").toHaveCount(1);

  await expect(offered(phone, ['Chicken rice'])).toHaveCount(0);
  await expect(offered(phone, ['Lentil soup'])).toHaveCount(0);

  for (const typed of ['chick', 'lentil']) {
    await nameField(phone).fill(typed);
    expect(
      await bodyText(phone),
      `account A's foods never reach account B on '${typed}'`,
    ).not.toMatch(/chicken rice|lentil soup/i);
  }

  expect(await scrollsHorizontally(phone)).toBe(false);
});
