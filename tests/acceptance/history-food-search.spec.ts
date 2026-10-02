import { test, expect, type Locator, type Page } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { startLocalStack, type LocalStack } from '../support/local-stack';
import { createAccounts, removeAccounts, type SeededAccounts } from '../support/accounts';

/**
 * Public oracle for the History grid's food search.
 *
 * Observation: History carries a search field. Typing into it offers the foods the record
 * holds in a list beneath it, and greys out every cell that does not hold the food -- and
 * that is ALL it does: no row, no cell and no month separator is added, moved or removed.
 *
 * The claims this oracle is built around:
 *
 *  - A meal matches when ANY of its foods contains what was typed, ignoring case and the
 *    spaces around it, so 'RICE ' finds 'Chicken rice', 'Fried rice' and 'Rice ball' -- the
 *    same rule Lookup's By food applies -- and does not find 'Porridge' or 'Toast'.
 *  - Every cell that does not hold the food is greyed out: the meals that do not hold it,
 *    the empty slots and the nights, on every day. Greying is read off the published
 *    data-dimmed attribute, never off a colour or an opacity.
 *  - The grid's layout does not change: the same day rows and month separators in the same
 *    order, every cell where it was, and the grid scrolled where it was.
 *  - As a food is typed, the foods the record holds whose names contain it are offered in a
 *    list, most recently eaten first; choosing one searches for it and closes the list. The
 *    list floats over the grid rather than pushing it down.
 *  - Enter puts the list away and keeps what was typed as the search, so a keyword -- a
 *    restaurant's name -- greys out every food that does not carry it.
 *  - A greyed cell is still a control, and opens what it opened before.
 *  - Typing redraws the grid and not the field: the caret stays where it was.
 *  - A food no day holds greys out every cell and offers nothing.
 *  - What was typed outlives a change of view and a trip to a meal and back.
 *  - Clearing the field greys out nothing again.
 */

const PHONE_VIEWPORT = { width: 360, height: 780 } as const;

/** This spec's own email prefix: it removes these accounts and their rows, and nothing else. */
const EMAIL_PREFIX = 'history-food-search';

/**
 * The field's accessible name. Spelled out rather than imported from the product, because
 * an oracle that borrowed the label from the code under test would agree with it however
 * the label were changed.
 */
const SEARCH_LABEL = 'Search history by food';

/** The column order the grid is read in: three meals, then that day's night. */
const BREAKFAST = 0;
const LUNCH = 1;
const DINNER = 2;
const NIGHT = 3;

let stack: LocalStack;
let accounts: SeededAccounts;

test.describe.configure({ mode: 'serial' });
test.use({ viewport: PHONE_VIEWPORT });

const startOfLocalDay = (daysAgo: number): Date => {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysAgo);
};

const localDateOnly = (day: Date): string =>
  [
    String(day.getFullYear()).padStart(4, '0'),
    String(day.getMonth() + 1).padStart(2, '0'),
    String(day.getDate()).padStart(2, '0'),
  ].join('-');

const localTime = (day: Date, hour: number, minute: number): string =>
  new Date(day.getFullYear(), day.getMonth(), day.getDate(), hour, minute, 0, 0).toISOString();

// --- What is seeded ---------------------------------------------------------

type SeedMeal = {
  readonly daysAgo: number;
  readonly slot: 'breakfast' | 'lunch' | 'dinner';
  readonly hour: number;
  readonly before: number;
  readonly foods: readonly string[];
};

/**
 * Three days hold a food with 'rice' in its name, one of them forty days back so it sits
 * in an earlier month than today's; day 3 has a meal and no rice at all. Day 1 also has a
 * breakfast without rice and a night, so a matching day has cells of every kind to grey.
 */
const RICE_DAYS = [1, 2, 40] as const;
const NO_RICE_DAY = 3;

const seedMeals: readonly SeedMeal[] = [
  { daysAgo: 1, slot: 'breakfast', hour: 8, before: 110, foods: ['Toast', 'Egg'] },
  { daysAgo: 1, slot: 'lunch', hour: 12, before: 120, foods: ['Chicken rice'] },
  { daysAgo: 2, slot: 'dinner', hour: 19, before: 95, foods: ['Soup', 'Fried rice'] },
  { daysAgo: NO_RICE_DAY, slot: 'breakfast', hour: 8, before: 140, foods: ['Porridge'] },
  { daysAgo: 40, slot: 'lunch', hour: 12, before: 100, foods: ['Rice ball'] },
  // Two foods from one restaurant, which carry its name: searching for the name is how
  // every meal eaten there is picked out.
  { daysAgo: 5, slot: 'dinner', hour: 19, before: 130, foods: ['Wagamama ramen'] },
  { daysAgo: 6, slot: 'lunch', hour: 12, before: 125, foods: ['Wagamama gyoza', 'Tea'] },
];

const NIGHT_DAYS_AGO = 1;

const seed = async (ownerId: string): Promise<void> => {
  const admin: SupabaseClient = createClient(stack.supabaseUrl, stack.serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  for (const meal of seedMeals) {
    const day = startOfLocalDay(meal.daysAgo);
    const inserted = await admin
      .from('meals')
      .insert({
        user_id: ownerId,
        slot: meal.slot,
        eaten_on: localDateOnly(day),
        eaten_at: localTime(day, meal.hour, 0),
        glucose_before: meal.before,
        insulin_units: 4,
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
    const foods = await admin.from('meal_foods').insert(
      meal.foods.map((name, index) => ({
        user_id: ownerId,
        meal_id: inserted.data.id,
        name,
        food_type: 'carb-heavy',
        amount: 100,
        unit: 'g',
        position: index + 1,
      })),
    );
    if (foods.error) {
      throw new Error(`could not seed that meal's foods: ${foods.error.message}`);
    }
  }

  const night = startOfLocalDay(NIGHT_DAYS_AGO);
  const nights = await admin.from('night_insulin').insert({
    user_id: ownerId,
    night_on: localDateOnly(night),
    units: 12,
    taken_at: localTime(night, 22, 30),
    bedtime_glucose: 150,
  });
  if (nights.error) {
    throw new Error(`could not seed the night record: ${nights.error.message}`);
  }
};

test.beforeAll(async () => {
  test.setTimeout(10 * 60 * 1000);
  stack = await startLocalStack();
  accounts = await createAccounts(stack, EMAIL_PREFIX);
  await seed(accounts.owner.id);
});

test.afterAll(async () => {
  if (stack) await removeAccounts(stack, EMAIL_PREFIX);
});

// --- Driving the bundle -----------------------------------------------------

const LONG_WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const LONG_MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

/** 'Thursday 25 September': a day row's accessible name, which names ONE row in ninety. */
const spokenDay = (daysAgo: number): string => {
  const day = startOfLocalDay(daysAgo);
  return `${LONG_WEEKDAYS[day.getDay()]} ${day.getDate()} ${LONG_MONTHS[day.getMonth()]}`;
};

const DAY_ROW_NAME = new RegExp(`^(${LONG_WEEKDAYS.join('|')}) \\d{1,2} (${LONG_MONTHS.join('|')})$`);

const grid = (page: Page): Locator => page.getByRole('region', { name: /history/i });

const searchField = (page: Page): Locator => page.getByRole('combobox', { name: SEARCH_LABEL });

const openHistory = async (page: Page): Promise<void> => {
  await page.goto(stack.siteUrl);
  await page.getByLabel(/email/i).fill(accounts.owner.email);
  await page.getByLabel(/password/i).fill(accounts.owner.password);
  await page.getByRole('button', { name: /sign in/i }).click();
  const nav = page.getByRole('navigation');
  const entry = nav.getByRole('link', { name: /^history$/i });
  if ((await entry.count()) > 0) await entry.first().click();
  else await nav.getByRole('button', { name: /^history$/i }).first().click();
  await expect(grid(page), 'History is reached from the bottom navigation').toBeVisible();
};

/** The accessible names of the day rows on show, newest first. */
const dayRowNames = async (page: Page): Promise<string[]> => {
  const names = await grid(page)
    .getByRole('rowheader')
    .evaluateAll((headers) => headers.map((header) => header.getAttribute('aria-label') ?? ''));
  return names.filter((name) => DAY_ROW_NAME.test(name));
};

/** The four controls of one day's row: breakfast, lunch, dinner, night. */
const cellsOf = (page: Page, daysAgo: number): Locator =>
  grid(page)
    .getByRole('row')
    .filter({ has: page.getByRole('rowheader', { name: spokenDay(daysAgo), exact: true }) })
    .getByRole('button');

const expectDimmed = async (cell: Locator, dimmed: boolean, what: string): Promise<void> => {
  if (dimmed) await expect(cell, `${what} is greyed out`).toHaveAttribute('data-dimmed', 'true');
  else await expect(cell, `${what} is not greyed out`).not.toHaveAttribute('data-dimmed');
};

/** Every rowheader the grid draws, day rows and month separators alike, in order. */
const rowHeaderNames = (page: Page): Promise<string[]> =>
  grid(page)
    .getByRole('rowheader')
    .evaluateAll((headers) =>
      headers.map((header) => header.getAttribute('aria-label') ?? header.textContent ?? ''),
    );

/** Where a control sits on the screen, so 'nothing moved' is a comparison of numbers. */
const boxOf = async (locator: Locator): Promise<{ x: number; y: number; width: number; height: number }> => {
  const box = await locator.boundingBox();
  if (box === null) throw new Error('the control is not on screen');
  return box;
};

const suggestions = (page: Page): Locator =>
  page.getByRole('listbox', { name: 'Foods you have eaten' }).getByRole('option');

// --- The claims --------------------------------------------------------------

test('unsearched, the grid shows every day and greys out nothing', async ({ page }) => {
  await openHistory(page);
  await expect(searchField(page), 'the search field starts empty').toHaveValue('');
  expect((await dayRowNames(page)).length, 'the whole grid is on show').toBeGreaterThanOrEqual(90);
  await expect(grid(page).locator('[data-dimmed]'), 'nothing is greyed out').toHaveCount(0);
});

test('a food greys out every cell that does not hold it, and changes nothing else', async ({
  page,
}) => {
  await openHistory(page);
  const rowsBefore = await rowHeaderNames(page);
  const lunchBefore = await boxOf(cellsOf(page, 1).nth(LUNCH));
  const fortyBefore = await boxOf(cellsOf(page, 40).nth(LUNCH));
  const cellCount = await grid(page).getByRole('button').count();

  const field = searchField(page);
  await field.click();
  // Typed key by key, in capitals and with a trailing space: matching ignores both, and the
  // field must still be the one being typed into after every keystroke redraws the grid.
  await field.pressSequentially('RICE ');
  await expect(field, 'the caret stays in the field as the grid redraws').toBeFocused();
  await expect(field).toHaveValue('RICE ');

  // Nothing is removed or moved: the same rows and month separators, the same cells, each
  // where it was.
  expect(await rowHeaderNames(page), 'every row and month separator is still there').toEqual(
    rowsBefore,
  );
  await expect(grid(page).getByRole('button'), 'no cell is removed').toHaveCount(cellCount);
  expect(await boxOf(cellsOf(page, 1).nth(LUNCH)), 'a cell does not move').toEqual(lunchBefore);
  expect(await boxOf(cellsOf(page, 40).nth(LUNCH)), 'a cell further down does not move').toEqual(
    fortyBefore,
  );

  // Day 1: lunch is the chicken rice; the toast breakfast, the empty dinner and the night
  // are greyed.
  const dayOne = cellsOf(page, 1);
  await expectDimmed(dayOne.nth(BREAKFAST), true, 'a breakfast with no rice');
  await expectDimmed(dayOne.nth(LUNCH), false, 'the chicken rice lunch');
  await expectDimmed(dayOne.nth(DINNER), true, 'an empty dinner');
  await expectDimmed(dayOne.nth(NIGHT), true, 'the night');

  // Day 2: rice is the SECOND of the dinner's two foods, so a match on any food counts.
  const dayTwo = cellsOf(page, 2);
  await expectDimmed(dayTwo.nth(BREAKFAST), true, 'an empty breakfast');
  await expectDimmed(dayTwo.nth(DINNER), false, 'the soup and fried rice dinner');

  // A day with a meal and no rice keeps its row, greyed throughout.
  const noRice = cellsOf(page, NO_RICE_DAY);
  await expect(noRice).toHaveCount(4);
  await expectDimmed(noRice.nth(BREAKFAST), true, 'the porridge breakfast');

  await expectDimmed(cellsOf(page, 40).nth(LUNCH), false, 'the rice ball lunch');

  // Three cells hold rice; every other cell in the grid is greyed.
  await expect(grid(page).locator('[data-dimmed]')).toHaveCount(cellCount - RICE_DAYS.length);
});

test('searching leaves the grid scrolled where it was', async ({ page }) => {
  await openHistory(page);
  const region = grid(page);
  await region.evaluate((node) => {
    node.scrollTop = 600;
  });
  const scrolled = await region.evaluate((node) => node.scrollTop);
  expect(scrolled, 'the grid can be scrolled').toBeGreaterThan(0);
  await searchField(page).fill('rice');
  expect(await region.evaluate((node) => node.scrollTop), 'the grid stays where it was').toBe(
    scrolled,
  );
});

test('typing offers the foods the record holds, and choosing one searches for it', async ({
  page,
}) => {
  await openHistory(page);
  const field = searchField(page);
  await expect(suggestions(page), 'nothing is offered before anything is typed').toHaveCount(0);

  const lunchBefore = await boxOf(cellsOf(page, 1).nth(LUNCH));
  await field.click();
  await field.pressSequentially('ri');
  // 'ri' is in all four, porridge included; most recently eaten first.
  await expect(suggestions(page)).toHaveText(['Chicken rice', 'Fried rice', 'Porridge', 'Rice ball']);
  expect(await boxOf(cellsOf(page, 1).nth(LUNCH)), 'the list floats over the grid').toEqual(
    lunchBefore,
  );

  await field.pressSequentially('ce');
  await expect(suggestions(page), 'typing narrows the list').toHaveText([
    'Chicken rice',
    'Fried rice',
    'Rice ball',
  ]);

  await suggestions(page).filter({ hasText: 'Fried rice' }).click();
  await expect(field, 'choosing a food puts it in the field').toHaveValue('Fried rice');
  await expect(suggestions(page), 'choosing a food closes the list').toHaveCount(0);
  await expectDimmed(cellsOf(page, 2).nth(DINNER), false, 'the fried rice dinner');
  await expectDimmed(cellsOf(page, 1).nth(LUNCH), true, 'the chicken rice lunch');
  await expectDimmed(cellsOf(page, 40).nth(LUNCH), true, 'the rice ball lunch');
});

test('Enter puts the list away and searches by the keyword typed', async ({ page }) => {
  await openHistory(page);
  const cellCount = await grid(page).getByRole('button').count();
  const field = searchField(page);
  await field.click();
  await field.pressSequentially('wagamama');
  await expect(suggestions(page)).toHaveText(['Wagamama ramen', 'Wagamama gyoza']);

  await field.press('Enter');
  await expect(suggestions(page), 'Enter puts the list away').toHaveCount(0);
  await expect(field, 'what was typed stays the search').toHaveValue('wagamama');
  await expect(field, 'the field lets go, and a phone its keyboard').not.toBeFocused();

  await expectDimmed(cellsOf(page, 5).nth(DINNER), false, 'the ramen dinner');
  await expectDimmed(cellsOf(page, 6).nth(LUNCH), false, 'the gyoza lunch');
  await expectDimmed(cellsOf(page, 1).nth(LUNCH), true, 'the chicken rice lunch');
  await expect(grid(page).locator('[data-dimmed]')).toHaveCount(cellCount - 2);
});

test('a greyed cell still opens what it opened before', async ({ page }) => {
  await openHistory(page);
  await searchField(page).fill('rice');
  await cellsOf(page, 1).nth(BREAKFAST).click();
  await expect(page.getByText('Toast').first(), 'the toast breakfast opens').toBeVisible();
});

test('a food no day holds greys out every cell and offers nothing', async ({ page }) => {
  await openHistory(page);
  const rowsBefore = await rowHeaderNames(page);
  const cellCount = await grid(page).getByRole('button').count();
  await searchField(page).fill('pizza');
  await expect(grid(page).locator('[data-dimmed]')).toHaveCount(cellCount);
  expect(await rowHeaderNames(page), 'every row is still drawn').toEqual(rowsBefore);
  await expect(suggestions(page)).toHaveCount(0);
});

test('the search outlives a change of view and a trip to a meal and back', async ({ page }) => {
  await openHistory(page);
  await searchField(page).fill('rice');
  await page.getByRole('button', { name: 'Change', exact: true }).click();
  await expect(searchField(page), 'a change of view keeps the search').toHaveValue('rice');
  await expectDimmed(cellsOf(page, NO_RICE_DAY).nth(BREAKFAST), true, 'the porridge breakfast');

  await cellsOf(page, 1).nth(LUNCH).click();
  await expect(page.getByText('Chicken rice').first()).toBeVisible();
  await page.goBack();
  await expect(searchField(page), 'coming back from a meal keeps the search').toHaveValue('rice');
  await expectDimmed(cellsOf(page, NO_RICE_DAY).nth(BREAKFAST), true, 'the porridge breakfast');
});

test('clearing the field greys out nothing again', async ({ page }) => {
  await openHistory(page);
  const field = searchField(page);
  await field.fill('rice');
  await expect(grid(page).locator('[data-dimmed]').first()).toBeVisible();
  await field.fill('');
  await expect(grid(page).locator('[data-dimmed]')).toHaveCount(0);
});
