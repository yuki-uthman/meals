import { test, expect, type Locator, type Page } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { startLocalStack, type LocalStack } from '../support/local-stack';
import { createAccounts, removeAccounts, type SeededAccounts } from '../support/accounts';

/**
 * Public oracle for the History grid's food search.
 *
 * Observation: History carries a search field. Typing a food into it keeps only the days
 * with a meal holding that food, and within those days every cell that does not hold it is
 * greyed out, so the matching meals are what the eye lands on.
 *
 * The claims this oracle is built around:
 *
 *  - A meal matches when ANY of its foods contains what was typed, ignoring case and the
 *    spaces around it, so 'RICE ' finds 'Chicken rice', 'Fried rice' and 'Rice ball' -- the
 *    same rule Lookup's By food applies -- and does not find 'Porridge' or 'Toast'.
 *  - Only the days with a match stay in the grid. A day with meals but no match is gone,
 *    and so are the ninety-odd empty days the unsearched grid reaches back over.
 *  - Within a day that stays, every other cell is greyed out: the meals that do not hold
 *    the food, the empty slots and the night. Greying is read off the published
 *    data-dimmed attribute, never off a colour or an opacity.
 *  - A greyed cell is still a control, and opens what it opened before.
 *  - The month separators are worked out over the rows that are left, so a month whose
 *    only match is weeks back is still named above it.
 *  - Typing redraws the grid and not the field: the caret stays where it was.
 *  - A food no day holds says so in words rather than drawing an empty grid.
 *  - What was typed outlives a change of view and a trip to a meal and back.
 *  - Clearing the field puts the whole grid back.
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

const searchField = (page: Page): Locator => page.getByRole('searchbox', { name: SEARCH_LABEL });

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

/** The month a day falls in, as the separator names it: the reader's own locale. */
const monthOf = (daysAgo: number): string =>
  startOfLocalDay(daysAgo).toLocaleDateString(undefined, { month: 'long' });

// --- The claims --------------------------------------------------------------

test('unsearched, the grid shows every day and greys out nothing', async ({ page }) => {
  await openHistory(page);
  await expect(searchField(page), 'the search field starts empty').toHaveValue('');
  expect((await dayRowNames(page)).length, 'the whole grid is on show').toBeGreaterThanOrEqual(90);
  await expect(grid(page).locator('[data-dimmed]'), 'nothing is greyed out').toHaveCount(0);
});

test('a food keeps only the days that hold it and greys out the rest of those days', async ({
  page,
}) => {
  await openHistory(page);
  const field = searchField(page);
  await field.click();
  // Typed key by key, in capitals and with a trailing space: matching ignores both, and the
  // field must still be the one being typed into after every keystroke redraws the grid.
  await field.pressSequentially('RICE ');
  await expect(field, 'the caret stays in the field as the grid redraws').toBeFocused();
  await expect(field).toHaveValue('RICE ');

  await expect
    .poll(() => dayRowNames(page), { message: 'only the days holding rice are left' })
    .toEqual(RICE_DAYS.map(spokenDay));
  expect(await dayRowNames(page), 'a day with meals but no rice is gone').not.toContain(
    spokenDay(NO_RICE_DAY),
  );

  // Day 1: lunch is the chicken rice; the toast breakfast, the empty dinner and the night
  // are greyed.
  const dayOne = cellsOf(page, 1);
  await expect(dayOne).toHaveCount(4);
  await expectDimmed(dayOne.nth(BREAKFAST), true, 'a breakfast with no rice');
  await expectDimmed(dayOne.nth(LUNCH), false, 'the chicken rice lunch');
  await expectDimmed(dayOne.nth(DINNER), true, 'an empty dinner');
  await expectDimmed(dayOne.nth(NIGHT), true, 'the night');

  // Day 2: rice is the SECOND of the dinner's two foods, so a match on any food counts.
  const dayTwo = cellsOf(page, 2);
  await expectDimmed(dayTwo.nth(BREAKFAST), true, 'an empty breakfast');
  await expectDimmed(dayTwo.nth(LUNCH), true, 'an empty lunch');
  await expectDimmed(dayTwo.nth(DINNER), false, 'the soup and fried rice dinner');
  await expectDimmed(dayTwo.nth(NIGHT), true, 'an empty night');

  const dayForty = cellsOf(page, 40);
  await expectDimmed(dayForty.nth(LUNCH), false, 'the rice ball lunch');

  // The month the forty-days-ago match falls in is still named above it, though every day
  // between it and the next match has been dropped.
  await expect(
    grid(page).getByRole('rowheader', { name: monthOf(40), exact: true }),
    'the month of the oldest match is still named',
  ).toBeVisible();
});

test('a greyed cell still opens what it opened before', async ({ page }) => {
  await openHistory(page);
  await searchField(page).fill('rice');
  await cellsOf(page, 1).nth(BREAKFAST).click();
  await expect(page.getByText('Toast').first(), 'the toast breakfast opens').toBeVisible();
});

test('a food no day holds says so rather than drawing an empty grid', async ({ page }) => {
  await openHistory(page);
  await searchField(page).fill('pizza');
  await expect(grid(page).getByText('No meals with “pizza”.')).toBeVisible();
  expect(await dayRowNames(page), 'no day rows are drawn').toEqual([]);
});

test('the search outlives a change of view and a trip to a meal and back', async ({ page }) => {
  await openHistory(page);
  await searchField(page).fill('rice');
  await page.getByRole('button', { name: 'Change', exact: true }).click();
  await expect(searchField(page), 'a change of view keeps the search').toHaveValue('rice');
  await expect.poll(() => dayRowNames(page)).toEqual(RICE_DAYS.map(spokenDay));

  await cellsOf(page, 1).nth(LUNCH).click();
  await expect(page.getByText('Chicken rice').first()).toBeVisible();
  await page.goBack();
  await expect(searchField(page), 'coming back from a meal keeps the search').toHaveValue('rice');
  await expect.poll(() => dayRowNames(page)).toEqual(RICE_DAYS.map(spokenDay));
});

test('clearing the field puts the whole grid back', async ({ page }) => {
  await openHistory(page);
  const field = searchField(page);
  await field.fill('rice');
  await expect.poll(() => dayRowNames(page)).toEqual(RICE_DAYS.map(spokenDay));
  await field.fill('');
  await expect
    .poll(async () => (await dayRowNames(page)).length, { message: 'every day is back' })
    .toBeGreaterThanOrEqual(90);
  await expect(grid(page).locator('[data-dimmed]')).toHaveCount(0);
});
