import { test, expect, type Browser, type Locator, type Page } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { startLocalStack, type LocalStack } from '../support/local-stack';
import { createAccounts, removeAccounts, type Account, type SeededAccounts } from '../support/accounts';

/**
 * Public oracle for value 12: lookup by start.
 *
 * Observation: entering a starting reading and a window (±5, ±10, ±20) lists past meals whose
 * before reading was nearest, nearest first, each showing dose, before → after, the change and
 * how far off it was.
 *
 * As in every earlier value the oracle drives the built static bundle in a real browser against
 * the Supabase CLI local stack, so the window, the distances and the order are computed over what
 * Postgres held and gave back through real row-level security.
 *
 * The claims this oracle is built around:
 *
 *  - The quantity matched is the meal's BEFORE reading. With a target of 145 the seven seeded
 *    meals sit at distances 0 (145), 1 (146), 3 (148), 3 (142), 7 (138), 15 (160) and 55 (200).
 *    A window is a TOLERANCE, not a ranking, so:
 *      ±5  lists the 0, 1, 3 and 3 meals and nothing else;
 *      ±10 admits the 138 meal last, 7 off;
 *      ±20 admits the 160 meal last, 15 off.
 *    The 200 meal is 55 off and absent from every window.
 *  - The windows are THIS value's three, ±5, ±10 and ±20, defaulting to ±10. They are not value
 *    11's ±2, ±5 and ±10: a tolerance on a reading is a coarser thing than one on a change. Every
 *    case that asserts a row count therefore selects its window explicitly rather than leaning on
 *    the default, which is chosen for no particular target.
 *  - A meal with a before reading but NO after reading is still matched and listed -- the 146
 *    meal, 1 off -- showing its dose and its before reading with NO change and no change band.
 *    Where it started is exactly what was asked, and a missing ending must not be drawn as one.
 *  - The order is distance first, then date newer first. The fixture ties deliberately: 148 and
 *    142 are both 3 off, and the 148 meal is the newer, so it must come first. The tie-break is
 *    thus under test inside the window cases rather than needing a target of its own.
 *  - A distance reads in WORDS: 'exact' at zero, otherwise 'N off'. '0 off' fails, because zero
 *    distance is a different statement from a distance of zero units, and a signed distance fails
 *    because it would read as another change.
 *  - A result is the same card the other two lookups use, and it opens that meal's detail.
 *  - A reading with nothing in the window says 'No meals within that window.' -- naming the
 *    window, not the reading -- and leaves the chips usable, so widening is one tap away.
 *
 * Every number in the fixture is distinct from every other -- every before reading, after reading,
 * change, dose and food amount -- so an assertion that a value is absent from the results cannot
 * be satisfied or broken by a different meal that happens to share it.
 *
 * One clause of the design's falsifier is NOT encoded here: 'a meal with no before reading is
 * listed'. The declared stimulus seeds seven meals and every one of them has a before reading, so
 * falsifying that clause would need an eighth meal this oracle has no authority to invent. It is
 * recorded here rather than quietly dropped.
 *
 * Bands are asserted by NAME and never by colour. Widgets are located tolerantly: whether a window
 * chip is a radio or a button, and how a date is worded, are presentation choices. The lookup TABS
 * are not tolerated that way: they are a tablist, so they are matched as tabs and the current one
 * asserted through aria-selected, while a chip's through aria-pressed. The window, the distances,
 * the order and the bands are not presentation choices either.
 */

const PHONE_VIEWPORT = { width: 360, height: 780 } as const;

/** This spec's own email prefix: it removes these accounts and their rows, and nothing else. */
const EMAIL_PREFIX = 'lookup-by-start';

const NO_MATCHES = 'No meals within that window.';

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
  readonly minute: number;
  readonly before: number;
  readonly after?: number;
  /** The dose. Every result must show it, so each meal's is distinct. */
  readonly units: number;
  readonly riceAmount: number;
};

/**
 * The stimulus fixes seven meals, their readings and their doses, and that each is on its own day
 * within the last two weeks. The clock times, the slots and the Rice amounts are the oracle's own
 * choice, as value 11's were: every meal is on a different date, so nothing here can flatter the
 * ordering under test, and a distinct amount per meal is what lets 'the result shows ITS foods' be
 * checked rather than 'some foods'. No amount equals any reading or dose, so a bare number in the
 * results region belongs to exactly one meal and one field of it.
 */
const seedMeals: readonly SeedMeal[] = [
  // 145: exactly the target. Change +35, rose.
  { daysAgo: 1, slot: 'dinner', hour: 19, minute: 10, before: 145, after: 180, units: 6, riceAmount: 210 },
  // 148: 3 off, and the NEWER of the two meals tied at 3 off.
  { daysAgo: 2, slot: 'lunch', hour: 12, minute: 55, before: 148, after: 172, units: 7, riceAmount: 215 },
  // 142: 3 off, and the older of the tie, so it must come second of the two.
  { daysAgo: 3, slot: 'dinner', hour: 19, minute: 30, before: 142, after: 175, units: 2, riceAmount: 225 },
  // 146: 1 off, and NO after reading -- matched and listed, with no change and no band.
  { daysAgo: 4, slot: 'breakfast', hour: 7, minute: 40, before: 146, units: 8, riceAmount: 230 },
  // 138: 7 off, inside ±10 and outside ±5.
  { daysAgo: 5, slot: 'lunch', hour: 12, minute: 20, before: 138, after: 165, units: 5, riceAmount: 235 },
  // 160: 15 off, inside ±20 and outside ±10.
  { daysAgo: 6, slot: 'dinner', hour: 18, minute: 45, before: 160, after: 190, units: 9, riceAmount: 245 },
  // 200: 55 off, outside every window.
  { daysAgo: 7, slot: 'lunch', hour: 13, minute: 15, before: 200, after: 240, units: 4, riceAmount: 255 },
];

const mealAt = (daysAgo: number): SeedMeal => {
  const found = seedMeals.find((meal) => meal.daysAgo === daysAgo);
  if (!found) throw new Error(`no seeded meal ${daysAgo} day(s) ago`);
  return found;
};

/**
 * Everything the 200 meal records. It is 55 off and inside no window, so none of it may reach any
 * result. Numbers are matched on word boundaries so the '±20' chip cannot satisfy '200'.
 */
const FAR_VALUES: readonly RegExp[] = [/\b200\b/, /\b240\b/, /\b4 u\b/, /Rice 255 g/];

// --- What each result must read ---------------------------------------------

type ResultExpectation = {
  readonly daysAgo: number;
  readonly slot: RegExp;
  /** Every fragment the result must contain. Minus signs are normalised before matching. */
  readonly reads: readonly string[];
  /** How far off it was, in words. */
  readonly distance: string;
  /**
   * The change band the one rule gives, or null when the meal has no after reading and therefore
   * no change at all: rose is +31 to +60 and stable is −39 to +30.
   */
  readonly band: string | null;
};

/** 145 → 180 is +35, which is rose. */
const exact: ResultExpectation = {
  daysAgo: 1,
  slot: /dinner/i,
  reads: ['6 u', 'Rice 210 g', '145', '180', '+35'],
  distance: 'exact',
  band: 'rose',
};

/** 146 with no after reading: its dose and its before reading, and nothing more. */
const oneOffNoAfter: ResultExpectation = {
  daysAgo: 4,
  slot: /breakfast/i,
  reads: ['8 u', 'Rice 230 g', '146'],
  distance: '1 off',
  band: null,
};

/** 148 → 172 is +24, which is stable. The newer of the two meals 3 off. */
const threeOffNewer: ResultExpectation = {
  daysAgo: 2,
  slot: /lunch/i,
  reads: ['7 u', 'Rice 215 g', '148', '172', '+24'],
  distance: '3 off',
  band: 'stable',
};

/** 142 → 175 is +33, which is rose. The older of the two meals 3 off. */
const threeOffOlder: ResultExpectation = {
  daysAgo: 3,
  slot: /dinner/i,
  reads: ['2 u', 'Rice 225 g', '142', '175', '+33'],
  distance: '3 off',
  band: 'rose',
};

/** 138 → 165 is +27, which is stable. */
const sevenOff: ResultExpectation = {
  daysAgo: 5,
  slot: /lunch/i,
  reads: ['5 u', 'Rice 235 g', '138', '165', '+27'],
  distance: '7 off',
  band: 'stable',
};

/** 160 → 190 is +30, which is stable: the brief puts stable at −39 to +30 inclusive. */
const fifteenOff: ResultExpectation = {
  daysAgo: 6,
  slot: /dinner/i,
  reads: ['9 u', 'Rice 245 g', '160', '190', '+30'],
  distance: '15 off',
  band: 'stable',
};

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
        // eaten_on, never eaten_at: a late row must not drift into the neighbouring day when the
        // server's offset is not the phone's.
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
    const foods = await admin.from('meal_foods').insert([
      {
        user_id: owner.id,
        meal_id: inserted.data.id,
        name: 'Rice',
        food_type: 'carb-heavy',
        amount: meal.riceAmount,
        unit: 'g',
        position: 1,
      },
    ]);
    if (foods.error) {
      throw new Error(`could not seed that meal's food: ${foods.error.message}`);
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

const results = (page: Page): Locator => page.getByRole('region', { name: /results/i });

/**
 * A lookup tab, by its own role. The strip is a tablist whose controls each carry role="tab", and
 * an explicit role REPLACES the implicit one, so a tab is never exposed as a button.
 */
const tab = (page: Page, name: RegExp): Locator => page.getByRole('tab', { name });

/** A window chip may be marked up as a radio or as a button: that is a presentation choice. */
const control = async (page: Page, name: RegExp): Promise<Locator> => {
  for (const role of ['radio', 'button', 'tab', 'link'] as const) {
    const found = page.getByRole(role, { name });
    if ((await found.count()) > 0) {
      return found.first();
    }
  }
  return page.getByRole('button', { name });
};

const chosen = async (control: Locator): Promise<string | null> =>
  (await control.getAttribute('aria-selected')) ??
  (await control.getAttribute('aria-checked')) ??
  (await control.getAttribute('aria-pressed'));

/**
 * This value's window bounds are ±5, ±10 and ±20. How a bound is written -- '±5', '+/-5', 'plus or
 * minus 5' -- is a presentation choice, so the name is matched tolerantly on the number it is a
 * window of, and anchored, so the ±20 chip cannot answer for the ±5 one.
 */
type WindowBound = 5 | 10 | 20;

const windowChip = (page: Page, bound: WindowBound): Promise<Locator> =>
  control(page, new RegExp(`^\\s*(±|\\+/-|\\+ ?/ ?-|plus or minus)?\\s*${bound}\\s*$`, 'i'));

const chooseWindow = async (page: Page, bound: WindowBound): Promise<void> => {
  await (await windowChip(page, bound)).click();
  expect(
    await chosen(await windowChip(page, bound)),
    `the chosen window is plus or minus ${bound}`,
  ).toBe('true');
};

/** The target field, by its real label, exactly, as every field on one screen is matched. */
const targetField = (page: Page): Locator => page.getByLabel('Starting reading', { exact: true });

const openByStart = async (browser: Browser, account: Account): Promise<Page> => {
  const page = await openPhone(browser);
  await signIn(page, account);
  await navigate(page, /^lookup$/i);

  // 'By start' stops being inert in this value: values 10 and 11 left it present and unselectable.
  const byStart = tab(page, /^by start$/i);
  await expect(byStart, 'the By start tab is on screen').toBeVisible();
  await byStart.click();
  await expect(byStart, 'the By start tab is selectable now').toHaveAttribute('aria-selected', 'true');
  await expect(targetField(page), 'By start carries the starting reading field').toBeVisible();
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

const enterTarget = async (page: Page, target: string): Promise<void> => {
  await targetField(page).fill(target);
};

/**
 * Asserts the whole result list: exactly these meals, in exactly this order, each reading its own
 * dose, foods, readings, signed and banded change where it has one, and its distance in words.
 */
const expectResults = async (
  page: Page,
  where: string,
  expected: readonly ResultExpectation[],
): Promise<void> => {
  const rows = await resultRows(page);
  await expect(
    rows,
    `${where}: exactly ${expected.length} meal(s) are within the window`,
  ).toHaveCount(expected.length);

  for (const [index, result] of expected.entries()) {
    const at = `${where}, position ${index} (${result.daysAgo} day(s) ago)`;
    const row = rows.nth(index);
    const raw = await textOf(row);
    const text = normaliseSigns(raw);

    // Nearest first, ties newer first: position index carries the meal whose place it must.
    expect(text, `${at} names its date`).toMatch(dayLabel(result.daysAgo));
    expect(text, `${at} names its slot`).toMatch(result.slot);
    for (const fragment of result.reads) {
      expect(text, `${at} reads ${fragment}`).toContain(fragment);
    }

    // How far off it was, in words.
    expect(text, `${at} says how far off it was: ${result.distance}`).toContain(result.distance);
    if (result.distance === 'exact') {
      // Zero distance is a different statement from a distance of zero units.
      expect(text, `${at} reads 'exact' and never '0 off'`).not.toMatch(/\b0\s*off\b/i);
    }
    // A distance is never signed: it would read as another change.
    expect(text, `${at} states its distance unsigned`).not.toMatch(/[+-]\s?\d+\s*off\b/i);

    const banded = row.locator('[data-change-band]');
    if (result.band === null) {
      // No after reading, so no change: where it started is what was asked, and an unmeasured
      // ending must not be drawn as one. A change is always written with an explicit sign, or as
      // '0' when there is none, so neither form may appear. The RAW text is matched here, so a
      // hyphen inside a written date cannot be mistaken for a sign.
      await expect(banded, `${at} carries no change band, having no change`).toHaveCount(0);
      expect(raw, `${at} shows no signed change`).not.toMatch(/[+−]\s?\d+/);
      expect(raw, `${at} does not draw a missing change as zero`).not.toMatch(/(^|\s)0(\s|$)/);
      // Its after reading does not exist, so no second reading may be shown for it.
      expect(raw, `${at} shows only the reading it has`).not.toMatch(/→|->/);
    } else {
      await expect(banded, `${at} publishes exactly one change band`).toHaveCount(1);
      await expect(banded, `${at} is banded by the one rule`).toHaveAttribute(
        'data-change-band',
        result.band,
      );
    }

    // A result is one control, because it opens that meal.
    expect(await controlCount(row), `${at} offers one way to open its meal`).toBeLessThanOrEqual(1);
  }

  // A window is a tolerance: what is outside it is absent, not ranked last.
  const listed = await textOf(results(page));
  const absent = seedMeals.filter(
    (meal) => !expected.some((result) => result.daysAgo === meal.daysAgo),
  );
  for (const meal of absent) {
    expect(
      listed,
      `${where}: the meal ${meal.daysAgo} day(s) ago is outside the window and absent`,
    ).not.toMatch(dayLabel(meal.daysAgo));
    expect(listed, `${where}: its Rice ${meal.riceAmount} g is not listed`).not.toContain(
      `Rice ${meal.riceAmount} g`,
    );
  }

  // Nothing on this screen proposes a dose: it reports doses already taken.
  expect(listed, `${where}: a nearest-match list proposes nothing`).not.toMatch(
    /recommend|suggest|advice|advise|you should/i,
  );
};

// --- The oracle -------------------------------------------------------------

test('a starting reading and a window list the meals that began nearest, nearest first', async ({
  browser,
}) => {
  const phone = await openByStart(browser, accounts.owner);

  // With no reading entered the screen invites one rather than listing everything the account owns.
  await expect(await resultRows(phone), 'no reading, nothing listed').toHaveCount(0);
  const beforeTyping = await textOf(phone.locator('body'));
  for (const reading of ['180', '172', '175', '165', '190', '240']) {
    expect(beforeTyping, `no reading entered does not list ${reading}`).not.toContain(reading);
  }

  // The window defaults to plus or minus 10, before any chip is touched. The three bounds are this
  // value's own, and the ±2 of value 11 is not among them.
  expect(
    await chosen(await windowChip(phone, 10)),
    'the window defaults to plus or minus 10',
  ).toBe('true');
  for (const bound of [5, 10, 20] as const) {
    await expect(
      await windowChip(phone, bound),
      `the plus or minus ${bound} chip is on screen`,
    ).toBeVisible();
  }

  await enterTarget(phone, '145');

  // ±5: distances 0, 1, 3 and 3. The 148 meal precedes the 142 meal because both are 3 off and it
  // is the newer. The 146 meal has no after reading and is listed all the same, with no change.
  // The window is chosen explicitly: this case asserts a row count, and the default is chosen for
  // no particular target.
  await chooseWindow(phone, 5);
  await expectResults(phone, 'at plus or minus 5', [
    exact,
    oneOffNoAfter,
    threeOffNewer,
    threeOffOlder,
  ]);
  for (const value of FAR_VALUES) {
    expect(
      await textOf(results(phone)),
      `the meal 55 off is absent at plus or minus 5 (${value.source})`,
    ).not.toMatch(value);
  }

  // ±10: the 138 meal joins them LAST, 7 off. 7 is inside 10; the 160 meal is 15 off and stays out.
  await chooseWindow(phone, 10);
  await expectResults(phone, 'at plus or minus 10', [
    exact,
    oneOffNoAfter,
    threeOffNewer,
    threeOffOlder,
    sevenOff,
  ]);

  // ±20: the 160 meal joins LAST, 15 off. The 200 meal is 55 off and outside even this window.
  await chooseWindow(phone, 20);
  await expectResults(phone, 'at plus or minus 20', [
    exact,
    oneOffNoAfter,
    threeOffNewer,
    threeOffOlder,
    sevenOff,
    fifteenOff,
  ]);
  for (const value of FAR_VALUES) {
    expect(
      await textOf(results(phone)),
      `the meal 55 off is absent at plus or minus 20 (${value.source})`,
    ).not.toMatch(value);
  }

  expect(await scrollsHorizontally(phone), 'the lookup fits 360 px').toBe(false);
});

test('a reading with nothing in the window says so and leaves the chips usable', async ({
  browser,
}) => {
  const phone = await openByStart(browser, accounts.owner);

  await enterTarget(phone, '900');
  await chooseWindow(phone, 20);

  await expect(
    results(phone).getByText(NO_MATCHES),
    'the results area names the window, not the reading',
  ).toBeVisible();
  await expect(await resultRows(phone), 'nothing is within that window').toHaveCount(0);
  await expect(results(phone).locator('[data-change-band]')).toHaveCount(0);

  // Widening is one tap away: the chips stay usable.
  for (const bound of [5, 10, 20] as const) {
    const chip = await windowChip(phone, bound);
    await expect(chip, `the plus or minus ${bound} chip is on screen`).toBeVisible();
    expect(
      (await chip.getAttribute('aria-disabled')) === 'true' || (await chip.isDisabled()),
      `the plus or minus ${bound} chip stays usable`,
    ).toBe(false);
  }

  expect(await scrollsHorizontally(phone)).toBe(false);
});

test('a result opens that meal', async ({ browser }) => {
  const phone = await openByStart(browser, accounts.owner);
  await enterTarget(phone, '145');
  await chooseWindow(phone, 5);
  await expect(await resultRows(phone)).toHaveCount(4);

  // The nearest match: the dinner one day ago, 145 to 180 at 6 units.
  await (await controlIn((await resultRows(phone)).first())).click();

  const detail = phone.getByRole('region', { name: /meal detail/i });
  await expect(detail, 'the result opened a meal detail').toBeVisible();
  const detailText = await textOf(detail);
  expect(detailText, 'the result opened the dinner it named').toMatch(/dinner/i);
  // Value 6's detail lists a food's name, type and amount as separate items, so the parts are
  // asserted as parts rather than as the result card's contiguous wording.
  const nearest = mealAt(1);
  for (const fragment of ['145', '180', '6 u', 'Rice', `${nearest.riceAmount} g`]) {
    expect(detailText, `the detail reads ${fragment}`).toContain(fragment);
  }

  expect(await scrollsHorizontally(phone)).toBe(false);
});

test("another account's lookup by start reaches none of the owner's meals", async ({ browser }) => {
  const phone = await openByStart(browser, accounts.stranger);

  // Row-level security is the only thing that scopes a read, and this account recorded nothing.
  await enterTarget(phone, '145');
  await chooseWindow(phone, 20);

  await expect(results(phone).getByText(NO_MATCHES), 'a stranger matches nothing').toBeVisible();
  await expect(await resultRows(phone)).toHaveCount(0);

  const bodyText = await textOf(phone.locator('body'));
  for (const owned of [148, 142, 146, 138, 160, 200, 180, 172, 175, 165, 190, 240] as const) {
    // Matched on word boundaries so a window chip reading '20' cannot answer for a reading.
    expect(bodyText, `the owner's ${owned} is not in this lookup`).not.toMatch(
      new RegExp(`\\b${owned}\\b`),
    );
  }

  expect(await scrollsHorizontally(phone)).toBe(false);
});
