import { test, expect, type Browser, type Locator, type Page } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { startLocalStack, type LocalStack } from '../support/local-stack';
import { createAccounts, removeAccounts, type Account, type SeededAccounts } from '../support/accounts';

/**
 * Public oracle for value 10: lookup by food.
 *
 * Observation: typing a food lists past meals that contain it, with a summary of typical
 * amount, typical dose and average change, and each result opens the meal.
 *
 * Like every earlier value the oracle drives the built static bundle in a real browser
 * against the Supabase CLI local stack, so every figure on the screen is arithmetic over
 * what Postgres held and gave back through real row-level security.
 *
 * The claims this oracle is built around:
 *
 *  - A meal matches when any food's name CONTAINS the typed text, trimmed and
 *    case-insensitively: 'rice' finds 'Chicken rice', and the Oats breakfast is not a match.
 *  - Results are newest first by date, and each one reads as its date and slot, its dose,
 *    its foods with amounts, and its two readings with the banded change.
 *  - The three summary figures are the arithmetic the design spells out, over the matching
 *    meals only, and EACH figure says how many meals it is over:
 *      typical amount = median of 250, 220, 300, 250 in grams -> 250 g, over 4 meals
 *      typical dose   = median of 6, 6, 5, 8                  -> 6 u,  over 4 meals
 *      average change = mean of +32, +21, +56                 -> +36,  over 3 MEALS
 *    The twelve-day-old meal has no after reading, so it is listed but contributes nothing
 *    to the average: a change nobody measured is not a change of zero, and the count of 3
 *    beside a list of 4 results is what makes that visible.
 *  - A median over an even count is the mean of the two middle values; both even medians
 *    here (250 and 6) are asserted against the sorted fixture rather than against a guess.
 *  - No match means no summary at all and 'No meals with that food yet.', because a summary
 *    over nothing would print figures with no meals behind them.
 *  - A typical dose is a REPORT of what was taken before, never a proposal, so the summary
 *    is checked to carry no language of advice.
 *
 * Bands are asserted by NAME and never by colour. Widgets are located tolerantly -- whether
 * a result is a list item or a card, and how a date is worded, are presentation choices; the
 * matching, the ordering, the figures and the bands are not. The summary and the results area
 * are the design's own two named parts of this screen, so each is located as a region named
 * after it.
 */

const PHONE_VIEWPORT = { width: 360, height: 780 } as const;

/** This spec's own email prefix: it removes these accounts and their rows, and nothing else. */
const EMAIL_PREFIX = 'lookup-by-food';

const NO_MATCHES = 'No meals with that food yet.';

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

type SeedFood = {
  readonly name: string;
  readonly type: string;
  readonly amount: number;
  readonly unit: string;
};

type SeedMeal = {
  readonly daysAgo: number;
  readonly slot: 'breakfast' | 'lunch' | 'dinner';
  readonly hour: number;
  readonly minute: number;
  readonly before: number;
  readonly after?: number;
  readonly units: number;
  readonly foods: readonly SeedFood[];
};

const RICE: SeedFood = { name: 'Chicken rice', type: 'mixed dish', amount: 250, unit: 'g' };

/**
 * The clock times are the oracle's own choice: the stimulus fixes the dates, the doses, the
 * readings and the foods, and every matching meal is on a different date, so the ordering
 * under test is decided by the date alone and no time here can flatter it.
 */
const seedMeals: readonly SeedMeal[] = [
  {
    daysAgo: 2,
    slot: 'dinner',
    hour: 19,
    minute: 10,
    before: 110,
    after: 142,
    units: 6,
    foods: [RICE, { name: 'Cucumber salad', type: 'vegetable', amount: 80, unit: 'g' }],
  },
  {
    daysAgo: 5,
    slot: 'lunch',
    hour: 12,
    minute: 55,
    before: 103,
    after: 124,
    units: 6,
    foods: [
      { ...RICE, amount: 220 },
      { name: 'Soup', type: 'mixed dish', amount: 150, unit: 'ml' },
    ],
  },
  {
    daysAgo: 9,
    slot: 'dinner',
    hour: 19,
    minute: 0,
    before: 122,
    after: 178,
    units: 5,
    foods: [{ ...RICE, amount: 300 }],
  },
  {
    // No after reading: listed as a meal that contained the food, and contributing nothing
    // to the average change.
    daysAgo: 12,
    slot: 'dinner',
    hour: 19,
    minute: 20,
    before: 130,
    units: 8,
    foods: [RICE],
  },
  {
    // Contains no rice, so it must never appear among the results.
    daysAgo: 3,
    slot: 'breakfast',
    hour: 7,
    minute: 40,
    before: 95,
    after: 150,
    units: 4,
    foods: [{ name: 'Oats', type: 'carb-heavy', amount: 60, unit: 'g' }],
  },
];

/**
 * What the non-matching breakfast records, none of which may reach a 'rice' result. Its after
 * reading of 150 is deliberately NOT in this list: the five-day-old match genuinely reads
 * 'Soup 150 ml', so absence of the bare number would be a false failure. Its name, its amount,
 * its before reading and its dose are each unique to it and carry the claim.
 */
const OATS_VALUES = ['Oats', '60 g', '95', '4 u'] as const;

// --- What each result must read ---------------------------------------------

type ResultExpectation = {
  readonly daysAgo: number;
  readonly slot: RegExp;
  /** Every fragment the result must contain. Minus signs are normalised before matching. */
  readonly reads: readonly string[];
  /** The change band, or null when the meal has no after reading and so has no change. */
  readonly band: string | null;
};

/** Newest first by date: two, five, nine, then twelve days ago. */
const expectedResults: readonly ResultExpectation[] = [
  {
    daysAgo: 2,
    slot: /dinner/i,
    reads: ['6 u', 'Chicken rice 250 g', 'Cucumber salad 80 g', '110', '142', '+32'],
    band: 'rose',
  },
  {
    daysAgo: 5,
    slot: /lunch/i,
    reads: ['6 u', 'Chicken rice 220 g', 'Soup 150 ml', '103', '124', '+21'],
    band: 'stable',
  },
  {
    daysAgo: 9,
    slot: /dinner/i,
    reads: ['5 u', 'Chicken rice 300 g', '122', '178', '+56'],
    band: 'rose',
  },
  {
    daysAgo: 12,
    slot: /dinner/i,
    reads: ['8 u', 'Chicken rice 250 g', '130'],
    band: null,
  },
];

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
    const foods = await admin.from('meal_foods').insert(
      meal.foods.map((food, index) => ({
        user_id: owner.id,
        meal_id: inserted.data.id,
        name: food.name,
        food_type: food.type,
        amount: food.amount,
        unit: food.unit,
        position: index + 1,
      })),
    );
    if (foods.error) {
      throw new Error(`could not seed that meal's foods: ${foods.error.message}`);
    }
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

const navigation = (page: Page): Locator => page.getByRole('navigation');

/** An entry may be a link or a button: that is a presentation choice. */
const navigate = async (page: Page, name: RegExp): Promise<void> => {
  const nav = navigation(page);
  const entry = nav.getByRole('link', { name });
  if ((await entry.count()) > 0) {
    await entry.first().click();
    return;
  }
  await nav.getByRole('button', { name }).first().click();
};

/**
 * The search field is located by its real label. The label is visually hidden because the
 * field sits behind a search icon, and hidden is not absent: this is what the field is called
 * to anyone not looking at it, so an implementation that drops the label fails here.
 */
const searchField = (page: Page): Locator => page.getByLabel('Search past meals', { exact: true });

const summary = (page: Page): Locator => page.getByRole('region', { name: /summary/i });
const results = (page: Page): Locator => page.getByRole('region', { name: /results/i });

const openLookup = async (browser: Browser, account: Account): Promise<Page> => {
  const page = await openPhone(browser);
  await signIn(page, account);
  await navigate(page, /^lookup$/i);
  await expect(searchField(page), 'Lookup is reached from the bottom navigation').toBeVisible();
  return page;
};

/** The result rows, however they are marked up. */
const resultRows = async (page: Page): Promise<Locator> => {
  for (const role of ['listitem', 'article', 'row', 'group'] as const) {
    const found = results(page).getByRole(role);
    if ((await found.count()) > 0) {
      return found;
    }
  }
  return results(page).getByRole('listitem');
};

/** The one control a result is, whether it is a button, a link, or the row itself. */
const controlIn = async (row: Locator): Promise<Locator> => {
  for (const role of ['link', 'button'] as const) {
    const found = row.getByRole(role);
    if ((await found.count()) > 0) {
      return found.first();
    }
  }
  return row;
};

const controlCount = async (row: Locator): Promise<number> =>
  (await row.getByRole('link').count()) + (await row.getByRole('button').count());

const dayLabel = (daysAgo: number): RegExp => {
  const day = startOfLocalDay(daysAgo);
  // Weekday plus day of month, which is common to every short date form this app uses.
  return new RegExp(`(Mon|Tue|Wed|Thu|Fri|Sat|Sun)\\w*\\s*\\S*\\s*0?${day.getDate()}\\b`, 'i');
};

const typeQuery = async (page: Page, query: string): Promise<void> => {
  await searchField(page).fill(query);
};

/**
 * One summary figure's own text. The three figure names are fixed by the design, so the
 * summary text is cut at them: a figure runs from its own name to whichever other name comes
 * next, whatever order the screen puts them in. This binds a count to the figure it belongs
 * to without assuming how the figures are nested.
 */
const FIGURE_NAMES = ['typical amount', 'typical dose', 'average change'] as const;

const figureText = async (page: Page, figure: (typeof FIGURE_NAMES)[number]): Promise<string> => {
  const whole = normaliseSigns(await textOf(summary(page)));
  const lower = whole.toLowerCase();
  const start = lower.indexOf(figure);
  expect(start, `the summary names '${figure}'`).toBeGreaterThanOrEqual(0);
  const ends = FIGURE_NAMES.filter((other) => other !== figure)
    .map((other) => lower.indexOf(other))
    .filter((at) => at > start);
  const end = ends.length > 0 ? Math.min(...ends) : whole.length;
  return whole.slice(start, end);
};

// --- The oracle -------------------------------------------------------------

test('typing a food summarises and lists every past meal that contained it', async ({ browser }) => {
  const phone = await openLookup(browser, accounts.owner);

  // The navigation now carries Lookup, which value 9's design said would arrive here.
  const navText = await textOf(navigation(phone));
  expect(navText, 'the navigation carries Today').toMatch(/today/i);
  expect(navText, 'the navigation carries Lookup').toMatch(/lookup/i);
  expect(navText, 'the navigation carries History').toMatch(/history/i);
  expect(navText, 'Settings is in no value and is not built').not.toMatch(/settings/i);

  // An empty search box invites a search rather than listing everything the account owns.
  await expect(summary(phone), 'no query, no summary').toHaveCount(0);
  await expect(await resultRows(phone), 'an empty box lists nothing').toHaveCount(0);
  const beforeTyping = await textOf(phone.locator('body'));
  for (const reading of ['110', '142', '122', '178']) {
    expect(beforeTyping, `an empty box does not list ${reading}`).not.toContain(reading);
  }

  await typeQuery(phone, 'rice');

  // Four matching meals: the three with both readings and the one with only a before.
  await expect(await resultRows(phone), 'four meals contained rice').toHaveCount(4);

  // --- The summary ---------------------------------------------------------
  const summaryText = normaliseSigns(await textOf(summary(phone)));
  expect(summaryText, 'the summary names the food it matched').toContain('Chicken rice');
  expect(summaryText, 'the summary names how many meals matched').toMatch(/\b4 meals\b/);

  // Median of 220, 250, 250, 300 grams: an even count, so the mean of the two middle
  // values, which is 250. Reported with its unit.
  const amount = await figureText(phone, 'typical amount');
  expect(amount, 'the typical amount is the median of the matched food, with its unit').toContain(
    '250 g',
  );
  expect(amount, 'the typical amount says how many meals it is over').toMatch(/\b4 meals\b/);

  // Median of 5, 6, 6, 8: the mean of the two middle values, which is 6.
  const dose = await figureText(phone, 'typical dose');
  expect(dose, 'the typical dose is the median of the recorded doses').toContain('6 u');
  expect(dose, 'the typical dose says how many meals it is over').toMatch(/\b4 meals\b/);

  // Mean of +32, +21 and +56 is 36.33..., which rounds to 36, written with its sign. The
  // twelve-day-old meal has no after reading and contributes NOTHING: the figure is over
  // three meals, not four, and a fourth term of zero would give +27 and fail here.
  const change = await figureText(phone, 'average change');
  expect(change, 'the average change is the mean of the three measured changes').toContain('+36');
  expect(
    change,
    'the average change is over the three meals that have both readings, not all four',
  ).toMatch(/\b3 meals\b/);

  // A typical dose reports what was taken before. It is never a proposal.
  expect(summaryText, 'the summary never recommends a dose').not.toMatch(
    /recommend|suggest|advice|advise|you should/i,
  );

  // --- The results ---------------------------------------------------------
  const rows = await resultRows(phone);
  for (const [index, expected] of expectedResults.entries()) {
    const where = `result ${index} (${expected.daysAgo} day(s) ago)`;
    const row = rows.nth(index);
    const text = normaliseSigns(await textOf(row));

    // Newest first: position index carries the date it must.
    expect(text, `${where} names its date`).toMatch(dayLabel(expected.daysAgo));
    expect(text, `${where} names its slot`).toMatch(expected.slot);
    for (const fragment of expected.reads) {
      expect(text, `${where} reads ${fragment}`).toContain(fragment);
    }

    if (expected.band === null) {
      // No after reading, so no change and no band. A missing measurement must never be
      // drawn as a change of zero, nor as a signed number of any kind.
      await expect(
        row.locator('[data-change-band]'),
        `${where} has no after reading, so carries no change band`,
      ).toHaveCount(0);
      expect(text, `${where} shows no change at all`).not.toMatch(/[+-]\s?\d/);
      expect(text, `${where} shows only the reading it has`).not.toContain('142');
    } else {
      const banded = row.locator('[data-change-band]');
      await expect(banded, `${where} publishes exactly one change band`).toHaveCount(1);
      await expect(banded, `${where} is banded by the rule`).toHaveAttribute(
        'data-change-band',
        expected.band,
      );
    }

    // A result is one control, because it opens that meal.
    expect(await controlCount(row), `${where} offers one way to open its meal`).toBeLessThanOrEqual(1);
  }

  // The breakfast with Oats contains no rice, so nothing of it is here.
  const resultsText = await textOf(results(phone));
  for (const value of OATS_VALUES) {
    expect(resultsText, `the Oats breakfast is not a rice match: ${value}`).not.toContain(value);
  }

  expect(await scrollsHorizontally(phone), 'the lookup fits 360 px').toBe(false);
});

test('a result opens that meal', async ({ browser }) => {
  const phone = await openLookup(browser, accounts.owner);
  await typeQuery(phone, 'rice');
  await expect(await resultRows(phone)).toHaveCount(4);

  // The newest match: the dinner two days ago, 110 to 142 at 6 units.
  await (await controlIn((await resultRows(phone)).first())).click();

  const detail = phone.getByRole('region', { name: /meal detail/i });
  await expect(detail, 'the result opened a meal detail').toBeVisible();
  const detailText = await textOf(detail);
  expect(detailText, 'the result opened the dinner it named').toMatch(/dinner/i);
  // The detail is value 6's screen and value 6's design fixes its shape: what was eaten lists
  // the food's name, its type and its amount as three separate items, so the detail reads
  // 'Chicken rice Mixed dish 250 g'. The contiguous 'Chicken rice 250 g' is the LOOKUP
  // RESULT's wording, asserted on the result card above, and asserting it here would demand
  // the detail drop the food type that value 6 requires. So the parts are asserted as parts.
  for (const fragment of ['110', '142', '6 u', 'Chicken rice', '250 g']) {
    expect(detailText, `the detail reads ${fragment}`).toContain(fragment);
  }

  expect(await scrollsHorizontally(phone)).toBe(false);
});

test('a food never eaten has no summary and says so', async ({ browser }) => {
  const phone = await openLookup(browser, accounts.owner);

  await typeQuery(phone, 'quinoa');

  await expect(results(phone).getByText(NO_MATCHES), 'the results area says so').toBeVisible();
  await expect(
    summary(phone),
    'a summary over nothing would print figures with no meals behind them',
  ).toHaveCount(0);
  await expect(await resultRows(phone), 'nothing matched, so nothing is listed').toHaveCount(0);
  await expect(results(phone).locator('[data-change-band]')).toHaveCount(0);

  const bodyText = normaliseSigns(await textOf(phone.locator('body')));
  for (const figure of FIGURE_NAMES) {
    expect(bodyText.toLowerCase(), `no ${figure} is shown with no matches`).not.toContain(figure);
  }

  // Trimmed and case-insensitive containment is what matching means, so the same query in
  // another case and with surrounding space finds the same four meals.
  await typeQuery(phone, '  RICE ');
  await expect(
    await resultRows(phone),
    'matching is trimmed and case-insensitive containment',
  ).toHaveCount(4);

  expect(await scrollsHorizontally(phone)).toBe(false);
});

test('the screen carries the three tabs and looks up By food', async ({ browser }) => {
  const phone = await openLookup(browser, accounts.owner);

  const tab = async (name: RegExp): Promise<Locator> => {
    const asTab = phone.getByRole('tab', { name });
    return (await asTab.count()) > 0 ? asTab.first() : phone.getByRole('button', { name }).first();
  };

  const selected = async (control: Locator): Promise<string | null> =>
    (await control.getAttribute('aria-selected')) ?? (await control.getAttribute('aria-pressed'));

  // All three tabs are on screen, because the canvas makes them one screen and a person
  // moves between them.
  for (const name of [/^by food$/i, /^by change$/i, /^by start$/i]) {
    await expect(await tab(name), `${name} is on screen`).toBeVisible();
  }

  // By food is the tab this value implements, and the one the screen looks up in: its own
  // field, summary and results are what the earlier tests assert.
  const byFood = await tab(/^by food$/i);
  expect(await selected(byFood), 'By food is the tab this value works in').toBe('true');
  await expect(searchField(phone), 'By food carries the search field').toBeAttached();
  await typeQuery(phone, 'rice');
  await expect(await resultRows(phone), 'By food is the tab that looks up a food').toHaveCount(4);

  // Whether 'By change' and 'By start' are SELECTABLE is deliberately not asserted, in
  // either direction. Values 11 and 12 make them selectable one at a time, so pinning that
  // property here would make this oracle fail for a reason that has nothing to do with
  // looking up a food. What is fixed is that the three tabs exist and that By food works.

  expect(await scrollsHorizontally(phone)).toBe(false);
});

test("another account's lookup reaches none of the owner's meals", async ({ browser }) => {
  const phone = await openLookup(browser, accounts.stranger);

  // Row-level security is the only thing that scopes a read, and this account recorded
  // nothing at all.
  await typeQuery(phone, 'rice');

  await expect(results(phone).getByText(NO_MATCHES), 'a stranger matches nothing').toBeVisible();
  await expect(summary(phone), "no summary over another account's meals").toHaveCount(0);
  await expect(await resultRows(phone)).toHaveCount(0);

  const bodyText = await textOf(phone.locator('body'));
  for (const owned of ['Chicken rice', '110', '142', '103', '124', '122', '178', '130']) {
    expect(bodyText, `the owner's ${owned} is not in this lookup`).not.toContain(owned);
  }
});
