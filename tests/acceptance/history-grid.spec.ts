import { test, expect, type Browser, type Locator, type Page } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { startLocalStack, type LocalStack } from '../support/local-stack';
import { createAccounts, removeAccounts, type Account, type SeededAccounts } from '../support/accounts';

/**
 * Public oracle for value 9: the History grid.
 *
 * Observation: History shows one row per day and columns for morning, breakfast, lunch
 * and dinner with a Before, Change and Both view; cells are coloured by the rule in the
 * decisions, the legend follows the view, and tapping a cell opens that meal.
 *
 * Like every earlier value the oracle drives the built static bundle in a real browser
 * against the Supabase CLI local stack, so every number in the grid is what Postgres held
 * and gave back through real row-level security.
 *
 * The claims this oracle is built around:
 *
 *  - Reading a row left to right is chronological: the night that led INTO the row's date
 *    (the night record dated the DAY BEFORE it), then breakfast, lunch, dinner.
 *  - The night's morning reading is the one value 4 already derives -- the earliest before
 *    reading on the row's own date -- so the night cell of the two-days-ago row pairs the
 *    190 it went to bed at with the 104 that day's breakfast opens on, and that redundancy
 *    is asserted rather than hidden.
 *  - Before is coloured by LEVEL and Change and Both by CHANGE, and that is checked by the
 *    published band names and by the ABSENCE of the other kind of band anywhere on the
 *    page, which is also what makes the legend switch with the view.
 *  - A band is read off the rule in src/domain/band.ts and never off the size of the
 *    number: the three-days-ago dinner falls 260 to 200, which is −60, and −60 is dropped.
 *  - Nothing behind a cell means an empty cell: no band, no digits, no control. A meal with
 *    no after reading has no change, so it is empty in Change and Both and still shows its
 *    before reading in Before. A missing measurement is never drawn as a change of zero.
 *  - There are no period controls. The grid runs from today back to the EARLIEST recorded
 *    entry with a floor of fourteen rows, and going further back is scrolling.
 *  - A slot cell opens that meal's EDIT form, which is where the after reading taken two
 *    hours later gets added; a night cell opens the night screen for that night.
 *
 * Bands are asserted by NAME and never by colour, and widgets are located tolerantly --
 * whether the grid is a table or a list, and how a cell is worded, are presentation
 * choices; the columns, the readings and the bands are not.
 */

const PHONE_VIEWPORT = { width: 360, height: 780 } as const;

/** This spec's own email prefix: it removes these accounts and their rows, and nothing else. */
const EMAIL_PREFIX = 'history-grid';

const LEVEL_CAPTION = 'Colour is the level of that reading. Tap a cell to open that meal.';
const CHANGE_CAPTION = 'Colour is the change, not the level. Tap a cell to open that meal.';

const LEVEL_BANDS = ['low', 'in-range', 'high', 'very-high'] as const;
const CHANGE_BANDS = ['dropped', 'stable', 'rose', 'rose-high'] as const;

/**
 * The floor: a log with one entry still reads as a grid rather than as a stranded row. The
 * fixture's oldest entry is four days ago, so fourteen rows is also what this grid shows,
 * but the claim asserted is the floor and the reach back to the oldest entry, not a period.
 */
const MINIMUM_ROWS = 14;

let stack: LocalStack;
let accounts: SeededAccounts;

test.describe.configure({ mode: 'serial' });
test.use({ viewport: PHONE_VIEWPORT });

const startOfLocalDay = (daysAgo: number): Date => {
  const now = new Date();
  const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return new Date(midnight.getFullYear(), midnight.getMonth(), midnight.getDate() - daysAgo);
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
  readonly minute: number;
  readonly before: number;
  readonly after?: number;
  readonly units: number;
};

type SeedNight = {
  /** The date the night record itself carries: the row it appears in is the day AFTER. */
  readonly daysAgo: number;
  readonly bedtime: number;
  readonly units: number;
};

const seedMeals: readonly SeedMeal[] = [
  // Two days ago. Breakfast is the day's first meal, so its before reading 104 is also the
  // morning reading of the night that led into this date.
  { daysAgo: 2, slot: 'breakfast', hour: 7, minute: 40, before: 104, after: 186, units: 5 },
  { daysAgo: 2, slot: 'lunch', hour: 12, minute: 55, before: 112, after: 133, units: 6 },
  // No dinner at all: that cell has nothing behind it in every view.

  // Three days ago. No breakfast.
  { daysAgo: 3, slot: 'lunch', hour: 12, minute: 30, before: 120, after: 165, units: 6 },
  // 260 to 200 is −60: dropped by the rule, whatever the size of the number suggests.
  { daysAgo: 3, slot: 'dinner', hour: 19, minute: 10, before: 260, after: 200, units: 9 },

  // Four days ago, and the oldest entry in the record: a before reading and no after, so
  // there is no change to draw. This is also what the grid must reach back to.
  { daysAgo: 4, slot: 'breakfast', hour: 8, minute: 0, before: 64, units: 3 },
];

const seedNights: readonly SeedNight[] = [
  // Dated three days ago, so it appears in the row TWO days ago: the night that led into
  // that date. Bedtime 190, morning 104: a fall of 86.
  { daysAgo: 3, bedtime: 190, units: 18 },
];

// --- What each cell must read ----------------------------------------------

type CellReading = {
  /** Every fragment the cell must contain. Minus signs are normalised before matching. */
  readonly reads: readonly string[];
  readonly band: string;
};

type CellExpectation = {
  /** Which column, left to right: 0 is the night, then breakfast, lunch, dinner. */
  readonly column: 0 | 1 | 2 | 3;
  /** The accessible name of a populated cell must contain this. */
  readonly names: RegExp;
  readonly before: CellReading | null;
  readonly change: CellReading | null;
  readonly both: CellReading | null;
};

type RowExpectation = {
  readonly daysAgo: number;
  readonly cells: readonly CellExpectation[];
};

const NIGHT_NAME = /night|bedtime|overnight/i;

const rows: readonly RowExpectation[] = [
  {
    daysAgo: 2,
    cells: [
      {
        // The night dated the DAY BEFORE this row: bedtime 190, and the morning reading
        // value 4 already derives -- the earliest before reading on this row's own date,
        // which is breakfast's 104. 104 − 190 is −86.
        column: 0,
        names: NIGHT_NAME,
        before: { reads: ['190'], band: 'high' },
        change: { reads: ['-86'], band: 'dropped' },
        both: { reads: ['190', '104'], band: 'dropped' },
      },
      {
        column: 1,
        names: /breakfast/i,
        before: { reads: ['104'], band: 'in-range' },
        change: { reads: ['+82'], band: 'rose-high' },
        both: { reads: ['104', '186'], band: 'rose-high' },
      },
      {
        column: 2,
        names: /lunch/i,
        before: { reads: ['112'], band: 'in-range' },
        change: { reads: ['+21'], band: 'stable' },
        both: { reads: ['112', '133'], band: 'stable' },
      },
      // No dinner was eaten: an empty outline in every view, and not tappable.
      { column: 3, names: /dinner/i, before: null, change: null, both: null },
    ],
  },
  {
    daysAgo: 3,
    cells: [
      // No night record dated four days ago, so this row's night cell is empty.
      { column: 0, names: NIGHT_NAME, before: null, change: null, both: null },
      { column: 1, names: /breakfast/i, before: null, change: null, both: null },
      {
        column: 2,
        names: /lunch/i,
        before: { reads: ['120'], band: 'in-range' },
        change: { reads: ['+45'], band: 'rose' },
        both: { reads: ['120', '165'], band: 'rose' },
      },
      {
        column: 3,
        names: /dinner/i,
        before: { reads: ['260'], band: 'very-high' },
        // −60 is dropped. A rule read off the magnitude would say rose here and fail.
        change: { reads: ['-60'], band: 'dropped' },
        both: { reads: ['260', '200'], band: 'dropped' },
      },
    ],
  },
  {
    daysAgo: 4,
    cells: [
      { column: 0, names: NIGHT_NAME, before: null, change: null, both: null },
      {
        // Recorded, but nobody has taken the after reading yet: the before reading in
        // Before, and nothing at all in Change and Both.
        column: 1,
        names: /breakfast/i,
        before: { reads: ['64'], band: 'low' },
        change: null,
        both: null,
      },
      { column: 2, names: /lunch/i, before: null, change: null, both: null },
      { column: 3, names: /dinner/i, before: null, change: null, both: null },
    ],
  },
];

/** The rows within the floor that have nothing behind any cell at all. */
const EMPTY_ROW_DAYS_AGO = [0, 1, 5, 6, 7, 8, 9, 10, 11, 12, 13] as const;

// --- Seeding ----------------------------------------------------------------

const seed = async (owner: Account): Promise<void> => {
  const admin: SupabaseClient = createClient(stack.supabaseUrl, stack.serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  for (const meal of seedMeals) {
    const day = startOfLocalDay(meal.daysAgo);
    const inserted = await admin
      .from('meals')
      .insert({
        user_id: owner.id,
        slot: meal.slot,
        // eaten_on, never eaten_at: a late row must not drift into the neighbouring day
        // when the server's offset is not the phone's.
        eaten_on: localDateOnly(day),
        eaten_at: localTime(day, meal.hour, meal.minute),
        glucose_before: meal.before,
        ...(meal.after === undefined ? {} : { glucose_after: meal.after }),
        insulin_units: meal.units,
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

  const nightRows = seedNights.map((night) => {
    const day = startOfLocalDay(night.daysAgo);
    return {
      user_id: owner.id,
      night_on: localDateOnly(day),
      units: night.units,
      taken_at: localTime(day, 22, 30),
      bedtime_glucose: night.bedtime,
    };
  });
  const nights = await admin.from('night_insulin').insert(nightRows);
  if (nights.error) {
    throw new Error(`could not seed the night records: ${nights.error.message}`);
  }
};

test.beforeAll(async () => {
  test.setTimeout(10 * 60 * 1000);
  stack = await startLocalStack();
  accounts = await createAccounts(stack, EMAIL_PREFIX);
  await seed(accounts.owner);
});

test.afterAll(async () => {
  if (stack) await removeAccounts(stack, EMAIL_PREFIX);
});

// --- Driving the bundle -----------------------------------------------------

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

const textOf = async (locator: Locator): Promise<string> =>
  (await locator.innerText()).replace(/\s+/g, ' ').trim();

/** U+2212 and friends normalised to a plain hyphen, so a signed change can be matched. */
const normaliseSigns = (text: string): string => text.replace(/[−–—]/g, '-');

const scrollsHorizontally = (page: Page): Promise<boolean> =>
  page.evaluate(() => {
    const root = document.documentElement;
    return root.scrollWidth > root.clientWidth || document.body.scrollWidth > root.clientWidth;
  });

/**
 * The bottom navigation. Whether an entry is a link or a button is a presentation choice,
 * so both are accepted; that Today and History are the only two entries is not.
 */
const navigation = (page: Page): Locator => page.getByRole('navigation');

const navigate = async (page: Page, name: RegExp): Promise<void> => {
  const nav = navigation(page);
  const entry = nav.getByRole('link', { name });
  if ((await entry.count()) > 0) {
    await entry.first().click();
    return;
  }
  await nav.getByRole('button', { name }).first().click();
};

const openHistory = async (browser: Browser, account: Account): Promise<Page> => {
  const page = await openPhone(browser);
  await signIn(page, account);
  await navigate(page, /^history$/i);
  await expect(grid(page), 'History is reached from the bottom navigation').toBeVisible();
  return page;
};

const grid = (page: Page): Locator => page.getByRole('region', { name: /history/i });

/** The grid's rows, whether it is marked up as a table or as a list. */
const allRows = async (page: Page): Promise<Locator> => {
  const tableRows = grid(page).getByRole('row');
  if ((await tableRows.count()) > 0) {
    return tableRows;
  }
  return grid(page).getByRole('listitem');
};

const WEEKDAY = /\b(Mon|Tue|Wed|Thu|Fri|Sat|Sun)/;

const dayLabel = (daysAgo: number): RegExp => {
  const day = startOfLocalDay(daysAgo);
  return new RegExp(`(Mon|Tue|Wed|Thu|Fri|Sat|Sun)\\w*\\s*0?${day.getDate()}\\b`, 'i');
};

/**
 * A row is identified by its DAY LABEL CELL and never by the row's whole text. A row's text
 * is the concatenation of its cells with no separator between them, so a row reading
 * 'Sat 26' followed by a cell reading 260 has the text 'Sat 26260...', in which the label
 * cannot be matched at all. The label cell's own accessible name is just the label, so
 * matching it is both correct and independent of what the readings happen to be.
 *
 * Whether the grid is a table or a list is still a presentation choice: a table exposes the
 * label as a row header, and a list is matched on the label cell it exposes instead.
 */
const labelCell = (page: Page, name: RegExp): Locator => page.getByRole('rowheader', { name });

/** The day rows: the ones whose label names a weekday. A header row carries none. */
const dayRows = async (page: Page): Promise<Locator> => {
  const rows = await allRows(page);
  if ((await labelCell(page, WEEKDAY).count()) > 0) {
    return rows.filter({ has: labelCell(page, WEEKDAY) });
  }
  // A list has no row headers; its label is its own first line, which innerText separates.
  return rows.filter({ hasText: WEEKDAY });
};

const rowFor = async (page: Page, daysAgo: number): Promise<Locator> => {
  const label = dayLabel(daysAgo);
  const rows = await allRows(page);
  const matching =
    (await labelCell(page, WEEKDAY).count()) > 0
      ? rows.filter({ has: labelCell(page, label) })
      : (await dayRows(page)).filter({ hasText: label });
  await expect(matching, `exactly one row for ${daysAgo} day(s) ago`).toHaveCount(1);
  return matching.first();
};

/** One row's day label cell: the row header where there is one, else the row itself. */
const labelOf = async (row: Locator): Promise<Locator> => {
  const header = row.getByRole('rowheader');
  return (await header.count()) > 0 ? header.first() : row;
};

/**
 * The cells of one row. A row may carry a day label cell before them; the four columns are
 * the last four either way, so they are taken from the end.
 */
const cellsOf = async (row: Locator): Promise<Locator> => {
  for (const role of ['cell', 'gridcell', 'listitem'] as const) {
    const found = row.getByRole(role);
    if ((await found.count()) > 0) {
      return found;
    }
  }
  throw new Error('the row exposes no cells');
};

const cellAt = async (row: Locator, column: number): Promise<Locator> => {
  const cells = await cellsOf(row);
  const count = await cells.count();
  expect(count, 'a row carries the four columns, optionally after a day label').toBeGreaterThanOrEqual(4);
  return cells.nth(count - 4 + column);
};

/** The one control a populated cell is, whether it is marked up as a button or a link. */
const controlIn = async (cell: Locator): Promise<Locator> => {
  const link = cell.getByRole('link');
  if ((await link.count()) > 0) {
    return link.first();
  }
  return cell.getByRole('button').first();
};

const controlCount = async (cell: Locator): Promise<number> =>
  (await cell.getByRole('link').count()) + (await cell.getByRole('button').count());

/**
 * Which band names are published anywhere on the page BESIDE a word. A cell carries only
 * numbers, so a band name that appears beside letters is the legend naming it in words.
 */
const bandsNamedInWords = async (page: Page, attribute: string): Promise<Set<string>> => {
  const nodes = page.locator(`[${attribute}]`);
  const named = new Set<string>();
  for (let index = 0; index < (await nodes.count()); index += 1) {
    const node = nodes.nth(index);
    const value = await node.getAttribute(attribute);
    const text = (await node.innerText()).trim();
    if (value && /[A-Za-z]/.test(text)) {
      named.add(value);
    }
  }
  return named;
};

type View = 'before' | 'change' | 'both';

const chooseView = async (page: Page, view: View): Promise<void> => {
  const name = new RegExp(`^${view}$`, 'i');
  await page.getByRole('button', { name }).first().click();
  await expect(
    page.getByRole('button', { name }).first(),
    `the ${view} view publishes itself as pressed`,
  ).toHaveAttribute('aria-pressed', 'true');
};

/**
 * There are no period controls. Going further back is scrolling, not choosing a bucket, so
 * a chip offering a window is an extra the design deliberately dropped and its presence is
 * a falsifier rather than a harmless leftover.
 */
const assertNoPeriodControls = async (page: Page): Promise<void> => {
  for (const label of [/^2 weeks$/i, /^1 month$/i, /^3 months$/i]) {
    await expect(
      page.getByRole('button', { name: label }),
      `no period control named ${label.source}`,
    ).toHaveCount(0);
  }
  expect(
    await textOf(page.locator('body')),
    'no period is offered anywhere on the screen',
  ).not.toMatch(/2 weeks|1 month|3 months/i);
};

/** Asserts one cell against what that view must show, band by name and reading by reading. */
const assertCell = async (
  page: Page,
  row: RowExpectation,
  cell: CellExpectation,
  view: View,
): Promise<void> => {
  const where = `${row.daysAgo} day(s) ago, column ${cell.column}, ${view} view`;
  const located = await cellAt(await rowFor(page, row.daysAgo), cell.column);
  const expected = cell[view];
  const text = normaliseSigns(await textOf(located));

  if (expected === null) {
    // Nothing behind it: an empty outline. No band, no number, and no control, because a
    // cell that opens nothing must not be offered as one.
    await expect(located.locator('[data-level-band]'), `${where} carries no level band`).toHaveCount(0);
    await expect(located.locator('[data-change-band]'), `${where} carries no change band`).toHaveCount(0);
    expect(text, `${where} shows no number -- a missing measurement is not a zero`).not.toMatch(/\d/);
    expect(await controlCount(located), `${where} is not tappable`).toBe(0);
    return;
  }

  for (const fragment of expected.reads) {
    expect(text, `${where} reads ${fragment}`).toContain(fragment);
  }

  const attribute = view === 'before' ? 'data-level-band' : 'data-change-band';
  const other = view === 'before' ? 'data-change-band' : 'data-level-band';
  const banded = located.locator(`[${attribute}]`);
  await expect(banded, `${where} publishes exactly one ${attribute}`).toHaveCount(1);
  await expect(banded, `${where} is banded by the rule`).toHaveAttribute(attribute, expected.band);
  await expect(located.locator(`[${other}]`), `${where} publishes no ${other}`).toHaveCount(0);

  // A coloured square is unreadable to anyone not using the colours, so a populated cell is
  // one control whose name says which day, which column and which readings it is.
  expect(await controlCount(located), `${where} is one control`).toBe(1);
  const name = normaliseSigns((await (await controlIn(located)).getAttribute('aria-label')) ?? '');
  const spoken = name === '' ? normaliseSigns(await textOf(await controlIn(located))) : name;
  expect(spoken, `${where} names its day`).toMatch(dayLabel(row.daysAgo));
  expect(spoken, `${where} names its column`).toMatch(cell.names);
  for (const fragment of expected.reads) {
    expect(spoken, `${where} names its reading ${fragment}`).toContain(fragment);
  }
};

const assertEmptyRows = async (page: Page): Promise<void> => {
  for (const daysAgo of EMPTY_ROW_DAYS_AGO) {
    const row = await rowFor(page, daysAgo);
    // The day label is the only thing in it: no readings, no bands, nothing to tap.
    expect(
      await textOf(await labelOf(row)),
      `the row ${daysAgo} day(s) ago names its date`,
    ).toMatch(dayLabel(daysAgo));
    await expect(row.locator('[data-level-band]')).toHaveCount(0);
    await expect(row.locator('[data-change-band]')).toHaveCount(0);
    expect(await controlCount(row), `the empty row ${daysAgo} day(s) ago offers no control`).toBe(0);
  }
};

// --- The oracle -------------------------------------------------------------

test('the grid opens on Before: one row per day, four chronological columns, coloured by level', async ({
  browser,
}) => {
  const phone = await openHistory(browser, accounts.owner);

  // The navigation carries Today and History, which is what this value is judged on. Lookup
  // joins them at value 10, exactly as this value's own design announced, so its presence is
  // no longer denied here; Settings is in no value and is still not built. The observation
  // this oracle protects -- that History is reachable and shows the grid -- is unchanged.
  const navText = await textOf(navigation(phone));
  expect(navText, 'the navigation carries Today').toMatch(/today/i);
  expect(navText, 'the navigation carries History').toMatch(/history/i);
  expect(navText, 'Settings is in no value and is not built').not.toMatch(/settings/i);

  // No period controls: the grid runs from today back to the earliest entry and the page
  // scrolls, so going further back is scrolling rather than choosing a bucket.
  await assertNoPeriodControls(phone);

  // One row per calendar date, with the floor of fourteen so a short log still reads as a
  // grid, and reaching back at least to the oldest entry four days ago.
  const dayRowCount = await (await dayRows(phone)).count();
  expect(dayRowCount, 'the grid has a floor of fourteen rows').toBeGreaterThanOrEqual(MINIMUM_ROWS);
  for (const daysAgo of [0, 4]) {
    await rowFor(phone, daysAgo);
  }

  // Newest first. Read off each row's LABEL, not its whole text, which runs the label
  // into the first reading.
  expect(
    await textOf(await labelOf((await dayRows(phone)).first())),
    'the newest date is first',
  ).toMatch(dayLabel(0));
  for (const daysAgo of [1, MINIMUM_ROWS - 1]) {
    expect(
      await textOf(await labelOf((await dayRows(phone)).nth(daysAgo))),
      `row ${daysAgo + 1} is the date ${daysAgo} day(s) ago`,
    ).toMatch(dayLabel(daysAgo));
  }

  // The columns, left to right: the night half that is being shown, then the day's meals.
  const gridText = await textOf(grid(phone));
  expect(gridText, "Before names the night column 'Bedtime'").toMatch(/bedtime/i);
  expect(gridText, 'the meal columns are named').toMatch(/breakfast/i);
  expect(gridText).toMatch(/lunch/i);
  expect(gridText).toMatch(/dinner/i);

  // The default view, and the caption that says what the colour means.
  await expect(
    phone.getByRole('button', { name: /^before$/i }),
    'the grid opens on the Before view',
  ).toHaveAttribute('aria-pressed', 'true');
  await expect(phone.getByText(LEVEL_CAPTION)).toBeVisible();
  await expect(phone.getByText(CHANGE_CAPTION)).toHaveCount(0);

  for (const row of rows) {
    for (const cell of row.cells) {
      await assertCell(phone, row, cell, 'before');
    }
  }
  await assertEmptyRows(phone);

  // The Before view publishes level bands only, anywhere on the page: that is the brief's
  // rule stated where it can be checked, and it is what makes the legend switch too.
  await expect(
    phone.locator('[data-change-band]'),
    'nothing in the Before view is banded by change',
  ).toHaveCount(0);

  // The legend names the four level bands in words.
  expect(
    [...(await bandsNamedInWords(phone, 'data-level-band'))].sort(),
    'the legend names the four level bands in words',
  ).toEqual([...LEVEL_BANDS].sort());

  // Four columns plus the day label at 360 px, with no horizontal scrolling.
  expect(await scrollsHorizontally(phone), 'the grid fits 360 px').toBe(false);
});

test('Change shows the signed change and Both shows the two readings, each coloured by the change', async ({
  browser,
}) => {
  const phone = await openHistory(browser, accounts.owner);

  for (const view of ['change', 'both'] as const) {
    await chooseView(phone, view);

    // The header of the night column says which half is being shown.
    const gridText = await textOf(grid(phone));
    expect(gridText, `the ${view} view names its night column`).toMatch(
      // \bNight\b so 'Overnight' cannot satisfy the Both view's header.
      view === 'change' ? /overnight/i : /\bNight\b/,
    );

    await expect(phone.getByText(CHANGE_CAPTION)).toBeVisible();
    await expect(phone.getByText(LEVEL_CAPTION)).toHaveCount(0);

    for (const row of rows) {
      for (const cell of row.cells) {
        await assertCell(phone, row, cell, view);
      }
    }
    await assertEmptyRows(phone);

    // The colour never reflects the absolute level here: no level band exists at all.
    await expect(
      phone.locator('[data-level-band]'),
      `nothing in the ${view} view is banded by level`,
    ).toHaveCount(0);

    expect(
      [...(await bandsNamedInWords(phone, 'data-change-band'))].sort(),
      `the ${view} view's legend names the four change bands in words`,
    ).toEqual([...CHANGE_BANDS].sort());

    await assertNoPeriodControls(phone);
    expect(await scrollsHorizontally(phone), `the ${view} view fits 360 px`).toBe(false);
  }
});

test('tapping a cell opens the entry behind it, where it can be finished or corrected', async ({
  browser,
}) => {
  const phone = await openHistory(browser, accounts.owner);

  // A slot cell opens that meal's EDIT form, which is where the after reading taken two
  // hours later gets added. The two-days-ago breakfast reads 104 to 186.
  const breakfast = await cellAt(await rowFor(phone, 2), 1);
  await (await controlIn(breakfast)).click();

  const before = phone.getByLabel('Glucose before', { exact: true });
  const after = phone.getByLabel('Glucose after', { exact: true });
  await expect(before, 'the cell opened a form that can be edited, not a read-only detail').toBeVisible();
  await expect(
    phone.getByText(/edit meal/i),
    'the form is headed for editing an existing meal',
  ).toBeVisible();
  await expect(before, "the form holds that meal's own before reading").toHaveValue('104');
  await expect(after, "the form holds that meal's own after reading").toHaveValue('186');

  // A night cell opens the night screen for that night: the night dated three days ago,
  // which is the one shown in the two-days-ago row, with its bedtime reading of 190.
  await navigate(phone, /^history$/i);
  const night = await cellAt(await rowFor(phone, 2), 0);
  await (await controlIn(night)).click();

  const bedtime = phone.getByLabel('Bedtime glucose', { exact: true });
  await expect(bedtime, 'the night cell opened the night screen').toBeVisible();
  await expect(
    phone.getByLabel('Dose', { exact: true }),
    'the night screen is the one value 4 built',
  ).toBeVisible();
  await expect(bedtime, "the night opened is that row's own night").toHaveValue('190');

  expect(await scrollsHorizontally(phone)).toBe(false);
});

test("another account's grid holds none of the owner's readings", async ({ browser }) => {
  const phone = await openHistory(browser, accounts.stranger);

  // Row-level security is the only thing that scopes a read, and this account recorded
  // nothing: every cell of every view is empty, and no reading of the owner's is here.
  for (const view of ['before', 'change', 'both'] as const) {
    if (view !== 'before') {
      await chooseView(phone, view);
    }
    const text = await textOf(grid(phone));
    for (const reading of ['104', '186', '112', '133', '120', '165', '260', '200', '190']) {
      expect(text, `${view}: the owner's ${reading} is not in this grid`).not.toContain(reading);
    }
    // No cell is banded, because no cell has anything behind it. The legend still names
    // its four bands, and still only the kind the view is coloured by.
    await expect(grid(phone).locator('[data-level-band]')).toHaveCount(0);
    await expect(grid(phone).locator('[data-change-band]')).toHaveCount(0);
    expect(
      [...(await bandsNamedInWords(phone, view === 'before' ? 'data-level-band' : 'data-change-band'))]
        .sort(),
      `${view}: the legend still names its four bands`,
    ).toEqual([...(view === 'before' ? LEVEL_BANDS : CHANGE_BANDS)].sort());
    expect(await controlCount(grid(phone)), `${view}: no cell is tappable`).toBe(0);
  }
});
