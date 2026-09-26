import { test, expect, type Browser, type Page } from '@playwright/test';
import { startLocalStack, type LocalStack } from '../support/local-stack';
import { seedAccounts, type Account, type SeededAccounts } from '../support/accounts';

/**
 * Public oracle for value 1: sign-in and per-user data.
 *
 * Observation: a person opens the site on a phone, signs in with email and password,
 * and sees only their own data; a second account sees none of the first account's rows.
 *
 * The oracle drives the built static bundle in a real browser against the Supabase CLI
 * local stack, so real Postgres row-level security is what separates the two accounts.
 * Both accounts use ONE page on ONE bundle, changing hands through the sign-out control,
 * because that is the stimulus the design declares: a phone where the second account
 * signs in after the first signs out. A fresh browser context would prove less, since it
 * cannot show that account A's session is actually gone.
 */

const PHONE_VIEWPORT = { width: 360, height: 780 } as const;

/**
 * Ownership is judged on data-entry elements, never on wording. An element carries
 * data-entry exactly when it renders something the signed-in account recorded: a food
 * with its amount, a clock time, a dose, a glucose reading. Screen furniture -- slot
 * labels, headings, the date, any 'not logged' placeholder -- is the same for every
 * account and carries nothing, so this oracle keeps its meaning when a later value
 * reshapes the plain lines into cards.
 */
const DATA_ENTRY = '[data-entry]';

/** Every value account A actually recorded, as it must reach the reading surface. */
const OWNER_RECORDED = [
  'Oats 60 g',
  'Milk 200 ml',
  '07:40',
  '5 u',
  '104',
  '186',
  '18 u at 22:30',
] as const;

/**
 * Fragments that exist on the page only because account A owns a row. Deliberately no
 * slot label and no placeholder: asserting the absence of 'Breakfast' or of an empty-day
 * sentence would falsely fail once value 2 draws a fixed card per slot for every account.
 */
const OWNER_ONLY_TEXT = [
  'Oats',
  'Milk',
  '60 g',
  '200 ml',
  '07:40',
  '22:30',
  '104',
  '186',
  '5 u',
  '18 u',
] as const;

let stack: LocalStack;
let accounts: SeededAccounts;

test.describe.configure({ mode: 'serial' });
test.use({ viewport: PHONE_VIEWPORT });

test.beforeAll(async () => {
  test.setTimeout(10 * 60 * 1000);
  stack = await startLocalStack();
  accounts = await seedAccounts(stack);
});

test.afterAll(async () => {
  await stack?.stop();
});

const signIn = async (page: Page, account: Account): Promise<void> => {
  await page.getByLabel(/email/i).fill(account.email);
  await page.getByLabel(/password/i).fill(account.password);
  await page.getByRole('button').click();
};

/** The signed-in frame's sign-out control returns the page to the sign-in screen. */
const signOut = async (page: Page): Promise<void> => {
  await page.getByRole('button', { name: /sign out/i }).click();
  await expect(page.getByLabel(/password/i)).toBeVisible();
};

const openPhone = async (browser: Browser): Promise<Page> => {
  const context = await browser.newContext({ viewport: PHONE_VIEWPORT });
  const page = await context.newPage();
  await page.goto(stack.siteUrl);
  return page;
};

/** The text of every element on the page that claims to render recorded data. */
const dataEntryText = async (page: Page): Promise<string> => {
  const texts = await page.locator(DATA_ENTRY).allInnerTexts();
  return texts.join(' | ').replace(/\s+/g, ' ');
};

/** Everything the page says, whitespace-normalised, furniture included. */
const pageText = async (page: Page): Promise<string> =>
  (await page.locator('body').innerText()).replace(/\s+/g, ' ');

const expectOwnerSeesOwnData = async (page: Page): Promise<void> => {
  await expect(page.locator(DATA_ENTRY).first()).toBeVisible();
  const entries = await dataEntryText(page);
  for (const recorded of OWNER_RECORDED) {
    expect(entries, `account A must read its own recorded value: ${recorded}`).toContain(recorded);
  }
};

const scrollsHorizontally = (page: Page): Promise<boolean> =>
  page.evaluate(() => {
    const root = document.documentElement;
    return root.scrollWidth > root.clientWidth || document.body.scrollWidth > root.clientWidth;
  });

test("the owning account reads its own day log and a second account reads none of it", async ({
  browser,
}) => {
  const phone = await openPhone(browser);

  // Account A signs in and reads its own day log.
  await signIn(phone, accounts.owner);
  await expectOwnerSeesOwnData(phone);
  expect(await scrollsHorizontally(phone)).toBe(false);

  // The same phone, the same bundle: account A signs out, account B signs in.
  await signOut(phone);
  await signIn(phone, accounts.stranger);

  // Account B is signed in and reading, so the shell is up and the read has settled.
  await expect(phone.getByRole('button', { name: /sign out/i })).toBeVisible();
  await expect(phone.locator(DATA_ENTRY)).toHaveCount(0);

  const strangerText = await pageText(phone);
  for (const owned of OWNER_ONLY_TEXT) {
    expect(strangerText, `account B's page must not show account A's data: ${owned}`).not.toContain(
      owned,
    );
  }
  expect(await scrollsHorizontally(phone)).toBe(false);

  // Account A's rows are still readable by their owner, so account B's empty day log is
  // row-level security at work rather than a failed read or a lost seed.
  await signOut(phone);
  await signIn(phone, accounts.owner);
  await expectOwnerSeesOwnData(phone);
});
