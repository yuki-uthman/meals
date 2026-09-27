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
 * Where this oracle backfills a day it goes through the Add food screen as it now stands: a
 * food is an owned record, so a name the account has never eaten is typed, the offer reading
 * 'Create "<name>"' is pressed, and only then is the type asked for. That gate is incidental
 * to what this value is judged on -- it is simply the way a meal is recorded -- but an oracle
 * that skipped it would wait on a type chooser a correct product has not drawn.
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
 *  - The LEVEL bands are low under 70, in-range 70 to 140, elevated 141 to 180 and high 181
 *    and above. 'very-high' is retired outright rather than left unused, because a band
 *    nothing can fall into is a rule nobody can read, so its absence is asserted too: 260 and
 *    190 now fall in the same top band, and the backfilled 150 is the elevated one.
 *  - The legend fits on ONE ROW, so its visible labels are the RANGES alone and the meaning
 *    lives in each entry's accessible name -- 'Low, under 70', 'In range, 70 to 140'. The
 *    range is what a person reading the colours needs; the word is what anyone not reading
 *    them needs, and asserting only one of the two would license dropping the other.
 *  - Nothing behind a cell means an empty outline: no band and no digits, because a missing
 *    measurement is never drawn as a change of zero. A meal with no after reading has no
 *    change, so it is empty in Change and Both and still shows its before reading in Before.
 *  - An empty cell IS tappable, and that is the point of the screen: backfilling a day kept
 *    on paper. An empty slot cell opens New meal with that DATE and that SLOT already
 *    chosen, saving records against that date rather than today, and the date is named on
 *    the form because it is not today. An empty night cell opens the night screen for that
 *    night.
 *  - There are no period controls. The grid runs from today back to whichever is EARLIER --
 *    ninety days ago or the oldest recorded entry -- and going further back is scrolling.
 *    Ninety days is the floor because the days worth backfilling are by definition days
 *    with nothing in them, which a grid bounded by existing data could never reach.
 *  - Over that span the short label 'Tue 22' is ambiguous three times over, so the rows
 *    carry a month separator naming each month the grid reaches.
 *  - Every way of leaving a form or the night screen returns to the screen it was opened
 *    FROM, so a cell tapped in History leads back to History rather than to Today, and it
 *    returns to the SAME SCROLL POSITION: coming back to the top of ninety rows is barely
 *    better than being dumped on Today.
 *  - The bottom navigation is FIXED to the bottom of the viewport and holds its place while
 *    the grid scrolls underneath, and the scrolling content reserves room for it, so the last
 *    day row and a form's lowest control clear the bar instead of sitting behind it -- the
 *    classic fixed-bar failure, and invisible to anyone testing on a desktop window.
 *  - A slot cell with a meal behind it opens that meal's EDIT form, which is where the after
 *    reading taken two hours later gets added; a night cell opens the night screen for that
 *    night.
 *  - In-app navigation goes through the BROWSER'S HISTORY, so the device's Back gesture does
 *    what Cancel does -- returns to the screen the form was opened FROM, at the scroll position
 *    it was left at -- rather than leaving the site. On Android Back is the primary way people
 *    move around, so a screen change that pushes no entry ejects the person on the gesture they
 *    use most.
 *  - A screen's identity lives in the URL as a HASH route, so the URL changes as screens open
 *    and a meal's own URL RELOADS to that meal.
 *  - The first screen REPLACES its entry rather than pushing one, so Back from it LEAVES the
 *    site rather than cycling inside the app, while every other navigation pushes exactly one
 *    entry. Asserted by driving Back off the end of the app's own stack -- the count between
 *    the document loading and the first render is not observable, since the goto that loads
 *    the page is itself a navigation.
 *  - Signing out replaces the stack, so Back after signing out cannot walk into a screen
 *    belonging to the account that just left.
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

/**
 * The level bands, as the thresholds now stand: low under 70, in-range 70 to 140, elevated
 * 141 to 180, high 181 and above. 'very-high' is retired outright rather than left unused,
 * because a band nothing can fall into is a rule nobody can read -- so its ABSENCE is
 * asserted as well as the four that remain.
 */
const LEVEL_BANDS = ['low', 'in-range', 'elevated', 'high'] as const;
const RETIRED_LEVEL_BAND = 'very-high';
const CHANGE_BANDS = ['dropped', 'stable', 'rose', 'rose-high'] as const;

/**
 * The legend's four level entries. The visible label is the RANGE alone, because four labels
 * carrying their words wrap to a second row, push the grid down the screen and read as two
 * groups rather than one scale; the WORD lives in the accessible name, because the range is
 * what a person reading the colours needs and the word is what anyone not reading them needs.
 *
 * The range is matched on its numbers and its words rather than on the exact separator glyph:
 * whether a range is written with a tilde, a dash or the word 'to' is presentation, while
 * which numbers bound which band is the rule.
 */
const LEVEL_LEGEND = [
  { band: 'low', spoken: 'Low, under 70', range: /under\s*70/i },
  { band: 'in-range', spoken: 'In range, 70 to 140', range: /\b70\b\D+\b140\b/ },
  { band: 'elevated', spoken: 'Elevated, 141 to 180', range: /\b141\b\D+\b180\b/ },
  { band: 'high', spoken: 'High, 181 and above', range: /above\s*181|181\s*(and above|\+)/i },
] as const;

/**
 * The change legend's visible ranges. Its accessible names are required to carry a WORD --
 * the same obligation the level entries have -- but the exact wording of those four is not
 * fixed by the design, so it is not invented here: what is asserted is that the meaning is
 * spoken at all, and which band each entry is.
 */
const CHANGE_LEGEND_RANGES = [
  /-\s*40 or less/i,
  /-\s*39\D+\+?\s*30/,
  /\+?\s*31\D+\+?\s*60/,
  /above\s*\+?\s*60/i,
] as const;

/**
 * The floor: the grid runs from today back to whichever is EARLIER, ninety days ago or the
 * oldest recorded entry. The fixture's oldest entry is four days ago, so ninety rows is what
 * this grid shows, and the claim asserted is that floor -- not a period, and not a reach
 * bounded by the data, which could never offer an empty day to fill in.
 */
const MINIMUM_ROWS = 90;

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
      // No dinner was eaten: an empty outline in every view, still offered to fill in.
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
        // 181 and above is 'high': the top band now has no ceiling above it, so a 260 and
        // the 190 two rows up fall in the same band rather than in two.
        before: { reads: ['260'], band: 'high' },
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

/**
 * Rows within the floor that have nothing behind any cell at all, sampled across the ninety
 * days rather than enumerated: the claim is that such a row carries its date and no reading,
 * and it is the same claim on day 6 as on day 89.
 */
const EMPTY_ROW_DAYS_AGO = [0, 1, 6, 7, 30, 60, 89] as const;

/** The day whose empty dinner cell this oracle backfills through. Nothing is seeded on it. */
const BACKFILL_DAYS_AGO = 8;

/** The food the backfilled meal is recorded with. The account has never eaten it. */
const BACKFILL_FOOD = 'Rice';

/**
 * 'Create "Rice"': the offer a name matching none of the account's own foods makes, and
 * the press that reveals the type chooser. Spelled out here rather than imported from the
 * product, because an oracle that borrowed the label from the code under test would agree
 * with it however the label were changed.
 */
const createFoodLabel = (name: string): string => `Create "${name}"`;

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

/**
 * How far anything on the page is scrolled. Which element carries the scrollbar -- the
 * document or a scrolling area inside the frame -- is a presentation choice, so the largest
 * offset of any scrollable element is taken: what is asserted is that the grid is scrolled
 * away from its top, not which node does the scrolling.
 */
const scrollOffset = (page: Page): Promise<number> =>
  page.evaluate(() => {
    let furthest = 0;
    for (const node of [document.scrollingElement, ...document.querySelectorAll('*')]) {
      if (node instanceof HTMLElement || node === document.scrollingElement) {
        const element = node as Element;
        if (element.scrollHeight > element.clientHeight + 1) {
          furthest = Math.max(furthest, element.scrollTop);
        }
      }
    }
    return furthest;
  });

/** Scrolls whatever scrolls to its very end, which is where a fixed bottom bar does its damage. */
const scrollToEnd = async (page: Page): Promise<void> => {
  await page.evaluate(() => {
    for (const node of [document.scrollingElement, ...document.querySelectorAll('*')]) {
      const element = node as Element | null;
      if (element !== null && element.scrollHeight > element.clientHeight + 1) {
        element.scrollTop = element.scrollHeight;
      }
    }
  });
  // One frame, so the fixed bar and the reserved room are measured after the scroll settles.
  await page.waitForTimeout(100);
};

/**
 * The element that actually carries the grid's scrollbar. On this screen the page itself does
 * not scroll -- the rows scroll inside their own container -- so a window-level scroll is a
 * no-op here, and anything asserted after one would be satisfied or broken silently. Every
 * scroll below therefore targets THIS element and reports how far it moved, so a scroll that
 * did nothing can never be mistaken for the thing being tested.
 */
const scrollGrid = async (
  page: Page,
  target: number | 'end',
): Promise<{ readonly from: number; readonly to: number }> => {
  const moved = await grid(page).evaluate((region, to) => {
    const scrollable = (node: Element): boolean => node.scrollHeight > node.clientHeight + 1;
    const scroller = ((): Element | null => {
      for (let node: Element | null = region; node !== null; node = node.parentElement) {
        if (scrollable(node)) return node;
      }
      for (const node of region.querySelectorAll('*')) {
        if (scrollable(node)) return node;
      }
      return null;
    })();
    if (scroller === null) return null;
    const from = scroller.scrollTop;
    scroller.scrollTop = to === 'end' ? scroller.scrollHeight : to;
    return { from, to: scroller.scrollTop };
  }, target);
  if (moved === null) throw new Error("the grid exposes no scrolling container");
  // One frame, so positions are read after the scroll settles.
  await page.waitForTimeout(100);
  return moved;
};

/** Brings one row of the grid to the top of that container, leaving room to scroll onward. */
const scrollGridToTopOf = async (page: Page, what: Locator): Promise<void> => {
  const offset = await what.evaluate((node) => {
    const scrollable = (candidate: Element): boolean =>
      candidate.scrollHeight > candidate.clientHeight + 1;
    let scroller: Element | null = null;
    for (let walk: Element | null = node; walk !== null; walk = walk.parentElement) {
      if (scrollable(walk)) {
        scroller = walk;
        break;
      }
    }
    if (scroller === null) return 0;
    return scroller.scrollTop + node.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
  });
  await scrollGrid(page, offset);
};

type Rect = { readonly x: number; readonly y: number; readonly width: number; readonly height: number };

const rectOf = async (locator: Locator, what: string): Promise<Rect> => {
  const box = await locator.boundingBox();
  if (box === null) throw new Error(`${what} has no box on screen`);
  return box;
};

const viewportHeight = (page: Page): number => {
  const size = page.viewportSize();
  if (size === null) throw new Error('the page has no viewport');
  return size.height;
};

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

/** The sign-in form: the one screen an account that has left may be looking at. */
const signInForm = (page: Page): Locator => page.getByRole('button', { name: /sign in/i });

/** How many entries the browser holds, which is how 'replaced rather than pushed' is read. */
const historyLength = (page: Page): Promise<number> =>
  page.evaluate(() => window.history.length);

/** The hash route a screen publishes, '#history' or '#meal/<id>', without the origin. */
const hashOf = (page: Page): string => new URL(page.url()).hash;

/** Waits until the route settles on what the opened screen claims to be. */
const expectRoute = async (page: Page, route: RegExp, what: string): Promise<void> => {
  await expect
    .poll(() => hashOf(page), { message: `the URL carries ${what}`, timeout: 5_000 })
    .toMatch(route);
};

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
 * The long weekdays and months the row header's ACCESSIBLE NAME is built from. The design
 * fixes that name as 'Thursday 25 September' while the visible label stays the short
 * 'Thu 25' the 360 px grid needs, and it is the only thing that identifies ONE row: over
 * ninety days the short label, and a weekday-and-day-number pattern with it, matches three
 * rows a month apart. These are fixed English words and not the reader's locale, so the
 * whole name is matched exactly. (The month SEPARATOR follows the locale, and nothing here
 * is matched on it.)
 */
const LONG_WEEKDAYS = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const;

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
] as const;

/** 'Thursday 25 September': the one name that picks out a single row of the ninety. */
const spokenDayName = (daysAgo: number): string => {
  const day = startOfLocalDay(daysAgo);
  return `${LONG_WEEKDAYS[day.getDay()]} ${day.getDate()} ${LONG_MONTHS[day.getMonth()]}`;
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
const labelCell = (page: Page, name: RegExp | string): Locator =>
  typeof name === 'string'
    ? page.getByRole('rowheader', { name, exact: true })
    : page.getByRole('rowheader', { name });

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
  const rows = await allRows(page);
  if ((await labelCell(page, WEEKDAY).count()) > 0) {
    // Matched on the row header's full accessible name -- weekday, day AND month -- because
    // that is the only thing that names one row rather than its two namesakes a month apart.
    const matching = rows.filter({ has: labelCell(page, spokenDayName(daysAgo)) });
    await expect(matching, `exactly one row for ${spokenDayName(daysAgo)}`).toHaveCount(1);
    return matching.first();
  }
  // A list exposes no row header. Its rows are one per date, newest first, which is asserted
  // in its own right, so the row is taken by position and its short label checked.
  const row = (await dayRows(page)).nth(daysAgo);
  expect(
    await textOf(await labelOf(row)),
    `row ${daysAgo + 1} is the date ${daysAgo} day(s) ago`,
  ).toMatch(dayLabel(daysAgo));
  return row;
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
 * The legend's entries: the banded things on the screen that are NOT cells of the grid.
 *
 * Located this way rather than by looking for a band published beside a WORD, which is what
 * this helper used to do. The legend's visible labels are now the ranges alone -- '70 ~ 140'
 * carries no letters at all -- so a word test would silently stop finding half the legend and
 * report a correct product as broken. The grid's own region is already located here, and the
 * legend sits outside it at the top of the screen, so 'banded but not in the grid' is the
 * legend without depending on how the legend itself is marked up.
 */
const legendEntries = async (page: Page, attribute: string): Promise<Locator[]> => {
  const nodes = page.locator(`[${attribute}]`);
  const entries: Locator[] = [];
  for (let index = 0; index < (await nodes.count()); index += 1) {
    const node = nodes.nth(index);
    // A cell always sits inside a row of the grid, whether the grid is a table or a list, and
    // a legend entry never does. Both tests are applied so that neither the grid's markup
    // choice nor where the legend is nested can turn a legend entry into a cell or back.
    const isCell = await node.evaluate((element) => {
      const inRow = element.closest('tr, [role="row"], li, [role="listitem"]') !== null;
      const region = element.closest('[role="region"]')?.getAttribute('aria-label') ?? '';
      return inRow || /history/i.test(region);
    });
    if (!isCell) {
      entries.push(node);
    }
  }
  return entries;
};

/** Which bands the legend publishes, whichever kind the view is coloured by. */
const bandsInLegend = async (page: Page, attribute: string): Promise<Set<string>> => {
  const named = new Set<string>();
  for (const entry of await legendEntries(page, attribute)) {
    const value = await entry.getAttribute(attribute);
    if (value !== null) named.add(value);
  }
  return named;
};

/** What one legend entry says out loud: its accessible name, or its text where it has none. */
const spokenNameOf = async (entry: Locator): Promise<string> => {
  const label = await entry.getAttribute('aria-label');
  if (label !== null && label.trim() !== '') return label.trim();
  const described = entry.locator('[aria-label]');
  if ((await described.count()) > 0) {
    return ((await described.first().getAttribute('aria-label')) ?? '').trim();
  }
  return textOf(entry);
};

/**
 * The legend fits on ONE ROW: four labels wrapping to a second row push the grid down the
 * screen and read as two groups rather than one scale. Read off the boxes, because that is
 * the only place 'one row' exists.
 */
const assertLegendOnOneRow = async (page: Page, attribute: string, view: string): Promise<void> => {
  const boxes = await Promise.all(
    (await legendEntries(page, attribute)).map((entry, index) =>
      rectOf(entry, `the ${view} legend's entry ${index + 1}`),
    ),
  );
  expect(boxes.length, `the ${view} legend has its four entries`).toBe(4);
  const tops = boxes.map((box) => box.y);
  expect(
    Math.max(...tops) - Math.min(...tops),
    `the ${view} legend fits on one row rather than wrapping to a second`,
  ).toBeLessThanOrEqual(4);
};

/**
 * The level legend: the range alone visible, and the meaning in the accessible name. The
 * range is what a person reading the colours needs; the word is what anyone not reading the
 * colours needs, and a legend that showed only the range would leave them nothing.
 */
const assertLevelLegend = async (page: Page): Promise<void> => {
  const entries = await legendEntries(page, 'data-level-band');
  expect(entries.length, 'the legend names the four level bands').toBe(4);

  for (const expected of LEVEL_LEGEND) {
    const matching = [] as Locator[];
    for (const entry of entries) {
      if ((await entry.getAttribute('data-level-band')) === expected.band) matching.push(entry);
    }
    expect(matching.length, `exactly one legend entry for '${expected.band}'`).toBe(1);
    const entry = matching[0] as Locator;
    expect(
      normaliseSigns(await textOf(entry)),
      `the '${expected.band}' legend entry shows its RANGE, which is all one row has room for`,
    ).toMatch(expected.range);
    expect(
      await spokenNameOf(entry),
      `the '${expected.band}' legend entry keeps its MEANING in its accessible name`,
    ).toContain(expected.spoken);
  }

  await assertLegendOnOneRow(page, 'data-level-band', 'level');
};

/** The change legend: the four ranges visible, and a word spoken for each. */
const assertChangeLegend = async (page: Page, view: string): Promise<void> => {
  const entries = await legendEntries(page, 'data-change-band');
  expect(entries.length, `the ${view} view's legend names the four change bands`).toBe(4);

  const visible = normaliseSigns(
    (await Promise.all(entries.map((entry) => textOf(entry)))).join(' | '),
  );
  for (const range of CHANGE_LEGEND_RANGES) {
    expect(visible, `the ${view} legend shows the range ${range.source}`).toMatch(range);
  }
  for (const entry of entries) {
    expect(
      await spokenNameOf(entry),
      `each ${view} legend entry says what its band MEANS, not only its range`,
    ).toMatch(/[A-Za-z]{3}/);
  }

  await assertLegendOnOneRow(page, 'data-change-band', 'change');
};

/**
 * 'very-high' is retired outright, so nothing on the screen may still publish it: a band
 * nothing can fall into is a rule nobody can read, and a legend entry for one is worse than
 * unused -- it tells the reader a colour exists that no reading of theirs will ever be.
 */
const assertRetiredBandGone = async (page: Page): Promise<void> => {
  await expect(
    page.locator(`[data-level-band="${RETIRED_LEVEL_BAND}"]`),
    `nothing publishes the retired '${RETIRED_LEVEL_BAND}' band`,
  ).toHaveCount(0);
  expect(
    await textOf(page.locator('body')),
    `and no wording is left over from '${RETIRED_LEVEL_BAND}'`,
  ).not.toMatch(/very high|over 250/i);
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
    // Nothing behind it: an empty outline carrying no band and no digits, because a missing
    // measurement is never drawn as a change of zero.
    await expect(located.locator('[data-level-band]'), `${where} carries no level band`).toHaveCount(0);
    await expect(located.locator('[data-change-band]'), `${where} carries no change band`).toHaveCount(0);
    expect(text, `${where} shows no number -- a missing measurement is not a zero`).not.toMatch(/\d/);
    // It IS tappable: backfilling is the reason History exists for somebody who has been
    // keeping this log on paper, and an untappable empty cell would make the one screen that
    // shows a missing day the one screen that cannot fill it. What it opens is asserted in
    // its own test below; here the claim is only that the control is offered, and that it
    // still says which day and which column it belongs to.
    expect(await controlCount(located), `${where} is one control that can be filled in`).toBe(1);
    const opener = await controlIn(located);
    const spokenEmpty = normaliseSigns((await opener.getAttribute('aria-label')) ?? '');
    expect(spokenEmpty, `${where} names its day`).toMatch(dayLabel(row.daysAgo));
    expect(spokenEmpty, `${where} names its column`).toMatch(cell.names);
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
    // Four fillable cells and not one reading: a day with nothing in it is exactly the day
    // somebody opens History to fill in.
    expect(
      await controlCount(row),
      `the empty row ${daysAgo} day(s) ago offers all four of its cells to fill in`,
    ).toBe(4);
    expect(
      normaliseSigns(await textOf(row)).replace(dayLabel(daysAgo), ''),
      `the empty row ${daysAgo} day(s) ago shows no reading`,
    ).not.toMatch(/\d/);
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

  // One row per calendar date, reaching back to whichever is earlier: ninety days ago or the
  // oldest entry. The oldest entry here is four days ago, so the floor is what decides, and
  // the rows past it are exactly the empty days this screen exists to fill in.
  const dayRowCount = await (await dayRows(phone)).count();
  expect(dayRowCount, 'the grid runs back at least ninety days').toBeGreaterThanOrEqual(
    MINIMUM_ROWS,
  );
  for (const daysAgo of [0, 4, MINIMUM_ROWS - 1]) {
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

  // The legend names the four level bands -- the range visible, the word spoken -- on one row.
  expect(
    [...(await bandsInLegend(phone, 'data-level-band'))].sort(),
    'the legend names the four level bands',
  ).toEqual([...LEVEL_BANDS].sort());
  await assertLevelLegend(phone);
  await assertRetiredBandGone(phone);

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
      [...(await bandsInLegend(phone, 'data-change-band'))].sort(),
      `the ${view} view's legend names the four change bands`,
    ).toEqual([...CHANGE_BANDS].sort());
    await assertChangeLegend(phone, view);

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

test('the rows mark where each month begins, because a short day label is ambiguous over ninety days', async ({
  browser,
}) => {
  const phone = await openHistory(browser, accounts.owner);

  // Every month the grid reaches, and only those: the label 'Tue 22' repeats three times
  // over ninety days, so a person scrolling back to a particular week cannot tell which
  // month they are looking at unless the grid says so.
  const monthName = (day: Date): string => day.toLocaleDateString(undefined, { month: 'long' });
  const reached = new Set<string>();
  for (let daysAgo = 0; daysAgo < MINIMUM_ROWS; daysAgo += 1) {
    reached.add(monthName(startOfLocalDay(daysAgo)));
  }

  const gridText = await textOf(grid(phone));
  for (const month of reached) {
    expect(gridText, `the grid marks where ${month} begins`).toContain(month);
  }

  // A month the grid does not reach is not named, so the separator marks this span rather
  // than being a fixed row of twelve.
  const beyond = monthName(startOfLocalDay(MINIMUM_ROWS + 40));
  if (!reached.has(beyond)) {
    expect(gridText, `${beyond} is outside the grid and is not named`).not.toContain(beyond);
  }
});

test('an empty cell is where a day kept on paper gets filled in', async ({ browser }) => {
  const phone = await openHistory(browser, accounts.owner);

  const day = startOfLocalDay(BACKFILL_DAYS_AGO);
  // Nothing whatever is seeded on this day, which is the point: the days worth backfilling
  // are by definition the days with nothing in them.
  const emptyDinner = await cellAt(await rowFor(phone, BACKFILL_DAYS_AGO), 3);
  await (await controlIn(emptyDinner)).click();

  await expect(
    phone.getByText(/new meal/i),
    'an empty slot cell opens a new entry rather than an editor for nothing',
  ).toBeVisible();

  // The slot is already chosen, because the cell says which slot it is.
  await expect(
    phone.getByRole('radio', { name: /^dinner$/i }),
    'the cell opened its own slot, already chosen',
  ).toBeChecked();

  // The date being recorded is named on the form, because it is not today: a backfilled
  // entry must never be mistakable for today's.
  const named = new RegExp(`${day.getDate()}\\b`);
  const formText = await textOf(phone.locator('body'));
  expect(formText, 'the form names the date it is recording against').toMatch(named);
  expect(formText, 'and says which month, so the day number cannot be read as today').toContain(
    day.toLocaleDateString(undefined, { month: 'long' }),
  );

  // Fill in the least a meal may be recorded with: a food, and the reading taken before it.
  // An amount is not required, so the food is its name and its type and nothing else.
  await phone.getByLabel('Glucose before', { exact: true }).fill('150');
  await phone.getByRole('button', { name: /^add food$/i }).click();
  await phone.getByLabel('Food name', { exact: true }).fill(BACKFILL_FOOD);
  // A food is an owned record, so nothing becomes one on its own: this account has never
  // eaten a Rice, so the name offers CREATION, and the type chooser appears only once that
  // offer is pressed. Reaching straight for the type would wait on a control a correct
  // product has not drawn yet. Had this been a food the account already owned it would be
  // chosen from the offers instead, which brings its type and asks for none.
  await phone
    .getByRole('button', { name: createFoodLabel(BACKFILL_FOOD), exact: true })
    .click();
  await phone.getByRole('radio', { name: /carb/i }).first().check();
  await phone.getByRole('button', { name: /^save$/i }).click();
  // The food is handed back to the meal before the meal itself is saved, so the second Save
  // is unambiguously the meal's.
  await expect(
    phone.getByText(new RegExp(BACKFILL_FOOD, 'i')).first(),
    'the food was kept on the meal',
  ).toBeVisible();
  await phone.getByRole('button', { name: /^save$/i }).click();

  // Saving records against THAT date rather than today, which is the whole claim: the row
  // eight days ago now holds the reading, in its dinner column, banded by its level.
  await navigate(phone, /^history$/i);
  await expect(grid(phone)).toBeVisible();
  const filled = await cellAt(await rowFor(phone, BACKFILL_DAYS_AGO), 3);
  expect(
    await textOf(filled),
    'the backfilled reading landed on the date the cell named',
  ).toContain('150');
  // 150 is ELEVATED -- 141 to 180 -- and this is the one cell in the whole oracle that falls
  // in that band, so the band that the new thresholds introduced is exercised by a real
  // reading rather than only named in the legend.
  await expect(
    filled.locator('[data-level-band]'),
    'and is banded by the same level rule as every other cell',
  ).toHaveAttribute('data-level-band', 'elevated');

  // It landed there and nowhere else: today's dinner cell is still empty.
  const todayDinner = await cellAt(await rowFor(phone, 0), 3);
  expect(
    await textOf(todayDinner),
    "a backfilled meal is not also recorded against today",
  ).not.toMatch(/\d/);

  // An empty night cell opens the night screen for ITS OWN night, ready to be filled in.
  const emptyNight = await cellAt(await rowFor(phone, BACKFILL_DAYS_AGO), 0);
  await (await controlIn(emptyNight)).click();
  const bedtime = phone.getByLabel('Bedtime glucose', { exact: true });
  await expect(bedtime, 'an empty night cell opens the night screen').toBeVisible();
  await expect(bedtime, 'with nothing in it, because nothing was recorded for that night').toHaveValue(
    '',
  );

  expect(await scrollsHorizontally(phone), 'filling in a cell never widens the page').toBe(false);
});

test('leaving a form opened from a cell returns to the grid, not to Today', async ({ browser }) => {
  const phone = await openHistory(browser, accounts.owner);

  // A slot cell leads to the edit form; Cancel is 'every other way of leaving' it, and it
  // must lead BACK to the grid the cell was tapped in. Sending it to Today would throw away
  // where the person was, which is worst exactly where it matters most: part-way down ninety
  // rows of somebody else's handwriting being copied in.
  const breakfast = await cellAt(await rowFor(phone, 2), 1);
  await (await controlIn(breakfast)).click();
  await expect(phone.getByLabel('Glucose before', { exact: true })).toBeVisible();

  await phone.getByRole('button', { name: /^cancel$/i }).click();
  await expect(grid(phone), 'cancelling an edit opened from a cell returns to History').toBeVisible();
  await expect(
    phone.getByRole('heading', { name: /^today$/i }),
    'and not to Today, which is not where the person was',
  ).toHaveCount(0);

  // An empty slot cell leads to New meal, and the same holds: nothing was recorded, and the
  // grid being backfilled is still what the person is in the middle of.
  const emptyDinner = await cellAt(await rowFor(phone, 6), 3);
  await (await controlIn(emptyDinner)).click();
  await expect(phone.getByText(/new meal/i)).toBeVisible();
  await phone.getByRole('button', { name: /^cancel$/i }).click();
  await expect(grid(phone), 'cancelling a backfill returns to History').toBeVisible();

  // And the night screen, which is a different editor reached from a different column.
  const night = await cellAt(await rowFor(phone, 2), 0);
  await (await controlIn(night)).click();
  await expect(phone.getByLabel('Bedtime glucose', { exact: true })).toBeVisible();
  await phone.getByRole('button', { name: /^cancel$/i }).click();
  await expect(grid(phone), 'leaving the night screen returns to History').toBeVisible();
  await expect(
    phone.getByRole('heading', { name: /^today$/i }),
    'the night screen came from History and goes back to it',
  ).toHaveCount(0);
});

test('returning to the grid returns to the same scroll position', async ({ browser }) => {
  const phone = await openHistory(browser, accounts.owner);

  // Part-way down the ninety rows, which is where a person backfilling a paper log spends
  // their time. The row is identified by its own accessible name, so what is measured is a
  // known date rather than 'whatever is on screen'.
  const deep = 45;
  const label = await labelOf(await rowFor(phone, deep));
  await label.scrollIntoViewIfNeeded();
  await phone.waitForTimeout(100);

  const scrolled = await scrollOffset(phone);
  expect(scrolled, 'the grid really is scrolled away from its top').toBeGreaterThan(0);
  const before = await rectOf(label, `the row ${deep} days ago`);

  // Leave through a cell and come straight back. Coming back to the top of ninety rows after
  // cancelling is barely better than being dumped on Today: the point of going back is to
  // carry on where you were.
  await (await controlIn(await cellAt(await rowFor(phone, deep), 2))).click();
  await expect(phone.getByText(/new meal/i)).toBeVisible();
  await phone.getByRole('button', { name: /^cancel$/i }).click();
  await expect(grid(phone)).toBeVisible();
  await phone.waitForTimeout(150);

  const after = await rectOf(
    await labelOf(await rowFor(phone, deep)),
    `the row ${deep} days ago on returning`,
  );
  expect(
    Math.abs(after.y - before.y),
    'the same day is in the same place on the screen as it was when the cell was tapped',
  ).toBeLessThanOrEqual(8);
  expect(
    Math.abs((await scrollOffset(phone)) - scrolled),
    'the remembered position is restored rather than the grid being redrawn at its top',
  ).toBeLessThanOrEqual(8);
});

test('the bottom navigation holds its place and the grid reserves room for it', async ({
  browser,
}) => {
  const phone = await openHistory(browser, accounts.owner);
  const height = viewportHeight(phone);

  const atRest = await rectOf(navigation(phone), 'the bottom navigation');
  expect(
    atRest.y + atRest.height,
    'the navigation sits at the bottom of the viewport, the way an Android bar does',
  ).toBeGreaterThanOrEqual(height - 2);

  await scrollToEnd(phone);
  expect(await scrollOffset(phone), 'ninety rows do scroll').toBeGreaterThan(0);

  const scrolledTo = await rectOf(navigation(phone), 'the bottom navigation after scrolling');
  expect(
    Math.abs(scrolledTo.y - atRest.y),
    'the navigation is FIXED: it holds its place while the grid scrolls underneath',
  ).toBeLessThanOrEqual(1);

  // The classic failure of a fixed bottom bar: the last row of the grid sits behind it,
  // visible but untappable, and invisible to anyone testing on a desktop window. The
  // scrolling area must reserve the bar's height, so the last day of the ninety clears it.
  const lastRow = (await dayRows(phone)).last();
  const last = await rectOf(lastRow, 'the last day row');
  expect(
    last.y + last.height,
    'scrolled to the end, the last day row clears the fixed navigation rather than hiding behind it',
  ).toBeLessThanOrEqual(scrolledTo.y + 1);

  // Its cells are reachable, not merely drawn: a row behind the bar can be seen and not used.
  const lastCell = await cellAt(lastRow, 3);
  const opener = await controlIn(lastCell);
  await opener.click();
  await expect(
    phone.getByText(/new meal/i),
    'the last row of the grid can actually be tapped',
  ).toBeVisible();

  // And a form opened from the grid reserves the same room: its last control must clear the
  // bar it keeps, or the way to save a backfilled meal is the thing hidden.
  await scrollToEnd(phone);
  const formNav = await rectOf(navigation(phone), 'the navigation on a form opened from History');
  expect(
    formNav.y + formNav.height,
    'the navigation is fixed on the form too',
  ).toBeGreaterThanOrEqual(height - 2);
  // The bottom-most control the form offers, whichever it happens to be: what matters is
  // that nothing a person has to reach ends up under the bar.
  const lowestControl = await phone.evaluate(() => {
    const content = document.querySelector('main') ?? document.body;
    let lowest = 0;
    for (const node of content.querySelectorAll('button, input, select, textarea, a[href]')) {
      const box = node.getBoundingClientRect();
      if (box.width > 0 && box.height > 0) lowest = Math.max(lowest, box.bottom);
    }
    return lowest;
  });
  expect(lowestControl, 'the form does offer controls').toBeGreaterThan(0);
  expect(
    lowestControl,
    'the form reserves room for the bar, so its lowest control is not left behind it',
  ).toBeLessThanOrEqual(formNav.y + 1);

  expect(await scrollsHorizontally(phone), 'reserving room never widens the page').toBe(false);
});

const styleOf = (locator: Locator, property: string): Promise<string> =>
  locator.evaluate(
    (node: Element, name: string) => getComputedStyle(node).getPropertyValue(name),
    property,
  );

/** An opaque background: a transparent sticky header shows the rows sliding through it. */
const isOpaque = (colour: string): boolean => {
  const parts = colour.match(/[\d.]+/g);
  if (parts === null) return false;
  return parts.length < 4 || Number(parts[3]) === 1;
};

/** The column header for one of the meal columns, however the grid is marked up. */
const columnHeader = async (page: Page, name: RegExp): Promise<Locator> => {
  const header = grid(page).getByRole('columnheader', { name });
  if ((await header.count()) > 0) return header.first();
  return grid(page).getByText(name).first();
};

test('the column headers stay pinned while the rows scroll underneath them', async ({
  browser,
}) => {
  const phone = await openHistory(browser, accounts.owner);

  const header = await columnHeader(phone, /breakfast/i);
  const atRest = await rectOf(header, "the 'Breakfast' column header");

  // The rows scroll inside THEIR OWN container: the page itself does not scroll on this
  // screen, which is what makes pinned headers worth having in the first place.
  const documentScrolls = await phone.evaluate(() => {
    const root = document.scrollingElement ?? document.documentElement;
    return root.scrollHeight > root.clientHeight + 1;
  });
  expect(
    documentScrolls,
    'the History page itself does not scroll; the grid scrolls within it',
  ).toBe(false);

  await scrollToEnd(phone);
  expect(await scrollOffset(phone), 'ninety rows do scroll somewhere').toBeGreaterThan(0);

  const scrolled = await rectOf(header, "the 'Breakfast' column header after scrolling");
  expect(
    Math.abs(scrolled.y - atRest.y),
    "'Breakfast' stays pinned to the top of the scrolling area rather than scrolling away",
  ).toBeLessThanOrEqual(1);
  await expect(header, 'and is still there to be read').toBeVisible();

  // A pinned header that is transparent, or painted below the cells, shows the rows sliding
  // through it -- which is the same wall of unlabelled numbers by another route. What is
  // asserted is what a reader would see: at the header's own centre, the header is on top.
  expect(
    isOpaque(await styleOf(header, 'background-color')),
    'the pinned header carries an OPAQUE background',
  ).toBe(true);
  const onTop = await phone.evaluate(
    ({ x, y }) => document.elementFromPoint(x, y)?.textContent?.trim() ?? '',
    { x: scrolled.x + scrolled.width / 2, y: scrolled.y + scrolled.height / 2 },
  );
  expect(
    onTop,
    'the header sits ABOVE the cells: a row passes underneath it rather than through it',
  ).toMatch(/breakfast/i);

  // The caption sits directly beneath the grid, above the navigation, and does not scroll
  // away with the rows: it says what the colour means, which is useless once it is gone.
  const caption = phone.getByText(LEVEL_CAPTION);
  await expect(caption, 'the caption is still on screen with the grid scrolled to its end').toBeVisible();
  const captionBox = await rectOf(caption, 'the caption');
  const navBox = await rectOf(navigation(phone), 'the bottom navigation');
  expect(
    captionBox.y,
    'the caption is beneath the column headers, not floating above the grid',
  ).toBeGreaterThan(atRest.y);
  expect(
    captionBox.y + captionBox.height,
    'and above the navigation rather than behind it',
  ).toBeLessThanOrEqual(navBox.y + 1);

  expect(await scrollsHorizontally(phone), 'pinning a header never widens the page').toBe(false);
});

test('a month separator is a landmark, told apart from the day labels it sits among', async ({
  browser,
}) => {
  const phone = await openHistory(browser, accounts.owner);

  // A month rendered like the dates is one more line of the same grey doing nothing, and a
  // landmark you cannot pick out is not one.
  //
  // The separator taken is the CURRENT month's separator, which sits near the TOP of the newest-first grid. The
  // oldest month's sits near the bottom, where there is almost nothing left to scroll, so a
  // stationary row there would read as a stuck one -- a false negative, not a measurement.
  const monthName = (day: Date): string => day.toLocaleDateString(undefined, { month: 'long' });
  const newest = monthName(startOfLocalDay(0));
  const separator = grid(phone).getByText(newest, { exact: true }).first();
  await expect(separator, `the grid marks where ${newest} begins`).toBeVisible();

  const label = await labelOf(await rowFor(phone, 0));

  expect(
    Number(await styleOf(separator, 'font-weight')),
    'the month is heavier than the dates it sits among',
  ).toBeGreaterThan(Number(await styleOf(label, 'font-weight')));
  expect(
    await styleOf(separator, 'color'),
    'and a different colour from the muted ink the dates use',
  ).not.toBe(await styleOf(label, 'color'));

  // It stays a ROW of the grid rather than a sticky band, so scrolling past it is how you
  // leave a month: scrolled to the end, it has moved with the rows.
  //
  // The separator is brought to the top of its own container first, so there is a full grid's
  // worth of rows left to scroll past it; and the scroll is required to have MOVED before any
  // conclusion is drawn from a position, since a scroll that does nothing is otherwise
  // indistinguishable from an element that sticks.
  await scrollGridToTopOf(phone, separator);
  const beforeScroll = await rectOf(separator, `the ${newest} separator`);
  const moved = await scrollGrid(phone, 'end');
  expect(
    moved.to - moved.from,
    "the grid's own container really did scroll, so what follows measures the separator",
  ).toBeGreaterThan(1);
  const afterScroll = await separator.boundingBox();
  expect(
    afterScroll === null || Math.abs(afterScroll.y - beforeScroll.y) > 1,
    'the separator scrolls with its rows rather than sticking to the top of the grid',
  ).toBe(true);

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
      [...(await bandsInLegend(phone, view === 'before' ? 'data-level-band' : 'data-change-band'))]
        .sort(),
      `${view}: the legend still names its four bands`,
    ).toEqual([...(view === 'before' ? LEVEL_BANDS : CHANGE_BANDS)].sort());
    if (view === 'before') {
      await assertLevelLegend(phone);
      await assertRetiredBandGone(phone);
    } else {
      await assertChangeLegend(phone, view);
    }
    // Every cell is offered to fill in, because this account's log is empty and backfilling
    // is what an empty grid is for. That is a control per cell and not one reading.
    const strangerRow = await rowFor(phone, 3);
    expect(
      await controlCount(strangerRow),
      `${view}: an account with nothing recorded is still offered every cell to fill in`,
    ).toBe(4);
    // And not one of them is banded, because no cell has anything behind it -- which is the
    // stronger statement than counting digits, since day labels carry digits of their own.
    await expect(strangerRow.locator('[data-level-band]')).toHaveCount(0);
    await expect(strangerRow.locator('[data-change-band]')).toHaveCount(0);
  }
});

// --- Back, the URL and the stack --------------------------------------------
//
// In-app navigation goes through the browser's history. On Android Back is the primary way
// people move around, so an app that changes screen without pushing an entry ejects the person
// on the gesture they use most: Back has nothing to pop but the previous website. These cases
// drive the gesture itself rather than the controls.

test("the device's Back returns to the grid, at the position it was left at, without leaving the site", async ({
  browser,
}) => {
  const phone = await openHistory(browser, accounts.owner);
  await expectRoute(phone, /^#history/, 'the History route');
  const origin = new URL(phone.url()).origin;

  // Part-way down the ninety rows, which is where a person backfilling a paper log spends
  // their time, and the place where being dumped at the top hurts most.
  const deep = 45;
  await (await labelOf(await rowFor(phone, deep))).scrollIntoViewIfNeeded();
  await phone.waitForTimeout(100);
  const scrolled = await scrollOffset(phone);
  expect(scrolled, 'the grid really is scrolled away from its top').toBeGreaterThan(0);
  const before = await rectOf(await labelOf(await rowFor(phone, deep)), `the row ${deep} days ago`);

  // The same journey the Cancel case makes, left by the gesture instead of the control.
  await (await controlIn(await cellAt(await rowFor(phone, deep), 2))).click();
  await expect(phone.getByText(/new meal/i)).toBeVisible();
  const entriesOnForm = await historyLength(phone);
  expect(
    entriesOnForm,
    'opening a screen PUSHES an entry, or Back has nothing of this app to pop',
  ).toBeGreaterThan(1);

  await phone.goBack();
  await expect(grid(phone), 'Back from a form opened in History returns to History').toBeVisible();
  expect(
    new URL(phone.url()).origin,
    'Back moved inside the app rather than leaving the site',
  ).toBe(origin);
  await expectRoute(phone, /^#history/, 'the History route again');
  await phone.waitForTimeout(150);

  // And it restores the position, exactly as Cancel does: one way back, so the two cannot
  // drift apart.
  const after = await rectOf(
    await labelOf(await rowFor(phone, deep)),
    `the row ${deep} days ago after Back`,
  );
  expect(
    Math.abs(after.y - before.y),
    'the same day is in the same place on the screen as when the cell was tapped',
  ).toBeLessThanOrEqual(8);
  expect(
    Math.abs((await scrollOffset(phone)) - scrolled),
    'Back restores the remembered position rather than redrawing the grid at its top',
  ).toBeLessThanOrEqual(8);

  // The night screen is a different editor reached from a different column, and the gesture
  // is the same one way back.
  await (await controlIn(await cellAt(await rowFor(phone, 2), 0))).click();
  await expect(phone.getByLabel('Bedtime glucose', { exact: true })).toBeVisible();
  await phone.goBack();
  await expect(grid(phone), 'Back from the night screen returns to History').toBeVisible();
  await expect(
    phone.getByRole('heading', { name: /^today$/i }),
    'and not to Today, which is not where the person was',
  ).toHaveCount(0);
});

test("a meal's own URL reloads to that meal, because the screen's identity is in the route", async ({
  browser,
}) => {
  const phone = await openHistory(browser, accounts.owner);
  await expectRoute(phone, /^#history/, 'the History route');

  // The two-days-ago breakfast, 104 to 186. Opening it must change the route: that is what
  // makes a reload and a Back possible at all.
  await (await controlIn(await cellAt(await rowFor(phone, 2), 1))).click();
  await expect(phone.getByLabel('Glucose before', { exact: true })).toHaveValue('104');
  await expectRoute(phone, /^#meal\/.+/, "that meal's own route");
  const mealUrl = phone.url();

  // A hash route rather than a path because GitHub Pages serves static files, so this reload
  // is also the assertion that the route survives being asked for cold.
  await phone.reload();
  await expect(
    phone.getByLabel('Glucose before', { exact: true }),
    'the meal URL reloads to that meal rather than to some default screen',
  ).toHaveValue('104');
  await expect(phone.getByLabel('Glucose after', { exact: true })).toHaveValue('186');
  expect(phone.url(), 'and the URL is unchanged by the reload').toBe(mealUrl);
});

test('the first screen replaces its entry, so Back from it leaves the site', async ({ browser }) => {
  const context = await browser.newContext({ viewport: PHONE_VIEWPORT });
  const phone = await context.newPage();
  await phone.goto(stack.siteUrl);
  await expect(signInForm(phone), 'the first screen renders').toBeVisible();
  await signIn(phone, accounts.owner);

  // The first screen after the session change is the one navigation that REPLACES its entry.
  // What is observable is the CLAIM that makes: the app holds exactly one entry of its own,
  // so Back from that first screen leaves the site rather than cycling inside the app. The
  // count between the document loading and the app's first render cannot be observed at all --
  // the goto is itself a navigation -- so the baseline is taken here, on the first screen.
  await expect(phone.getByRole('heading', { name: /^today$/i })).toBeVisible();
  await expectRoute(phone, /^#.+/, 'a route for the first screen');
  const onFirstScreen = await historyLength(phone);

  // Every OTHER navigation pushes, so opening a second screen grows the stack by exactly one.
  // A replace flag that survived its one intended use would show up here as no growth at all,
  // and then as Back leaving the site one screen too early.
  await navigate(phone, /^history$/i);
  await expect(grid(phone), 'the second screen opens').toBeVisible();
  await expectRoute(phone, /^#history/, 'the History route');
  expect(
    await historyLength(phone),
    'opening a screen PUSHES exactly one entry',
  ).toBe(onFirstScreen + 1);

  // Back from the second screen returns to the first, inside the app.
  await phone.goBack();
  await expect(
    phone.getByRole('heading', { name: /^today$/i }),
    'Back from the second screen returns to the first',
  ).toBeVisible();
  expect(
    await historyLength(phone),
    'going back does not change how many entries there are',
  ).toBe(onFirstScreen + 1);

  // And Back from the FIRST screen leaves the site, which is the claim: the first render
  // replaced its entry rather than pushing one, so there is nothing of this app behind it.
  await phone.goBack();
  await expect
    .poll(() => phone.url(), {
      message: 'Back from the first screen leaves the site rather than cycling inside the app',
      timeout: 5_000,
    })
    .toBe('about:blank');
});

test('after signing out, Back cannot walk back into the account that just left', async ({
  browser,
}) => {
  const phone = await openHistory(browser, accounts.owner);

  // Deep enough in that there are entries behind this one for Back to find.
  await (await controlIn(await cellAt(await rowFor(phone, 2), 1))).click();
  await expect(phone.getByLabel('Glucose before', { exact: true })).toHaveValue('104');
  await phone.goBack();
  await expect(grid(phone)).toBeVisible();

  await phone.getByRole('button', { name: /^sign out$/i }).click();
  await expect(signInForm(phone), 'signing out shows the sign-in screen').toBeVisible();

  // Signing out REPLACES the stack, so the gesture cannot reveal a screen belonging to the
  // account that left -- not the grid, and not that account's readings on a form.
  await phone.goBack();
  await expect(
    signInForm(phone),
    'Back after signing out stays on the sign-in screen',
  ).toBeVisible();
  await expect(grid(phone), "and never shows the signed-out account's grid").toHaveCount(0);
  for (const label of ['Glucose before', 'Glucose after', 'Bedtime glucose']) {
    await expect(
      phone.getByLabel(label, { exact: true }),
      `no data-entry control (${label}) is reachable after signing out`,
    ).toHaveCount(0);
  }
  const body = await textOf(phone.locator('body'));
  for (const reading of ['104', '186', '260', '190']) {
    expect(body, `the ${reading} of the account that left is gone`).not.toContain(reading);
  }
});
