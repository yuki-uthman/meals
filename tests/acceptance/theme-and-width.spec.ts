import { test, expect, type Browser, type Locator, type Page } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { startLocalStack, type LocalStack } from '../support/local-stack';
import { createAccounts, removeAccounts, type Account, type SeededAccounts } from '../support/accounts';

/**
 * Public oracle for value 13: the two palettes and the phone width.
 *
 * Observation: the site follows the device's light or dark setting using the two palettes from the
 * canvas, and every screen fills the width of a large Android phone, with no horizontal scrolling
 * at any viewport width from 360 px upward.
 *
 * As in every earlier value the oracle drives the built static bundle in a real browser against the
 * Supabase CLI local stack, so every screen it measures is a screen drawn from what Postgres held.
 *
 * The claims this oracle is built around:
 *
 *  - The palette is the CANVAS's, not the placeholder. The page's ground is #F6F3EC in light and
 *    #141311 in dark; its ink is #1C1A17 and #F3EFE7; a card is #FFFFFF and #1F1D1A. The palette
 *    currently in theme.css is cool grey with a green accent and satisfies none of these, which is
 *    what makes this oracle red before the value is built.
 *  - A FILLED button keeps the deep teal #1F6F63 in BOTH schemes, as the canvas note says, so a
 *    white label stays readable on it. The lifted teal #6FCBBA is for links, icons and text accents
 *    in the dark and never behind white text. This is asserted because it is the one palette rule
 *    that a single accent token CANNOT satisfy: today `.button` takes its fill and `.button--quiet`
 *    its text colour from the same token, so a dark scheme that lifts that one token to #6FCBBA
 *    would put white text on a pale teal fill. The rule is checked where it is visible, on a filled
 *    button's computed background, rather than on a token name.
 *  - The scheme follows prefers-color-scheme and nothing else. Both schemes are driven through the
 *    browser's own setting; no in-app toggle is looked for, because the design declines to build one
 *    and a toggle would be a second source of truth for the same question.
 *  - A band colour is IDENTICAL in both schemes, deliberately, so the two themes read the same. The
 *    band is found by its published name -- data-change-band -- and its computed colour compared
 *    across the two schemes. The colour is never compared to a hex constant here: value 2 chose to
 *    publish band NAMES precisely so a repaint could not break an oracle, and this value only has to
 *    show that the repaint left the bands alone.
 *  - A heading's computed font family names Fraunces AHEAD of its serif fallback, and body text names
 *    IBM Plex Sans ahead of its sans fallback, in both schemes. The fallback must be present as well
 *    as the webfont: the design promises the app is fully usable before the fonts arrive or if they
 *    never do, so a family list naming only Fraunces would fail.
 *  - Every listed screen, at 360, 412 and 480 px and in both schemes, must not scroll horizontally
 *    AND must have no element reaching past the viewport. Both are checked, and the second is the one
 *    that carries the weight: theme.css sets `overflow-x: hidden` on html and body, which CLIPS
 *    overflow, so a genuinely too-wide element can leave the document's scroll width equal to its
 *    client width while the content is silently cut off. A scroll-width check alone would pass on a
 *    broken layout, so the per-element check is what makes 'no horizontal scrolling' falsifiable.
 *  - The content FILLS the phone: it spans the viewport less a 16 px gutter on each side, so a 412 px
 *    or 480 px Android shows more content rather than a letterboxed column. This is measured as a
 *    content-box width of viewport − 32 at each of the three widths, all three of which are below the
 *    640 px centring cap. The 390 px of the canvas artboards is a drawing frame and is not a target,
 *    so it is not among the widths.
 *
 * Two clauses of the design's falsifier are NOT fully encoded here, and are recorded rather than
 * quietly dropped:
 *
 *  - 'A palette value is not the canvas's' is checked for the six palette roles that have a declared
 *    rendering site -- ground, ink, card and the filled accent -- and NOT for wash, dashed edge,
 *    accent hover, accent wash, rise and steady. The design names those six colours but does not say
 *    which element or which token carries any of them, so asserting them would mean inventing both a
 *    name and a place for them to appear.
 *  - rise and steady are additionally left alone because the design is in two minds about them: they
 *    are listed with DIFFERENT values in the light and dark palettes, while the band rule states that
 *    the eight band colours are identical in both schemes and that the existing band tokens already
 *    carry the canvas's values. Light 'rise' #A6540A is also not the existing rose band #B45309. An
 *    oracle cannot choose between those readings, so it asserts the band rule that IS unambiguous --
 *    that a band's colour does not change between the schemes -- and asserts no hex for rise.
 *
 * Widgets are located tolerantly, as in every earlier oracle: whether a History view or a Lookup tab
 * is a tab, a button or a radio is a presentation choice. The colours, the fonts, the widths and the
 * absence of horizontal overflow are not presentation choices.
 */

/** The widths the app is judged at. 360 px is the narrowest; nothing below it is claimed. */
const WIDTHS = [360, 412, 480] as const;
const VIEWPORT_HEIGHT = 780;

/** The side gutter the design fixes. All three widths are below the 640 px centring cap. */
const GUTTER = 16;

/** Sub-pixel layout rounding, and nothing more, is tolerated in a width comparison. */
const TOLERANCE = 1;

const SCHEMES = ['light', 'dark'] as const;
type Scheme = (typeof SCHEMES)[number];

/** The canvas's palette, at the roles that have a declared rendering site. */
const PALETTE = {
  light: {
    ground: 'rgb(246, 243, 236)', // #F6F3EC
    ink: 'rgb(28, 26, 23)', //       #1C1A17
    card: 'rgb(255, 255, 255)', //   #FFFFFF
  },
  dark: {
    ground: 'rgb(20, 19, 17)', //    #141311
    ink: 'rgb(243, 239, 231)', //    #F3EFE7
    card: 'rgb(31, 29, 26)', //      #1F1D1A
  },
} as const;

/** The deep teal a filled button keeps in BOTH schemes: #1F6F63. */
const FILLED_ACCENT = 'rgb(31, 111, 99)';

/** This spec's own email prefix: it removes these accounts and their rows, and nothing else. */
const EMAIL_PREFIX = 'theme-and-width';

let stack: LocalStack;
let accounts: SeededAccounts;

test.describe.configure({ mode: 'serial' });

// --- Dates ------------------------------------------------------------------

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
  readonly units: number;
  /** The amount of the shared food, distinct per meal so no two meals read alike. */
  readonly riceAmount: number;
};

/**
 * The stimulus fixes 'enough to populate every screen: two meals and a night record today, and a
 * handful of earlier meals sharing a food'. The slots, clock times, readings, doses and amounts are
 * this oracle's own choice, as value 12's were: nothing here is asserted as a value, because this
 * value is judged on colour and width rather than on any number. What the fixture must guarantee is
 * that every screen has something on it -- a Today with two meal cards and one empty slot, a card
 * whose change carries a band, a meal detail with instances, a History grid with populated cells,
 * and a Lookup with results to draw -- so that a width is measured against a full screen rather than
 * an empty one. Dinner is deliberately left unlogged TODAY so the 'Not logged yet' card is there to
 * open the meal form from.
 *
 * Every meal shares the food 'Rice', which is what makes the earlier meals instances of one another.
 */
const SEED_MEALS: readonly SeedMeal[] = [
  { daysAgo: 0, slot: 'breakfast', hour: 7, minute: 40, before: 104, after: 186, units: 5, riceAmount: 210 },
  { daysAgo: 0, slot: 'lunch', hour: 12, minute: 55, before: 112, after: 133, units: 6, riceAmount: 215 },
  { daysAgo: 1, slot: 'dinner', hour: 19, minute: 10, before: 150, after: 110, units: 4, riceAmount: 220 },
  { daysAgo: 2, slot: 'lunch', hour: 12, minute: 20, before: 138, after: 165, units: 7, riceAmount: 225 },
  { daysAgo: 3, slot: 'dinner', hour: 19, minute: 30, before: 142, after: 175, units: 2, riceAmount: 230 },
  { daysAgo: 4, slot: 'breakfast', hour: 7, minute: 20, before: 260, after: 200, units: 8, riceAmount: 235 },
  { daysAgo: 5, slot: 'lunch', hour: 13, minute: 15, before: 64, after: 120, units: 9, riceAmount: 240 },
];

/** A night record today, so Today's night card is populated, and earlier ones for the grid. */
const SEED_NIGHTS = [
  { daysAgo: 0, units: 18, hour: 22, minute: 30, bedtime: 132 },
  { daysAgo: 1, units: 16, hour: 22, minute: 15, bedtime: 145 },
  { daysAgo: 2, units: 16, hour: 23, minute: 5, bedtime: 128 },
] as const;

const seed = async (owner: Account): Promise<void> => {
  const admin: SupabaseClient = createClient(stack.supabaseUrl, stack.serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  for (const meal of SEED_MEALS) {
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

  for (const night of SEED_NIGHTS) {
    const day = startOfLocalDay(night.daysAgo);
    const inserted = await admin.from('night_insulin').insert({
      user_id: owner.id,
      night_on: localDateOnly(day),
      units: night.units,
      taken_at: localTime(day, night.hour, night.minute),
      bedtime_glucose: night.bedtime,
    });
    if (inserted.error) {
      throw new Error(
        `could not seed the night ${night.daysAgo} day(s) ago: ${inserted.error.message}`,
      );
    }
  }
};

test.beforeAll(async () => {
  test.setTimeout(15 * 60 * 1000);
  stack = await startLocalStack();
  accounts = await createAccounts(stack, EMAIL_PREFIX);
  await seed(accounts.owner);
});

test.afterAll(async () => {
  if (stack) await removeAccounts(stack, EMAIL_PREFIX);
});

// --- Driving the bundle -----------------------------------------------------

/**
 * A phone at one width with one device colour scheme. The scheme is set on the browser context, so
 * the page answers prefers-color-scheme exactly as a phone would: nothing in the app is asked to
 * choose a theme, because the design gives it no way to.
 */
const openPhone = async (browser: Browser, width: number, colorScheme: Scheme): Promise<Page> => {
  const context = await browser.newContext({
    viewport: { width, height: VIEWPORT_HEIGHT },
    colorScheme,
  });
  const page = await context.newPage();
  await page.goto(stack.siteUrl);
  await expect(page.getByLabel(/email/i), 'the sign-in screen is drawn').toBeVisible();
  return page;
};

const signIn = async (page: Page, account: Account): Promise<void> => {
  await page.getByLabel(/email/i).fill(account.email);
  await page.getByLabel(/password/i).fill(account.password);
  await page.getByRole('button', { name: /sign in/i }).click();
  await expect(page.getByRole('heading', { name: /^today$/i }), 'Today is drawn').toBeVisible();
};

/**
 * Today's day log has arrived and holds at least one card.
 *
 * Opening a screen is asynchronous: the heading is drawn from the bundle, while the cards are drawn
 * from what Postgres held. A bare count() or a whole-document snapshot taken straight after a
 * navigation therefore races the fetch, and count() does not retry. This is an auto-retrying
 * expect(locator), so it waits rather than sampling, and it is awaited anywhere this spec counts
 * elements or measures a screen after arriving on Today.
 */
const dayLogSettled = async (page: Page): Promise<void> => {
  await expect(
    page.getByRole('listitem').first(),
    "Today's day log has arrived and holds a card",
  ).toBeVisible();
};

/** A control by name, whatever role it is given: that is a presentation choice. */
const control = async (page: Locator | Page, name: RegExp): Promise<Locator> => {
  for (const role of ['button', 'link', 'tab', 'radio'] as const) {
    const found = page.getByRole(role, { name });
    if ((await found.count()) > 0) {
      return found.first();
    }
  }
  return page.getByRole('button', { name });
};

const navigation = (page: Page): Locator => page.getByRole('navigation');

/** A navigation entry may be a link or a button: that is a presentation choice. */
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
 * Back to Today from wherever we are. A form screen carries Cancel, which is the way out that does
 * not write anything; every other screen is reachable through the bottom navigation.
 */
const returnToToday = async (page: Page): Promise<void> => {
  for (let step = 0; step < 3; step += 1) {
    const cancel = page.getByRole('button', { name: /^cancel$/i });
    if ((await cancel.count()) > 0 && (await cancel.first().isVisible())) {
      await cancel.first().click();
      continue;
    }
    break;
  }
  const today = page.getByRole('heading', { name: /^today$/i });
  if (!(await today.isVisible().catch(() => false))) {
    await navigate(page, /^today$/i);
  }
  await expect(today, 'back on Today').toBeVisible();
  // The heading is drawn before the log is fetched, and every caller either measures this screen or
  // reaches the next one through one of its cards, so wait for the log rather than racing it.
  await dayLogSettled(page);
};

// --- The screens the stimulus lists -----------------------------------------

/**
 * Each screen is reached from Today, which is where returnToToday leaves the page. The sign-in
 * screen is the one exception and is measured before signing in.
 */
type Screen = {
  readonly name: string;
  readonly reach: (page: Page) => Promise<void>;
};

const openMealForm = async (page: Page): Promise<void> => {
  // Dinner is the slot the fixture leaves unlogged today, so its 'Not logged yet' card is the way in.
  await (await control(page, /dinner/i)).click();
  await expect(
    page.getByLabel('Glucose before', { exact: true }),
    'the meal form is drawn',
  ).toBeVisible();
};

const SCREENS: readonly Screen[] = [
  {
    name: 'Today',
    reach: async () => {
      // returnToToday has already left the page here.
    },
  },
  {
    name: 'the meal form with a glucose field focused',
    reach: async (page) => {
      await openMealForm(page);
      // The two readings share one row, so this is the screen most likely to be pushed
      // sideways at 360 px.
      await page.getByLabel('Glucose before', { exact: true }).click();
      await expect(page.getByLabel('Glucose before', { exact: true })).toBeFocused();
    },
  },
  {
    name: 'the Add food screen',
    reach: async (page) => {
      await openMealForm(page);
      await (await control(page, /add food/i)).click();
      await expect(
        page.getByLabel('Food name', { exact: true }),
        'the Add food screen is drawn',
      ).toBeVisible();
    },
  },
  {
    name: 'the night screen',
    reach: async (page) => {
      await (await control(page, /night insulin/i)).click();
      await expect(page.getByLabel('Dose', { exact: true }), 'the night screen is drawn').toBeVisible();
    },
  },
  {
    name: 'a meal detail',
    reach: async (page) => {
      const breakfast = page
        .getByRole('listitem')
        .filter({ hasText: /breakfast/i })
        .first();
      // The card BODY opens the detail; the Edit control beside it goes to the form.
      await breakfast.getByRole('link').first().click();
      await expect(
        page.getByRole('region', { name: /meal detail/i }),
        'the meal detail is drawn',
      ).toBeVisible();
    },
  },
  ...(['Before', 'Change', 'Both'] as const).map((view) => ({
    name: `History in its ${view} view`,
    reach: async (page: Page): Promise<void> => {
      await navigate(page, /^history$/i);
      await (await control(page, new RegExp(`^\\s*${view}\\s*$`, 'i'))).click();
      await expect(page.getByRole('table'), 'the History grid is drawn').toBeVisible();
    },
  })),
  ...(['By food', 'By change', 'By start'] as const).map((tab) => ({
    name: `Lookup on its ${tab} tab`,
    reach: async (page: Page): Promise<void> => {
      await navigate(page, /^lookup$/i);
      const chip = page.getByRole('tab', { name: new RegExp(`^\\s*${tab}\\s*$`, 'i') });
      await expect(chip, `the ${tab} tab is on screen`).toBeVisible();
      await chip.click();
      await expect(chip, `the ${tab} tab is selected`).toHaveAttribute('aria-selected', 'true');
    },
  })),
];

// --- Measuring --------------------------------------------------------------

/**
 * One computed property of one element, read off a node that is still in the document.
 *
 * Waiting for visibility is NOT enough, and this is the subtle part. The element WAS on screen when
 * the locator resolved; what breaks a one-shot read is what happens next. A screen is drawn from
 * what Postgres held, so the app re-renders when its day-log read lands, and the node the locator
 * resolved to is REPLACED. getComputedStyle on a detached node returns an EMPTY STRING, so the read
 * comes back '' -- not a missing element, not a wrong colour -- and an assertion against '' reports
 * 'the font is wrong' when the truth is 'the node went away'.
 *
 * So no handle is held across a re-render. The locator resolution and the style read happen together
 * inside a single retried step, and the step only settles on a NON-EMPTY value: a detached node, or
 * a property read before the stylesheet applies, simply causes another attempt. expect.poll re-runs
 * the whole callback, locator resolution included, which a bare await cannot. The value the poll
 * settled ON is what is returned -- it is remembered as the callback runs rather than read again
 * afterwards, because a fresh read after the poll would be one more one-shot read with one more
 * chance to land on a detached node. Callers therefore assert ordering within a string that is known
 * to be non-empty.
 *
 * Every computed-style read in this spec goes through here: the font families and the palette
 * colours alike are each a read of a node a re-render can replace.
 */
const computed = async (locator: Locator, property: string): Promise<string> => {
  let settled = '';

  const read = async (): Promise<string> => {
    settled = '';
    const target = locator.first();
    if ((await target.count()) === 0) {
      return '';
    }
    settled = await target
      .evaluate((node, name) => getComputedStyle(node as Element).getPropertyValue(name), property)
      .catch(() => '');
    return settled;
  };

  await expect
    .poll(read, {
      message: `the element whose ${property} is read is on screen and reports a ${property}`,
    })
    .not.toBe('');

  return settled;
};

/**
 * Does the document scroll sideways? Kept because it is the design's own wording, but note that
 * theme.css clips overflow on html and body, so this can pass on a layout that is genuinely too
 * wide. The per-element check below is what actually falsifies that.
 */
const scrollsHorizontally = (page: Page): Promise<boolean> =>
  page.evaluate(() => {
    const root = document.documentElement;
    return root.scrollWidth > root.clientWidth || document.body.scrollWidth > root.clientWidth;
  });

/**
 * The first element, if any, that reaches past the viewport on either side. This is the design's
 * 'no element has a fixed pixel width that could exceed the viewport', checked directly, so that
 * clipped overflow cannot hide behind an unscrollable document.
 */
const overflowingElement = (page: Page, width: number, tolerance: number): Promise<string | null> =>
  page.evaluate(
    ({ viewportWidth, slack }) => {
      const describe = (element: Element): string => {
        const classes = element.getAttribute('class');
        return `${element.tagName.toLowerCase()}${classes ? `.${classes.split(/\s+/).join('.')}` : ''}`;
      };
      for (const element of Array.from(document.querySelectorAll('*'))) {
        const box = element.getBoundingClientRect();
        if (box.width <= 0 || box.height <= 0) {
          continue;
        }
        if (box.right > viewportWidth + slack || box.left < -slack) {
          return `${describe(element)} spans ${Math.round(box.left)}..${Math.round(box.right)} in a ${viewportWidth} px viewport`;
        }
      }
      return null;
    },
    { viewportWidth: width, slack: tolerance },
  );

/**
 * The frame the screens are drawn into, and the identity of whichever box was found, so a failure
 * can name it. A main landmark is preferred when the app exposes one; the application root that
 * index.html declares is the fallback. The frame is awaited rather than counted bare: a screen is
 * opened asynchronously, and `expect(locator)` retries where `count()` does not.
 */
type Frame = { readonly locator: Locator; readonly identity: string };

const contentFrame = async (page: Page): Promise<Frame> => {
  const main = page.getByRole('main');
  if (await main.first().isVisible().catch(() => false)) {
    return { locator: main.first(), identity: "the screen's main region" };
  }
  const root = page.locator('#app');
  await expect(root, 'the screen is drawn into a main region or the #app root').toBeVisible();
  return { locator: root, identity: 'the #app root' };
};

/**
 * The width of the content itself, inside whatever side gutter the frame keeps.
 *
 * The box is read with getBoundingClientRect().width, which every rendered element has, rather than
 * from a computed width that can be 'auto' or empty and parse to NaN. The gutter is subtracted only
 * where the computed padding is a finite number of pixels, so a missing or non-numeric padding
 * leaves the measurement whole instead of poisoning it: this function returns a real number or
 * throws, and never hands a NaN to a comparison that a NaN would make unfalsifiable.
 */
const contentWidth = async (page: Page, where: string): Promise<number> => {
  const frame = await contentFrame(page);
  const measured = await frame.locator.evaluate((node) => {
    const element = node as HTMLElement;
    const style = getComputedStyle(element);
    const pixels = (value: string): number => {
      const parsed = Number.parseFloat(value);
      return Number.isFinite(parsed) ? parsed : 0;
    };
    return (
      element.getBoundingClientRect().width -
      pixels(style.paddingLeft) -
      pixels(style.paddingRight)
    );
  });
  if (!Number.isFinite(measured)) {
    throw new Error(
      `${where}: ${frame.identity} gave no measurable width (got ${String(measured)}), so the content width could not be read`,
    );
  }
  return measured;
};

/**
 * One screen at one width in one scheme: it does not scroll sideways, nothing on it reaches past the
 * viewport, and the content fills the viewport less its 16 px gutters rather than sitting in a
 * narrower fixed column.
 */
const expectFillsAndFits = async (page: Page, width: number, where: string): Promise<void> => {
  expect(await scrollsHorizontally(page), `${where}: the document does not scroll sideways`).toBe(
    false,
  );
  expect(
    await overflowingElement(page, width, TOLERANCE),
    `${where}: nothing reaches past the ${width} px viewport`,
  ).toBeNull();

  const expected = width - 2 * GUTTER;
  const actual = await contentWidth(page, where);
  expect(
    Math.abs(actual - expected),
    `${where}: the content spans ${expected} px -- the ${width} px viewport less a ${GUTTER} px gutter each side -- and is not letterboxed into a narrower column (measured ${Math.round(actual)} px)`,
  ).toBeLessThanOrEqual(TOLERANCE);
};

// --- The oracle: the two palettes -------------------------------------------

for (const scheme of SCHEMES) {
  test(`with the device set to ${scheme} the page uses the canvas's ${scheme} palette`, async ({
    browser,
  }) => {
    const expectedPalette = PALETTE[scheme];
    const phone = await openPhone(browser, WIDTHS[0], scheme);

    // A filled button keeps the deep teal in BOTH schemes, so a white label stays readable on it.
    // The sign-in screen's submit is a filled button.
    const filled = phone.getByRole('button', { name: /sign in/i });
    expect(
      await computed(filled, 'background-color'),
      `a filled button keeps the deep teal #1F6F63 in ${scheme}`,
    ).toBe(FILLED_ACCENT);

    const body = phone.locator('body');
    expect(
      await computed(body, 'background-color'),
      `the ${scheme} ground is the canvas's`,
    ).toBe(expectedPalette.ground);
    expect(await computed(body, 'color'), `the ${scheme} ink is the canvas's`).toBe(
      expectedPalette.ink,
    );

    await signIn(phone, accounts.owner);
    // The cards are drawn from what Postgres held, so wait for the log before reading a card's
    // colour: a read taken straight after signing in has no retry.
    await dayLogSettled(phone);

    // A card sits on the ground in the card colour: the second half of the palette's two surfaces.
    const card = phone
      .getByRole('listitem')
      .filter({ hasText: /breakfast/i })
      .first();
    expect(
      await computed(card, 'background-color'),
      `the ${scheme} card colour is the canvas's`,
    ).toBe(expectedPalette.card);

    // The ground and the ink survive signing in: the scheme is the device's, not a screen's.
    expect(
      await computed(body, 'background-color'),
      `the ${scheme} ground is unchanged on Today`,
    ).toBe(expectedPalette.ground);

    await phone.context().close();
  });
}

// --- The oracle: the bands do not change their mind in the dark -------------

test('a change band is the same colour in both schemes', async ({ browser }) => {
  const bandColours: Record<string, Record<Scheme, string>> = {};

  for (const scheme of SCHEMES) {
    const phone = await openPhone(browser, WIDTHS[0], scheme);
    await signIn(phone, accounts.owner);

    // The bands are drawn from the day log, so wait for the log before counting them: a bare
    // count() straight after signing in samples an empty list and does not retry.
    await dayLogSettled(phone);

    const banded = phone.locator('[data-change-band]');
    await expect(
      banded.first(),
      'Today publishes at least one change band to compare',
    ).toBeVisible();
    const count = await banded.count();

    for (let index = 0; index < count; index += 1) {
      const element = banded.nth(index);
      const name = await element.getAttribute('data-change-band');
      expect(name, 'a banded element names its band').not.toBeNull();
      const key = `${name}`;
      bandColours[key] ??= {} as Record<Scheme, string>;
      bandColours[key][scheme] = await computed(element, 'color');
    }

    await phone.context().close();
  }

  const compared = Object.entries(bandColours).filter(
    ([, colours]) => colours.light !== undefined && colours.dark !== undefined,
  );
  expect(compared.length, 'at least one band was drawn in both schemes').toBeGreaterThan(0);

  for (const [band, colours] of compared) {
    // A band states what happened, and it must not change its mind in the dark.
    expect(
      colours.dark,
      `the ${band} band reads the same in the dark as in the light`,
    ).toBe(colours.light);
  }
});

// --- The oracle: the canvas's two typefaces, with their fallbacks -----------

for (const scheme of SCHEMES) {
  test(`the canvas's two typefaces are used in ${scheme}, each behind a fallback`, async ({
    browser,
  }) => {
    const phone = await openPhone(browser, WIDTHS[0], scheme);
    await signIn(phone, accounts.owner);

    // The font family is a declaration and does not wait on Google Fonts. What it DOES wait on is the
    // day-log read: when that lands the app re-renders and this heading's node is replaced, so a
    // handle held across the re-render reads a detached node and yields an empty string. Waiting for
    // visibility here would not help -- the heading is visible either way -- so the locator is handed
    // to computed() unresolved, and computed() re-resolves and re-reads until the value is real.
    await dayLogSettled(phone);
    const heading = phone.getByRole('heading', { name: /^today$/i });

    const headingFamily = await computed(heading, 'font-family');
    const serifFallback = /Georgia|serif/i.exec(headingFamily);
    expect(
      headingFamily,
      `a heading names Fraunces in ${scheme} (got: ${headingFamily})`,
    ).toMatch(/Fraunces/i);
    expect(
      serifFallback,
      `a heading declares a serif fallback behind Fraunces, so the app is usable before the fonts arrive (got: ${headingFamily})`,
    ).not.toBeNull();
    expect(
      headingFamily.search(/Fraunces/i),
      'Fraunces comes ahead of its serif fallback',
    ).toBeLessThan(headingFamily.search(/Georgia|serif/i));

    const bodyFamily = await computed(phone.locator('body'), 'font-family');
    expect(
      bodyFamily,
      `body text names IBM Plex Sans in ${scheme} (got: ${bodyFamily})`,
    ).toMatch(/IBM Plex Sans/i);
    expect(
      /system-ui|sans-serif/i.exec(bodyFamily),
      `body text declares a sans fallback behind IBM Plex Sans (got: ${bodyFamily})`,
    ).not.toBeNull();
    expect(
      bodyFamily.search(/IBM Plex Sans/i),
      'IBM Plex Sans comes ahead of its sans fallback',
    ).toBeLessThan(bodyFamily.search(/system-ui|sans-serif/i));

    await phone.context().close();
  });
}

// --- The oracle: every screen fills the phone at every width ----------------

for (const scheme of SCHEMES) {
  for (const width of WIDTHS) {
    test(`every screen fills ${width} px in ${scheme} without scrolling sideways`, async ({
      browser,
    }) => {
      test.setTimeout(5 * 60 * 1000);
      const phone = await openPhone(browser, width, scheme);

      // The sign-in screen, before there is a session to draw anything else with.
      await expectFillsAndFits(phone, width, `the sign-in screen at ${width} px in ${scheme}`);

      await signIn(phone, accounts.owner);

      for (const screen of SCREENS) {
        await returnToToday(phone);
        await screen.reach(phone);
        await expectFillsAndFits(phone, width, `${screen.name} at ${width} px in ${scheme}`);
      }

      await phone.context().close();
    });
  }
}
