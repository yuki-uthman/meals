import { test, expect, type Browser, type Locator, type Page } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { startLocalStack, type LocalStack } from '../support/local-stack';
import { createAccounts, removeAccounts, type Account, type SeededAccounts } from '../support/accounts';

/**
 * Public oracle for value 11: lookup by change.
 *
 * Observation: entering a target change and a window (±2, ±5, ±10) lists past meals whose
 * change was nearest, nearest first, each showing dose, before → after and how far off it was.
 *
 * As in every earlier value the oracle drives the built static bundle in a real browser against
 * the Supabase CLI local stack, so the window, the distances and the order are computed over
 * what Postgres held and gave back through real row-level security.
 *
 * The claims this oracle is built around:
 *
 *  - A WINDOW IS A TOLERANCE, not a ranking. With a target of +20 the six seeded meals sit at
 *    distances 0 (+20), 2 (+22), 3 (+17), 8 (+28) and 50 (−30), plus one meal with no after
 *    reading and therefore no change at all. So:
 *      ±5  lists the 0, 2 and 3 meals and NOTHING else, however close +28 is to the edge;
 *      ±2  lists only the 0 and 2 meals;
 *      ±10 admits the +28 meal last, 8 off -- the bound is checked against the fixture, and a
 *          meal at +32 would be 12 off and outside it, which is why none is claimed inside.
 *    The −30 meal is 50 off and is absent from every window.
 *  - A meal with no after reading has NO change, so it is absent from every window rather than
 *    listed with an empty distance.
 *  - The order is by distance, nearest first, ties broken by date, newer first. The fixture has
 *    no tie at +20, so the tie-break is falsified separately at a target of +21, where the +20
 *    meal and the +22 meal are both 1 off and the newer of the two must come first.
 *  - A distance reads in WORDS: 'exact' for a change equal to the target, otherwise '3 off'.
 *    Zero distance is a different statement from a distance of zero units, so '0 off' fails,
 *    and a signed distance fails, because it would read as another change.
 *  - A result is the same card a food lookup result uses: date and slot, dose, foods with
 *    amounts, and the two readings with the banded change. It opens that meal's detail.
 *  - A target with nothing in the window says 'No meals within that window.' -- naming the
 *    window, not the target -- and leaves the chips usable, so widening is one tap away.
 *
 * Bands are asserted by NAME and never by colour. Widgets are located tolerantly: whether a
 * chip is a radio, a tab or a button, and how a date is worded, are presentation choices. The
 * window, the distances, the order and the bands are not.
 */

const PHONE_VIEWPORT = { width: 360, height: 780 } as const;

/** This spec's own email prefix: it removes these accounts and their rows, and nothing else. */
const EMAIL_PREFIX = 'lookup-by-change';

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
 * The stimulus fixes six meals, their readings, and that each carries a food named Rice on its
 * own day within the last two weeks. The doses, the clock times, the slots and the Rice amounts
 * are the oracle's own choice, as value 10's clock times were: every meal is on a different
 * date, so nothing here can flatter the ordering under test, and a distinct dose and amount per
 * meal is what lets 'the result shows ITS dose' be checked rather than 'a dose'.
 */
const seedMeals: readonly SeedMeal[] = [
  // +20: exactly the target.
  { daysAgo: 2, slot: 'dinner', hour: 19, minute: 10, before: 120, after: 140, units: 6, riceAmount: 250 },
  // +22: 2 off.
  { daysAgo: 3, slot: 'lunch', hour: 12, minute: 55, before: 130, after: 152, units: 7, riceAmount: 220 },
  // +17: 3 off.
  { daysAgo: 4, slot: 'dinner', hour: 19, minute: 30, before: 100, after: 117, units: 5, riceAmount: 300 },
  // +28: 8 off, inside ±10 and outside ±5.
  { daysAgo: 5, slot: 'lunch', hour: 12, minute: 20, before: 140, after: 168, units: 8, riceAmount: 180 },
  // −30: 50 off, outside every window.
  { daysAgo: 6, slot: 'dinner', hour: 18, minute: 45, before: 150, after: 120, units: 9, riceAmount: 200 },
  // No after reading: no change, so absent from every window.
  { daysAgo: 7, slot: 'breakfast', hour: 7, minute: 40, before: 110, units: 4, riceAmount: 150 },
];

const mealAt = (daysAgo: number): SeedMeal => {
  const found = seedMeals.find((meal) => meal.daysAgo === daysAgo);
  if (!found) throw new Error(`no seeded meal ${daysAgo} day(s) ago`);
  return found;
};

/**
 * Everything the meal with no after reading records. None of it may reach any result, in any
 * window: a meal with no change is not nearest to anything.
 */
const NO_AFTER_VALUES = ['110', '4 u', 'Rice 150 g'] as const;

/** Everything the −30 meal records, which is 50 off and never within a window either. */
const FAR_VALUES = ['150', '120', '9 u', 'Rice 200 g'] as const;

// --- What each result must read ---------------------------------------------

type ResultExpectation = {
  readonly daysAgo: number;
  readonly slot: RegExp;
  /** Every fragment the result must contain. Minus signs are normalised before matching. */
  readonly reads: readonly string[];
  /** How far off it was, in words. */
  readonly distance: string;
  /** The change band the one rule gives. −39 to +30 is stable, and every change here is in it. */
  readonly band: string;
};

/** At a target of +20: distances 0, 2 and 3. All five changes fall in the stable band. */
const exact: ResultExpectation = {
  daysAgo: 2,
  slot: /dinner/i,
  reads: ['6 u', 'Rice 250 g', '120', '140', '+20'],
  distance: 'exact',
  band: 'stable',
};

const twoOff: ResultExpectation = {
  daysAgo: 3,
  slot: /lunch/i,
  reads: ['7 u', 'Rice 220 g', '130', '152', '+22'],
  distance: '2 off',
  band: 'stable',
};

const threeOff: ResultExpectation = {
  daysAgo: 4,
  slot: /dinner/i,
  reads: ['5 u', 'Rice 300 g', '100', '117', '+17'],
  distance: '3 off',
  band: 'stable',
};

const eightOff: ResultExpectation = {
  daysAgo: 5,
  slot: /lunch/i,
  reads: ['8 u', 'Rice 180 g', '140', '168', '+28'],
  distance: '8 off',
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
        // eaten_on, never eaten_at: a late row must not drift into the neighbouring day when
        // the server's offset is not the phone's.
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

/** A tab may be marked up as a tab or as a button. */
const control = async (page: Page, name: RegExp): Promise<Locator> => {
  for (const role of ['tab', 'radio', 'button', 'link'] as const) {
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
 * The window chips are named for their bound. How that bound is written -- '±5', '+/-5',
 * 'plus or minus 5' -- is a presentation choice, so the name is matched tolerantly on the
 * number it is a window of.
 */
const windowChip = (page: Page, bound: 2 | 5 | 10): Promise<Locator> =>
  control(page, new RegExp(`^\\s*(±|\\+/-|\\+ ?/ ?-|plus or minus)?\\s*${bound}\\s*$`, 'i'));

/** The target field, by its real label, exactly, as every field on one screen is matched. */
const targetField = (page: Page): Locator => page.getByLabel('Change wanted', { exact: true });

const openByChange = async (browser: Browser, account: Account): Promise<Page> => {
  const page = await openPhone(browser);
  await signIn(page, account);
  await navigate(page, /^lookup$/i);

  // 'By change' stops being inert in this value: value 10 left it present and unselectable.
  const byChange = await control(page, /^by change$/i);
  await expect(byChange, 'the By change tab is on screen').toBeVisible();
  await byChange.click();
  expect(await chosen(byChange), 'the By change tab is selectable now').toBe('true');
  await expect(targetField(page), 'By change carries the target field').toBeVisible();
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
 * Asserts the whole result list: exactly these meals, in exactly this order, each reading its
 * own dose, foods, readings, signed change, banded change and distance in words.
 */
const expectResults = async (
  page: Page,
  where: string,
  expected: readonly ResultExpectation[],
): Promise<void> => {
  const rows = await resultRows(page);
  await expect(rows, `${where}: exactly ${expected.length} meal(s) are within the window`).toHaveCount(
    expected.length,
  );

  for (const [index, result] of expected.entries()) {
    const at = `${where}, position ${index} (${result.daysAgo} day(s) ago)`;
    const row = rows.nth(index);
    const text = normaliseSigns(await textOf(row));

    // Nearest first: position index carries the meal whose distance it must.
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
    // A distance is never signed: a signed distance would read as another change. The signed
    // change itself is asserted above, so only a SECOND signed number beside 'off' is barred.
    expect(text, `${at} states its distance unsigned`).not.toMatch(/[+-]\s?\d+\s*off\b/i);

    const banded = row.locator('[data-change-band]');
    await expect(banded, `${at} publishes exactly one change band`).toHaveCount(1);
    await expect(banded, `${at} is banded by the one rule`).toHaveAttribute(
      'data-change-band',
      result.band,
    );

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

  // The meal with no after reading has no change, so nothing of it is ever listed.
  for (const value of NO_AFTER_VALUES) {
    expect(listed, `${where}: a meal with no after reading is absent (${value})`).not.toContain(value);
  }

  // Nothing on this screen proposes a dose: it reports doses already taken.
  expect(listed, `${where}: a nearest-match list proposes nothing`).not.toMatch(
    /recommend|suggest|advice|advise|you should/i,
  );
};

// --- The oracle -------------------------------------------------------------

test('a target and a window list the nearest meals, nearest first, with how far off each was', async ({
  browser,
}) => {
  const phone = await openByChange(browser, accounts.owner);

  // With no target the screen invites one rather than listing everything the account owns.
  await expect(await resultRows(phone), 'no target, nothing listed').toHaveCount(0);
  const beforeTyping = normaliseSigns(await textOf(phone.locator('body')));
  for (const reading of ['140', '152', '117', '168']) {
    expect(beforeTyping, `no target does not list ${reading}`).not.toContain(reading);
  }

  // The default window is plus or minus 5, before any chip is touched.
  expect(
    await chosen(await windowChip(phone, 5)),
    'the window defaults to plus or minus 5',
  ).toBe('true');

  await enterTarget(phone, '+20');

  // ±5: distances 0, 2 and 3. The +28 meal is 8 off and the −30 meal 50 off: both absent,
  // however close +28 is to the edge, because the person chose how much slack they would accept.
  await expectResults(phone, 'at plus or minus 5', [exact, twoOff, threeOff]);
  for (const value of FAR_VALUES) {
    expect(
      await textOf(results(phone)),
      `the meal 50 off is absent at plus or minus 5 (${value})`,
    ).not.toContain(value);
  }

  // ±2: only the exact meal and the one 2 off, in that order.
  await (await windowChip(phone, 2)).click();
  expect(await chosen(await windowChip(phone, 2)), 'the chosen window is plus or minus 2').toBe('true');
  await expectResults(phone, 'at plus or minus 2', [exact, twoOff]);

  // ±10: the +28 meal joins them LAST, 8 off. The bound is checked against the fixture: 8 is
  // inside 10, and a meal at +32 would be 12 off and outside it.
  await (await windowChip(phone, 10)).click();
  expect(await chosen(await windowChip(phone, 10)), 'the chosen window is plus or minus 10').toBe(
    'true',
  );
  await expectResults(phone, 'at plus or minus 10', [exact, twoOff, threeOff, eightOff]);

  expect(await scrollsHorizontally(phone), 'the lookup fits 360 px').toBe(false);
});

test('equal distances are broken by date, newer first', async ({ browser }) => {
  const phone = await openByChange(browser, accounts.owner);

  // The seeded +20 and +22 meals are each 1 off a target of +21, so the order is decided by
  // the tie-break alone: the +20 meal is 2 days ago and the +22 meal 3 days ago, so the newer
  // one comes first. Without the tie-break the order here would be arbitrary.
  await enterTarget(phone, '+21');

  await expectResults(phone, 'at a target of +21', [
    { ...exact, distance: '1 off' },
    { ...twoOff, distance: '1 off' },
  ]);

  expect(await scrollsHorizontally(phone)).toBe(false);
});

test('a target with nothing in the window says so and leaves the chips usable', async ({ browser }) => {
  const phone = await openByChange(browser, accounts.owner);

  await enterTarget(phone, '-400');

  await expect(
    results(phone).getByText(NO_MATCHES),
    'the results area names the window, not the target',
  ).toBeVisible();
  await expect(await resultRows(phone), 'nothing is within that window').toHaveCount(0);
  await expect(results(phone).locator('[data-change-band]')).toHaveCount(0);

  // Widening is one tap away: the chips stay usable.
  for (const bound of [2, 5, 10] as const) {
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
  const phone = await openByChange(browser, accounts.owner);
  await enterTarget(phone, '+20');
  await expect(await resultRows(phone)).toHaveCount(3);

  // The nearest match: the dinner two days ago, 120 to 140 at 6 units.
  await (await controlIn((await resultRows(phone)).first())).click();

  const detail = phone.getByRole('region', { name: /meal detail/i });
  await expect(detail, 'the result opened a meal detail').toBeVisible();
  const detailText = await textOf(detail);
  expect(detailText, 'the result opened the dinner it named').toMatch(/dinner/i);
  // Value 6's detail lists a food's name, type and amount as separate items, so the parts are
  // asserted as parts rather than as the result card's contiguous wording.
  const nearest = mealAt(2);
  for (const fragment of ['120', '140', '6 u', 'Rice', `${nearest.riceAmount} g`]) {
    expect(detailText, `the detail reads ${fragment}`).toContain(fragment);
  }

  expect(await scrollsHorizontally(phone)).toBe(false);
});

test("another account's lookup by change reaches none of the owner's meals", async ({ browser }) => {
  const phone = await openByChange(browser, accounts.stranger);

  // Row-level security is the only thing that scopes a read, and this account recorded nothing.
  await enterTarget(phone, '+20');

  await expect(results(phone).getByText(NO_MATCHES), 'a stranger matches nothing').toBeVisible();
  await expect(await resultRows(phone)).toHaveCount(0);

  const bodyText = await textOf(phone.locator('body'));
  for (const owned of ['120', '140', '130', '152', '100', '117', '168']) {
    expect(bodyText, `the owner's ${owned} is not in this lookup`).not.toContain(owned);
  }
});
