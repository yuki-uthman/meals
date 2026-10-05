import { test, expect, type Browser, type Locator, type Page } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { startLocalStack, type LocalStack } from '../support/local-stack';
import { createAccounts, removeAccounts, type Account, type SeededAccounts } from '../support/accounts';

/**
 * Public oracle for value 4: recording night insulin.
 *
 * Observation: the person records night insulin (long-acting units, time, bedtime
 * glucose) and the screen lists the last five nights as dose and next-morning reading.
 *
 * Like every earlier value the oracle drives the built static bundle in a real browser
 * against the Supabase CLI local stack, so what the five-night list shows is what
 * Postgres holds and gave back through real row-level security.
 *
 * Two claims carry this value and the oracle is built around them:
 *
 *  - The next-morning reading is DERIVED, never recorded: it is the glucose before
 *    BREAKFAST on the following calendar date. So yesterday's date is seeded with two
 *    meals -- a breakfast reading 106 and a lunch reading 200 -- and the row for the
 *    night before yesterday must read 106. A rule that took the lunch, or any meal,
 *    would show 200 and fail here.
 *  - The morning reading is banded by LEVEL, not by change, and a night whose following
 *    date has no reading is INDETERMINATE: an em dash and no band at all, because a
 *    measurement that was never taken must not be drawn as a value.
 *
 * Widgets are located tolerantly by their accessible names, because a label's wording
 * and whether the list is a list or a table are presentation choices, while the fields
 * the brief fixes -- the dose, the time, the bedtime glucose -- are not.
 */

const PHONE_VIEWPORT = { width: 360, height: 780 } as const;

/** This spec's own email prefix: it removes these accounts and their rows, and nothing else. */
const EMAIL_PREFIX = 'night-insulin';

const NOT_LOGGED_YET = 'Not logged yet';
const NO_DOSE_REFUSAL = 'Enter the dose.';
/** U+2014. The brief's placeholder for a morning nobody measured. */
const EM_DASH = '—';

const DAY_MS = 24 * 60 * 60 * 1000;

let stack: LocalStack;
let accounts: SeededAccounts;

test.describe.configure({ mode: 'serial' });
test.use({ viewport: PHONE_VIEWPORT });

const startOfLocalDay = (daysAgo: number): Date => {
  const now = new Date();
  const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return new Date(midnight.getTime() - daysAgo * DAY_MS);
};

const localDateOnly = (day: Date): string =>
  [
    String(day.getFullYear()).padStart(4, '0'),
    String(day.getMonth() + 1).padStart(2, '0'),
    String(day.getDate()).padStart(2, '0'),
  ].join('-');

const localTime = (day: Date, hour: number, minute: number): string =>
  new Date(day.getFullYear(), day.getMonth(), day.getDate(), hour, minute, 0, 0).toISOString();

/**
 * The five nights the screen must list, newest first: strictly before today, which is
 * the date being recorded. Each morning is the glucose before breakfast on the
 * FOLLOWING date, so a night's expected morning is deliberately written beside the
 * night rather than beside the meal that supplies it.
 */
const nights = [
  // Yesterday's night: today has no meal at all, so no morning reading exists.
  { daysAgo: 1, units: 18, morning: null, band: null },
  { daysAgo: 2, units: 18, morning: '106', band: 'in-range' },
  { daysAgo: 3, units: 16, morning: '190', band: 'high' },
  { daysAgo: 4, units: 16, morning: '64', band: 'low' },
  // 260 is 'high', the SAME band as 190 two rows up. The level bands changed after the
  // user worked the History grid -- low under 70, in-range 70 to 140, elevated 141 to 180,
  // high 181 and above -- so the old 250 boundary and the 'very-high' band above it are
  // both gone. Two rows sharing a band is the point of this pair, not a duplication.
  { daysAgo: 5, units: 20, morning: '260', band: 'high' },
] as const;

/**
 * The meals that supply the mornings. Yesterday carries two, so the derivation is
 * judged on the breakfast and not merely on 'some meal that day'.
 */
const meals = [
  { daysAgo: 1, slot: 'breakfast', hour: 7, minute: 5, before: 106 },
  { daysAgo: 1, slot: 'lunch', hour: 12, minute: 40, before: 200 },
  { daysAgo: 2, slot: 'breakfast', hour: 7, minute: 20, before: 190 },
  { daysAgo: 3, slot: 'breakfast', hour: 6, minute: 50, before: 64 },
  { daysAgo: 4, slot: 'breakfast', hour: 8, minute: 15, before: 260 },
] as const;

const seedNightsAndMeals = async (owner: Account): Promise<void> => {
  const admin = createClient(stack.supabaseUrl, stack.serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const nightRows = nights.map((night) => {
    const day = startOfLocalDay(night.daysAgo);
    return {
      user_id: owner.id,
      // night_on, never taken_at, is what a day is selected on, so a 22:30 row cannot
      // drift into the neighbouring day when the server's offset is not the phone's.
      night_on: localDateOnly(day),
      units: night.units,
      taken_at: localTime(day, 22, 30),
      bedtime_glucose: 130,
    };
  });
  const seededNights = await admin.from('night_insulin').insert(nightRows);
  if (seededNights.error) {
    throw new Error(`could not seed the night records: ${seededNights.error.message}`);
  }

  for (const meal of meals) {
    const day = startOfLocalDay(meal.daysAgo);
    const inserted = await admin
      .from('meals')
      .insert({
        user_id: owner.id,
        slot: meal.slot,
        eaten_on: localDateOnly(day),
        eaten_at: localTime(day, meal.hour, meal.minute),
        glucose_before: meal.before,
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
};

test.beforeAll(async () => {
  test.setTimeout(10 * 60 * 1000);
  stack = await startLocalStack();
  accounts = await createAccounts(stack, EMAIL_PREFIX);
  // Today owns neither a night record nor a meal: recording tonight's dose is the
  // observation, and today having no meal is what makes yesterday's night the
  // indeterminate row.
  await seedNightsAndMeals(accounts.owner);
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

const card = async (page: Page, name: string): Promise<Locator> => {
  const matching = cards(page).filter({ hasText: name });
  await expect(matching, `exactly one ${name} card`).toHaveCount(1);
  return matching.first();
};

const textOf = async (locator: Locator): Promise<string> =>
  (await locator.innerText()).replace(/\s+/g, ' ').trim();

const scrollsHorizontally = (page: Page): Promise<boolean> =>
  page.evaluate(() => {
    const root = document.documentElement;
    return root.scrollWidth > root.clientWidth || document.body.scrollWidth > root.clientWidth;
  });

const save = (page: Page): Promise<void> => page.getByRole('button', { name: /^save$/i }).click();

/**
 * Opens the night screen from Today's night insulin card. The card is the way in; it may
 * be a control itself or carry one, and which of those it is is a presentation choice.
 */
const openNightScreen = async (page: Page): Promise<void> => {
  const night = await card(page, 'Night insulin');
  const inner = night.getByRole('button');
  if ((await inner.count()) > 0) {
    await inner.first().click();
  } else {
    await night.click();
  }
};

/**
 * The five-night rows. A list of rows may be marked up as a list or as a table, so both
 * are accepted; that there are exactly five of them is the claim, not which element
 * carries them.
 */
const nightRows = async (page: Page): Promise<Locator> => {
  const listItems = page.getByRole('listitem');
  if ((await listItems.count()) > 0) {
    return listItems;
  }
  return page.getByRole('row');
};

/**
 * The three fields, by the exact labels the design fixes. 'Taken at' rather than 'Time'
 * is not a preference: 'Time' is a substring of 'Bedtime glucose', so a loose match on it
 * resolves to the bedtime field instead and no implementation could satisfy it. Labels on
 * one screen must not contain one another, and the oracle names them exactly so a screen
 * that reintroduces the collision fails here rather than silently filling the wrong box.
 */
const doseField = (page: Page): Locator => page.getByLabel('Dose', { exact: true });
const takenAtField = (page: Page): Locator => page.getByLabel('Taken at', { exact: true });
const bedtimeGlucoseField = (page: Page): Locator =>
  page.getByLabel('Bedtime glucose', { exact: true });

test('the night dose is recorded and the last five nights read as dose and next-morning reading', async ({
  browser,
}) => {
  const phone = await openPhone(browser);
  await signIn(phone, accounts.owner);

  // Today has no night record, so the card is the empty one -- and it is the way in.
  expect(await textOf(await card(phone, 'Night insulin')), 'tonight starts unrecorded').toContain(
    NOT_LOGGED_YET,
  );

  await openNightScreen(phone);

  // --- The last five nights ------------------------------------------------

  const rows = await nightRows(phone);
  await expect(rows, 'exactly five nights are listed').toHaveCount(5);

  for (const [index, night] of nights.entries()) {
    const row = rows.nth(index);
    const rowText = await textOf(row);
    const day = startOfLocalDay(night.daysAgo);
    const where = `row ${index + 1} (${night.daysAgo} night(s) ago)`;

    // Newest first, and each dose attached to its own night: the short date is what
    // says which night this row is, so the date and the dose are read together.
    expect(rowText, `${where} names its own date`).toMatch(
      new RegExp(`(Mon|Tue|Wed|Thu|Fri|Sat|Sun)\\w*\\s*0?${day.getDate()}\\b`, 'i'),
    );
    expect(rowText, `${where} shows its own dose`).toContain(`${night.units} u`);

    const band = row.locator('[data-level-band]');

    if (night.morning === null) {
      // Indeterminate: nobody measured this morning. An em dash, and no band, because a
      // missing measurement must never be painted as a level.
      expect(rowText, `${where} shows an em dash for the morning`).toContain(EM_DASH);
      await expect(band, `${where} carries no level band`).toHaveCount(0);
      await expect(
        row.locator('[data-change-band]'),
        `${where} is not banded by change either`,
      ).toHaveCount(0);
    } else {
      expect(rowText, `${where} shows its next-morning reading`).toContain(night.morning);
      // The reading is banded by level, and by exactly one level.
      await expect(band, `${where} publishes one level band`).toHaveCount(1);
      await expect(band, `${where} is banded by the brief's level rule`).toHaveAttribute(
        'data-level-band',
        night.band,
      );
      expect(await textOf(band), `${where} bands the morning reading itself`).toContain(
        night.morning,
      );
      // A morning reading is a level, never a change: the question a basal dose answers
      // is whether you woke up in range.
      await expect(
        row.locator('[data-change-band]'),
        `${where} carries no change band`,
      ).toHaveCount(0);
    }
  }

  // Yesterday's lunch reads 200. The morning belongs to the BREAKFAST, so 200 must appear
  // nowhere in the list.
  const listedText = (await rows.allInnerTexts()).join(' | ').replace(/\s+/g, ' ');
  expect(listedText, 'the morning is the breakfast, not a later meal').not.toContain(
    '200',
  );

  expect(await scrollsHorizontally(phone)).toBe(false);

  // --- Recording tonight ---------------------------------------------------

  // Three distinct fields, each resolving to exactly one control. If two labels
  // collided, one of these would be ambiguous and fail rather than quietly overwrite
  // the other field's value.
  await expect(doseField(phone), "'Dose' names one field").toHaveCount(1);
  await expect(takenAtField(phone), "'Taken at' names one field").toHaveCount(1);
  await expect(bedtimeGlucoseField(phone), "'Bedtime glucose' names one field").toHaveCount(1);

  await doseField(phone).fill('18');
  await takenAtField(phone).fill('22:30');
  await bedtimeGlucoseField(phone).fill('128');
  await save(phone);

  // Back on Today for the same date, showing what the store holds.
  const nightCard = await card(phone, 'Night insulin');
  expect(await textOf(nightCard), "Today's night card shows the recorded dose").toContain(
    `18 u at 22:30`,
  );

  // The store agrees, not just the screen.
  await phone.reload();
  expect(await textOf(await card(phone, 'Night insulin'))).toContain('18 u at 22:30');

  // One night per date: the save wrote one record, so the dose line appears once rather
  // than twice. Counted on the text and not on the number of data-entry elements,
  // because how many elements a card divides its own data into is a presentation choice
  // while 'two nights on one date' is the rule being falsified.
  const reread = await textOf(await card(phone, 'Night insulin'));
  expect(
    reread.match(/18 u at 22:30/g)?.length ?? 0,
    'exactly one night is recorded for the date',
  ).toBe(1);

  expect(await scrollsHorizontally(phone)).toBe(false);

  // --- Saving with no dose is refused, and changes nothing -----------------

  await openNightScreen(phone);

  // Tonight is now one of the recorded nights, but it is not strictly before the date
  // being recorded, so the list is still the same five nights.
  await expect(await nightRows(phone), 'the list stays the five nights before today').toHaveCount(5);

  await doseField(phone).fill('');
  await save(phone);

  await expect(phone.getByText(NO_DOSE_REFUSAL)).toBeVisible();
  // Refused in place: the screen stays, with its fields, so nothing entered is thrown away.
  await expect(doseField(phone)).toBeVisible();

  await phone.getByRole('button', { name: /^cancel$/i }).click();

  // And the stored night is untouched by the refusal.
  expect(await textOf(await card(phone, 'Night insulin'))).toContain('18 u at 22:30');
  await phone.reload();
  expect(await textOf(await card(phone, 'Night insulin'))).toContain('18 u at 22:30');

  expect(await scrollsHorizontally(phone)).toBe(false);
});

test('something small eaten with the night dose is recorded with the night, and can be removed again', async ({
  browser,
}) => {
  const phone = await openPhone(browser);
  await signIn(phone, accounts.owner);

  // Tonight was recorded by the test above; opening it again is how a snack eaten
  // because the bedtime reading was on the low side is added to it.
  await openNightScreen(phone);
  await expect(doseField(phone)).toHaveValue('18');

  await bedtimeGlucoseField(phone).fill('92');

  // The same Add food screen a meal uses: a first-time food is created, typed and
  // measured, and handed back to the night rather than to any meal.
  await phone.getByRole('button', { name: /add food/i }).click();
  await phone.getByLabel('Food name', { exact: true }).fill('Crackers');
  await phone.getByRole('button', { name: 'Create "Crackers"', exact: true }).click();
  await phone.getByRole('radio', { name: /^carb-heavy$/i }).check();
  await phone.getByLabel('Amount', { exact: true }).fill('2');
  await phone.getByRole('radio', { name: /^pc$/i }).check();
  await save(phone);

  // Back on the night with what was typed there still in place, and the food listed.
  await expect(bedtimeGlucoseField(phone)).toHaveValue('92');
  await expect(doseField(phone)).toHaveValue('18');
  await expect(phone.getByText(/Crackers/).first()).toBeVisible();

  expect(await scrollsHorizontally(phone)).toBe(false);

  await save(phone);

  // Today's night card shows the dose and the food eaten with it.
  const nightText = await textOf(await card(phone, 'Night insulin'));
  expect(nightText).toContain('18 u at 22:30');
  expect(nightText, 'the night card names the snack').toContain('Crackers 2 pc');

  // The store agrees, and the snack belongs to the night, not to a meal: no snack card.
  await phone.reload();
  expect(await textOf(await card(phone, 'Night insulin'))).toContain('Crackers 2 pc');
  await expect(cards(phone).filter({ hasText: /^\s*Snack/ })).toHaveCount(0);

  // Reopening the night shows the food, and removing it records a night with none.
  await openNightScreen(phone);
  await phone.getByRole('button', { name: 'Remove Crackers', exact: true }).click();
  await save(phone);

  const after = await textOf(await card(phone, 'Night insulin'));
  expect(after).toContain('18 u at 22:30');
  expect(after, 'the removed snack is gone from the night').not.toContain('Crackers');
  await phone.reload();
  expect(await textOf(await card(phone, 'Night insulin'))).not.toContain('Crackers');
});
