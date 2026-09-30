import { test, expect, type Browser, type Locator, type Page } from '@playwright/test';
import { startLocalStack, type LocalStack } from '../support/local-stack';
import { createAccounts, removeAccounts, type Account, type SeededAccounts } from '../support/accounts';

/**
 * Public oracle for value 3: recording a meal.
 *
 * Observation: the person records a meal with slot, time, one or more foods (name, type
 * from the fixed list, amount, unit), glucose before, rapid-acting units, exercise
 * context, note and optionally glucose after; it appears on Today and can be edited
 * later to add the after reading.
 *
 * The oracle drives the built static bundle in a real browser against the Supabase CLI
 * local stack, like every earlier value, so what Today shows after a save is what
 * Postgres actually holds and gave back through real row-level security -- never what
 * the form believed it wrote.
 *
 * It deliberately judges the recording through the SAVED CARD rather than through the
 * form's widgets: that the dinner slot was pre-chosen, that the two foods and their
 * amounts were written, that the dose and the before reading were written, and that the
 * edit updated one row instead of writing a second.
 *
 * Adding a food takes one step more than it once did: a food is not created as a side
 * effect of saving a meal, so a name the person has never eaten is typed, the offer
 * reading 'Create "<name>"' is pressed, and only then is the type asked for. That gate
 * is the single change to this flow; everything else this oracle judges is unchanged.
 *
 * Every field is located by its EXACT label -- 'Slot', 'Time', 'Glucose before',
 * 'Rapid-acting units', 'Exercise', 'Note', 'Glucose after' on the meal form and 'Food
 * name', 'Type', 'Amount', 'Unit' on the Add food screen -- 'Food name' and not 'Food',
 * so it cannot be confused with the 'Foods' heading of the list it adds to. Never by a
 * loose word or an
 * alternation. A pattern like /units|dose/i is unique only by accident of what exists
 * today: value 5 puts 'Decrease dose' and 'Increase dose' beside the dose field, and the
 * pattern would then resolve to three elements and fail against a correct product. On one
 * screen a label and a control name must be distinguishable by exact match, and this
 * oracle asserts through that exact match so it keeps its meaning for the whole delivery.
 */

const PHONE_VIEWPORT = { width: 360, height: 780 } as const;

/** This spec's own email prefix: it removes these accounts and their rows, and nothing else. */
const EMAIL_PREFIX = 'record-a-meal';

const NOT_LOGGED_YET = 'Not logged yet';
const NO_FOOD_REFUSAL = 'Add at least one food.';

let stack: LocalStack;
let accounts: SeededAccounts;

test.describe.configure({ mode: 'serial' });
test.use({ viewport: PHONE_VIEWPORT });

test.beforeAll(async () => {
  test.setTimeout(10 * 60 * 1000);
  stack = await startLocalStack();
  // Account A owns nothing: the whole observation is that recording is what brings a
  // meal into existence, so a seeded meal would hide a form that writes nothing.
  accounts = await createAccounts(stack, EMAIL_PREFIX);
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

/**
 * Opens the form from a 'Not logged yet' card. The card is the way to log that slot; it
 * may be a button itself or carry one, and which of those it is is a presentation
 * choice, so either is accepted. That the slot came through pre-chosen is judged later,
 * on the saved card, which is the claim that actually matters.
 */
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

const save = (page: Page): Promise<void> => page.getByRole('button', { name: /^save$/i }).click();

/**
 * Chooses a named option from whichever control offers it: a segmented control of
 * buttons, a radio group, or a select. The brief fixes the option names -- 'Before
 * meal', 'Mixed dish', 'g' -- and leaves the widget to the design, so the oracle
 * names the option and not the widget.
 */
const chooseOption = async (scope: Page | Locator, name: string): Promise<void> => {
  const exact = new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');

  const radio = scope.getByRole('radio', { name: exact });
  if ((await radio.count()) > 0) {
    await radio.first().check();
    return;
  }

  const select = scope.locator('select');
  for (let index = 0; index < (await select.count()); index += 1) {
    const candidate = select.nth(index);
    const labels = await candidate.locator('option').allInnerTexts();
    const match = labels.find((label) => exact.test(label.trim()));
    if (match !== undefined) {
      await candidate.selectOption({ label: match });
      return;
    }
  }

  const button = scope.getByRole('button', { name: exact });
  if ((await button.count()) > 0) {
    await button.first().click();
    return;
  }

  throw new Error(`no control offers the option '${name}'`);
};

type Food = {
  readonly name: string;
  readonly type: string;
  readonly amount: string;
  readonly unit: string;
};

/**
 * Adds one food the person has NEVER eaten through the Add food screen: the name is
 * typed, the offer reading 'Create "<name>"' is pressed, and the type is then chosen,
 * followed by an amount and a unit.
 *
 * The create step is not ceremony this oracle could skip. A food must not enter the
 * catalogue as a side effect of saving a meal, so the type is asked for only once the
 * person has said this name is a food of theirs -- which means an oracle that filled
 * the name and reached straight for 'Type' would find no such control on a correct
 * product. A food the person HAS eaten is chosen from the offers instead and asks for
 * no type at all; this value's meals are all first-time foods, so every one is created.
 */
const createFood = (name: string): string => `Create "${name}"`;

const addFood = async (page: Page, food: Food): Promise<void> => {
  await page.getByRole('button', { name: /add food/i }).click();

  await page.getByLabel('Food name', { exact: true }).fill(food.name);

  // Nothing becomes a food on its own: this press is what asks for one, and it is
  // what reveals the type chooser below.
  await page.getByRole('button', { name: createFood(food.name), exact: true }).click();

  await chooseOption(page, food.type);
  await page.getByLabel('Amount', { exact: true }).fill(food.amount);
  await chooseOption(page, food.unit);

  await save(page);

  // Back on the meal form with the food in its list, which is the only proof the
  // Add food screen handed the food back rather than dropping it.
  await expect(page.getByText(food.name).first()).toBeVisible();
};

test('a meal is recorded from an empty slot, shows on Today, and reopens to take the after reading', async ({
  browser,
}) => {
  const phone = await openPhone(browser);
  await signIn(phone, accounts.owner);

  // Nothing is recorded yet: three fixed slots, all unlogged.
  for (const slot of ['Breakfast', 'Lunch', 'Dinner']) {
    expect(await textOf(await card(phone, slot)), `${slot} starts unlogged`).toContain(
      NOT_LOGGED_YET,
    );
  }

  // --- Recording the dinner -------------------------------------------------

  await logFromEmptyCard(phone, 'Dinner');

  await phone.getByLabel('Time', { exact: true }).fill('19:10');
  await phone.getByLabel('Glucose before', { exact: true }).fill('150');

  await addFood(phone, { name: 'Chicken rice', type: 'Mixed dish', amount: '250', unit: 'g' });
  await addFood(phone, { name: 'Cucumber salad', type: 'Vegetable', amount: '80', unit: 'g' });

  await phone.getByLabel('Rapid-acting units', { exact: true }).fill('6');
  await chooseOption(phone, 'Before meal');
  await phone.getByLabel('Note', { exact: true }).fill('walked home');

  // No after reading: the person has only just eaten, and the product must still
  // record what they ate.
  await save(phone);

  // --- Today shows what the store holds ------------------------------------

  const dinner = await card(phone, 'Dinner');
  const dinnerText = await textOf(dinner);
  for (const fragment of ['19:10', 'Chicken rice 250 g · Cucumber salad 80 g', '6 u', '150']) {
    expect(dinnerText, `the Dinner card must read ${fragment}`).toContain(fragment);
  }

  // A change that has not happened must not be drawn, as zero or as anything else.
  await expect(
    dinner.locator('[data-change-band]'),
    'no change band before an after reading exists',
  ).toHaveCount(0);

  // Everything on the card is the account's own recorded data.
  const recorded = (await dinner.locator('[data-entry]').allInnerTexts())
    .join(' | ')
    .replace(/\s+/g, ' ');
  for (const fragment of ['19:10', 'Chicken rice 250 g · Cucumber salad 80 g', '6 u', '150']) {
    expect(recorded, `${fragment} carries data-entry`).toContain(fragment);
  }

  // The slots that were not recorded are untouched: the save wrote one meal, not three.
  expect(await textOf(await card(phone, 'Breakfast'))).toContain(NOT_LOGGED_YET);
  expect(await textOf(await card(phone, 'Lunch'))).toContain(NOT_LOGGED_YET);

  expect(await scrollsHorizontally(phone)).toBe(false);

  // --- Reopening it later to add the after reading -------------------------

  await phone.getByRole('button', { name: 'Edit dinner' }).click();

  await expect(phone.getByRole('heading', { name: /^edit meal$/i })).toBeVisible();

  // The recorded values are in place, so a later edit cannot quietly drop what was
  // already written.
  await expect(phone.getByLabel('Glucose before', { exact: true })).toHaveValue('150');
  await expect(phone.getByLabel('Time', { exact: true })).toHaveValue(/19:10/);
  await expect(phone.getByLabel('Rapid-acting units', { exact: true })).toHaveValue('6');
  await expect(phone.getByLabel('Note', { exact: true })).toHaveValue('walked home');

  const form = await textOf(phone.locator('body'));
  for (const fragment of ['Chicken rice', 'Cucumber salad', 'Before meal']) {
    expect(form, `the reopened meal still reads ${fragment}`).toContain(fragment);
  }
  // The food types are part of the recording and come back with it.
  expect(form.toLowerCase(), 'the reopened foods keep their types').toContain('mixed dish');
  expect(form.toLowerCase(), 'the reopened foods keep their types').toContain('vegetable');

  // The after reading is what this edit came back for, so it sits directly below the
  // before: no other field comes between the two, and Exercise and the Note come after it.
  const fieldTop = async (label: string): Promise<number> => {
    const box = await phone.getByLabel(label, { exact: true }).boundingBox();
    if (box === null) throw new Error(`${label} has no box`);
    return box.y;
  };
  const beforeTop = await fieldTop('Glucose before');
  const afterTop = await fieldTop('Glucose after');
  expect(afterTop, 'Glucose after is below Glucose before').toBeGreaterThan(beforeTop);
  for (const label of ['Rapid-acting units', 'Note', 'Time']) {
    const top = await fieldTop(label);
    expect(
      top < beforeTop || top > afterTop,
      `${label} does not sit between the before and after readings`,
    ).toBe(true);
  }
  const exerciseTop = (await phone.getByRole('group', { name: /^exercise$/i }).boundingBox())?.y;
  expect(exerciseTop, 'Exercise comes after the after reading').toBeGreaterThan(afterTop);
  expect(await fieldTop('Note'), 'the Note comes after the after reading').toBeGreaterThan(afterTop);

  await phone.getByLabel('Glucose after', { exact: true }).fill('182');
  await save(phone);

  // The same single dinner, updated: adding the after reading must not produce a
  // second meal on the date.
  const edited = await card(phone, 'Dinner');
  const editedText = await textOf(edited);
  for (const fragment of ['19:10', 'Chicken rice 250 g · Cucumber salad 80 g', '6 u', '150', '182']) {
    expect(editedText, `the edited Dinner card must read ${fragment}`).toContain(fragment);
  }

  // 182 − 150 is +32. The brief puts stable at −39 to +30 and rose at +31 to +60, so
  // +32 is rose. The boundary is read off the brief rather than guessed: an oracle
  // that named the neighbouring band would let a wrong band rule pass as correct.
  const change = edited.locator('[data-change-band]');
  await expect(change, 'the edited card publishes one change band').toHaveCount(1);
  await expect(change).toHaveAttribute('data-change-band', 'rose');
  expect(await textOf(change), 'the change is signed').toContain('+32');

  expect(await scrollsHorizontally(phone)).toBe(false);

  // --- A meal with no food is refused, in place, writing nothing -----------

  await logFromEmptyCard(phone, 'Breakfast');
  await save(phone);

  await expect(phone.getByText(NO_FOOD_REFUSAL)).toBeVisible();

  // Refused in place: the form is still on screen with its fields, so nothing the
  // person typed was thrown away by the refusal.
  await expect(phone.getByLabel('Glucose before', { exact: true })).toBeVisible();
  await expect(phone.getByLabel('Time', { exact: true })).toBeVisible();

  await phone.getByRole('button', { name: /^cancel$/i }).click();

  // Today gains no card: the refusal wrote nothing at all.
  expect(await textOf(await card(phone, 'Breakfast'))).toContain(NOT_LOGGED_YET);
  expect(await textOf(await card(phone, 'Lunch'))).toContain(NOT_LOGGED_YET);
  expect(await textOf(await card(phone, 'Dinner'))).toContain('Chicken rice 250 g');

  // And the store agrees, not just the screen: a reload re-reads the date and finds
  // exactly one dinner and no breakfast.
  await phone.reload();
  expect(await textOf(await card(phone, 'Dinner'))).toContain('Chicken rice 250 g · Cucumber salad 80 g');
  expect(await textOf(await card(phone, 'Breakfast'))).toContain(NOT_LOGGED_YET);

  expect(await scrollsHorizontally(phone)).toBe(false);
});
