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

const OWNER_MEAL_LINE = 'Breakfast · 07:40 · Oats 60 g, Milk 200 ml';
const OWNER_NIGHT_LINE = '18 u at 22:30';
const EMPTY_DAY_LOG = 'No entries yet.';

/** Every piece of text that only exists because account A owns a row. */
const OWNER_ONLY_TEXT = [
  OWNER_MEAL_LINE,
  OWNER_NIGHT_LINE,
  'Breakfast',
  '07:40',
  '22:30',
  'Oats',
  'Milk',
  '60 g',
  '200 ml',
  '104',
  '186',
  '132',
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
  await expect(phone.getByText(OWNER_MEAL_LINE, { exact: true })).toBeVisible();
  await expect(phone.getByText(OWNER_NIGHT_LINE, { exact: true })).toBeVisible();
  await expect(phone.getByText(EMPTY_DAY_LOG, { exact: true })).toHaveCount(0);
  expect(await scrollsHorizontally(phone)).toBe(false);

  // The same phone, the same bundle: account A signs out, account B signs in.
  await signOut(phone);
  await signIn(phone, accounts.stranger);

  await expect(phone.getByText(EMPTY_DAY_LOG, { exact: true })).toBeVisible();
  const strangerText = (await phone.locator('body').innerText()).replace(/\s+/g, ' ');
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
  await expect(phone.getByText(OWNER_MEAL_LINE, { exact: true })).toBeVisible();
  await expect(phone.getByText(OWNER_NIGHT_LINE, { exact: true })).toBeVisible();
});
