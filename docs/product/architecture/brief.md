## Meal & Insulin Log product brief, value 1: sign-in and per-user data

### Purpose
Stand up the static web app shell, the owner-scoped Postgres schema and the Supabase identity boundary, so that a person signs in with email and password and sees their own entries, and a second account signing in on the same site sees none of the first account's rows.

### Constraints
- The front end is a static bundle only; GitHub Pages serves prebuilt files and there is no server process to operate.
- The backend is Supabase on its free tier: Postgres for data, Supabase Auth for email and password identity, and the browser calling Supabase directly with the JS client.
- Schema and row-level security live in the repository as SQL migrations run by the Supabase CLI; tests run against the CLI's local Docker stack, not a hosted project.
- Only the Supabase project URL and the anon key may reach the browser bundle; the service-role key never leaves the developer machine and never appears in the repository.
- Row-level security is deny by default: every user table has it enabled and every policy is scoped to the owning account.
- The layout is fluid with no fixed page width and no horizontal scrolling at any viewport width from 360 px upward.
- Light and dark palettes come from the canvas design reference and follow the device setting.
- Glucose is stored and shown in mg/dL as whole numbers.
- The app never recommends a dose.

### Targets
| Path | Decision | Reason |
|---|---|---|
| `package.json` | EXTEND | The walking skeleton already declares the build, the Supabase client and the verification scripts; this value adds nothing but may add a dependency it needs. |
| `tsconfig.json` | EXTEND | Strict browser-source settings already exist; extend only if a new source root needs including. |
| `vite.config.ts` | EXTEND | The static build and the GitHub Pages base path already exist; extend only for an environment variable this value introduces. |
| `index.html` | EXTEND | The served page and its fluid viewport already exist; extend to load the theme stylesheet. |
| `src/main.ts` | EXTEND | The composition root exists as an empty module; this value makes it build the adapters, read the session and render a screen. |
| `src/ports/identity.ts` | CREATE_NEW | The driving port for sign-in, sign-out and current account, so the domain compiles without the Supabase SDK. |
| `src/ports/log-store.ts` | CREATE_NEW | The driven port this value already consumes: read the signed-in account's entries for one date. |
| `src/domain/entry.ts` | CREATE_NEW | The Entry and NightInsulin types and the pure functions that turn one into its day-log line, so the reading rule is testable without a browser. |
| `src/adapters/supabase/client.ts` | CREATE_NEW | Builds the single Supabase JS client from build-time public configuration. |
| `src/adapters/supabase/identity.ts` | CREATE_NEW | Implements the identity port against Supabase Auth and maps its errors onto the named failure outcomes. |
| `src/adapters/supabase/log-store.ts` | CREATE_NEW | Implements the log-store port against PostgREST with no user_id filter of its own, so row-level security alone decides what comes back. |
| `src/ui/sign-in.ts` | CREATE_NEW | The sign-in screen: a labelled email and password form with the refusal and retry messages. |
| `src/ui/shell.ts` | CREATE_NEW | The signed-in frame: the header naming today's local date, the 'Sign out' control, and the slot the day log renders into. |
| `src/ui/day-log.ts` | CREATE_NEW | The reading surface this value is judged on: the signed-in account's own entries for one date as one line each, with the empty state when it owns none. |
| `src/ui/theme.css` | CREATE_NEW | The light and dark palette tokens taken from the canvas reference, selected by the device colour-scheme setting. |
| `supabase/config.toml` | CREATE_NEW | Pins the local Supabase stack the acceptance run starts with the CLI. |
| `supabase/migrations/0001_owner_scoped_schema.sql` | CREATE_NEW | Creates meals, meal_foods and night_insulin, enables row-level security on all three and adds the owner policies the oracle falsifies. |
| `.github/workflows/pages.yml` | CREATE_NEW | Builds the bundle and publishes it to GitHub Pages, which is how the URL in the observation comes to exist. |
| `tests/acceptance/own-data-only.spec.ts` | CREATE_NEW | The public oracle for this value, driving the served bundle in a browser as two separate accounts. |
| `tests/support/local-stack.ts` | CREATE_NEW | Starts the local Supabase stack, applies migrations and hands the test its URL, anon key and service-role key. |
| `tests/support/accounts.ts` | CREATE_NEW | Creates the two test accounts and seeds account A's named rows through the service role, outside the browser. |

### Paradigm
functional

### Decisions
- Build with Vite and TypeScript; the artefact is a static bundle in dist/ that any static host, GitHub Pages included, serves unchanged.
- No UI framework. A screen is a pure function from state to a DOM subtree, so every rule this product is judged on stays testable without a renderer.
- The Supabase JS client v2 is the only data access path. There is no custom server and no API layer of our own.
- The Supabase project URL and anon key are build-time public configuration injected as Vite environment variables; both are safe to publish because row-level security, not key secrecy, is what separates the two accounts.
- This value creates the whole user schema, because row-level security has to be right on every table from the first migration rather than bolted on per screen. The three user tables are meals, meal_foods and night_insulin.
- meals holds id, user_id, slot, eaten_on, eaten_at, glucose_before, glucose_after, insulin_units, exercise_context, note. meal_foods holds id, user_id, meal_id, name, food_type, amount, unit, position. night_insulin holds id, user_id, night_on, units, taken_at, bedtime_glucose. Glucose columns are integers in mg/dL.
- Every user table carries user_id uuid not null default auth.uid() references auth.users(id) on delete cascade, has row-level security enabled, and has policies using (auth.uid() = user_id) for select, update and delete and with check (auth.uid() = user_id) for insert.
- Ownership is enforced in Postgres, never in the browser. The log-store adapter issues no user_id filter of its own; if a policy were dropped the oracle would fail rather than a client-side filter hiding it.
- The reading surface for this value is deliberately plain: one text line per entry, no cards and no meal slots. A meal line reads 'Breakfast · 07:40 · Oats 60 g, Milk 200 ml' and a night insulin line reads '18 u at 22:30'. Value 2 reshapes these same rows into the designed cards.
- When the signed-in account owns no entries for the date, the day log shows exactly 'No entries yet.'
- The Supabase client's own persisted session is the session. The app renders the sign-in screen when there is none and the shell when there is, and re-renders on the auth state change event.
- Acceptance runs against the Supabase CLI local stack in Docker with two seeded accounts, so the oracle exercises real Postgres and real row-level security rather than a stub.
- The oracle drives the built bundle served as static files, because a live GitHub Pages URL is not a locally falsifiable observation; the Pages workflow publishes that same bundle.
- The oracle and its test supports are the only bytes the acceptance step writes. supabase/migrations/0001_owner_scoped_schema.sql is production scope and is written at craft time, so the oracle is red until the schema and its policies exist.
- The test substrate is a walking skeleton committed before this value: Vite builds, Playwright drives a real browser at a 360 px viewport, and the Supabase CLI brings up local Postgres in Docker. The oracle runs `npm run test:acceptance -- tests/acceptance/own-data-only.spec.ts`, which names the oracle, so the pre-craft red check and the candidate verification are the same command.
- The package is CommonJS, because Playwright compiles TypeScript tests to CommonJS unless the package declares ESM, and the acceptance support resolves the repository root through __dirname.
- Typechecking is split in two: tsconfig.json covers the browser sources with DOM types only, and tsconfig.node.json covers the tests and the tool configuration with Node types, so a browser source can never reach a Node API by accident.
- Sign-out is part of this value. The identity port carries a session-ending signOut, and the signed-in shell carries a control whose accessible name is 'Sign out'. Signing out clears the persisted session and returns the sign-in screen. Without it the two accounts cannot change hands on one phone, which is the situation the observation describes, and the stronger claim -- that account A's session is actually gone -- would go unproven.
- meals carries eaten_on date not null, the local calendar date the meal belongs to, beside eaten_at timestamptz for the clock time. night_insulin carries night_on date not null the same way. Every day query selects on the date column, never on the timestamp, so no reading depends on the server's UTC offset and a 22:30 entry cannot fall into the wrong day.
- meal_foods.food_type is not null with a check constraint over the seven types the brief fixes: carb-heavy, protein, vegetable, fruit, dairy, mixed dish, drink. The seeded foods are Oats as carb-heavy and Milk as dairy.
- The shell opens on today's local calendar date. This value has no date-selection surface; value 2 adds the day stepper the canvas shows.
- Browser sources typecheck under exactOptionalPropertyTypes, so a local type mirroring an SDK type with an optional property must spell it `prop?: T | undefined`. Supabase's AuthError.status is number | undefined and will not satisfy a bare `status?: number`.

### Reuse analysis
| Symbol | Locator | Decision | Reason |
|---|---|---|---|

### Prefactoring
Not applicable: The repository holds no source code yet, so there is no existing structure to move before this change.

### Agreement analysis
Not applicable: No contract exists yet between separately released parts. This value introduces the database schema and its only consumer together in one candidate, so nothing can be left behind on an older agreement.

### Boundaries
- Driving port: A person acting through a phone browser: open the site, submit email and password, read their own entries for a date, and sign out.
- Driven port: Supabase Auth over HTTPS for email and password sign-in, sign-out and session refresh.
- Driven port: Supabase PostgREST over HTTPS for owner-scoped row reads and writes under row-level security.
- Driven port: The browser's persistent storage, which holds the Supabase session between visits.
- Dependency direction: The screens and the domain depend on the identity and log-store port interfaces; the Supabase adapters depend on those interfaces. Nothing under src/ports or src/domain imports the Supabase SDK, so the rules compile and run without a network.
- Failure: Condition: Supabase Auth rejects the submitted email and password. | Outcome: Refusal | Observation: The sign-in screen stays, shows 'Email or password is not correct', no session is stored, and the password field is cleared.
- Failure: Condition: The network is unreachable while sign-in is being submitted. | Outcome: Retry | Observation: The sign-in screen shows 'Cannot reach the server. Try again.' and the submit button becomes usable again with the email still filled in.
- Failure: Condition: A read asks for rows the signed-in account does not own. | Outcome: Refusal | Observation: Row-level security returns no row. The day log shows 'No entries yet.' and never shows another account's data.
- Failure: Condition: The stored session has expired and refreshing it fails. | Outcome: Refusal | Observation: The app returns to the sign-in screen showing 'Your session ended. Sign in again.' and the stale session is cleared.
- Failure: Condition: The day log read fails because the server is unreachable. | Outcome: Retry | Observation: The day log shows 'Cannot reach the server. Try again.' with a usable retry control, and shows no entries rather than stale ones.
- Failure: Condition: A write is sent and the response is lost before it arrives, so the browser cannot tell whether Postgres committed it. | Outcome: Indeterminate | Observation: The screen says 'Could not confirm the save. Check the entry before saving again.' and does not silently retry, because a duplicated meal would corrupt the comparison this product exists for.

### Acceptance supports
- `tests/support/local-stack.ts`
- `tests/support/accounts.ts`

### Public oracle
Observation: A person opens the site on a phone, signs in with email and password, and sees only their own data; a second account sees none of the first account's rows.

Stimulus: Two accounts exist in the local Supabase stack. Account A owns, dated today in local terms: one meals row (slot breakfast, eaten_on today, eaten_at 07:40, glucose_before 104, glucose_after 186, insulin_units 5) with two meal_foods rows (Oats, carb-heavy, 60 g and Milk, dairy, 200 ml), and one night_insulin row (night_on today, units 18, taken_at 22:30, bedtime_glucose 132). Account B owns no rows in any of the three tables. One browser page at a 360 px viewport loads the built static bundle, signs in as account A and reads the day log, then uses the 'Sign out' control and signs in as account B on the same page and reads the day log again.

Expected: Signed in as account A the day log shows the line 'Breakfast · 07:40 · Oats 60 g, Milk 200 ml' and the line '18 u at 22:30'. Signing out returns the sign-in screen. Signed in as account B the day log shows exactly 'No entries yet.' and neither of account A's lines, nor any other text from account A's rows, appears anywhere on the page. Account A signing in again still sees its own two lines, so the empty log was row-level security and not a lost seed. Both sign-ins succeed and the page never scrolls horizontally.

Falsifier: Account B's page contains any text from a row account A owns, or account A's own two lines are missing from its day log on either sign-in, or signing out leaves the shell on screen, or either account cannot sign in with correct credentials, or the document scrolls horizontally at a 360 px viewport.

### Oracle and verification
Oracle target locator: `tests/acceptance/own-data-only.spec.ts`

Verification command: `npm run build`
Verification command: `npm run test:acceptance -- tests/acceptance/own-data-only.spec.ts`
## Meal & Insulin Log product brief, value 2: the Today screen

### Purpose
Reshape the plain day log into the Today screen the canvas draws: the date with a day stepper, a card per logged meal showing slot, time, foods, dose and before to after with the change, a 'Not logged yet' card for each empty fixed slot, and a night insulin card.

### Constraints
- The front end is a static bundle only; GitHub Pages serves prebuilt files and there is no server process to operate.
- Row-level security stays the only thing that scopes a read; no screen may filter by user_id.
- The layout is fluid with no fixed page width and no horizontal scrolling at any viewport width from 360 px upward.
- Light and dark palettes come from the canvas design reference and follow the device setting.
- Glucose is shown in mg/dL as whole numbers.
- The app never recommends a dose, and a colour band is a description of what happened, never advice.
- The Today screen reads; it does not write. Recording a meal is value 3.

### Targets
| Path | Decision | Reason |
|---|---|---|
| `src/domain/entry.ts` | EXTEND | Add the change between the two readings and the per-slot grouping the cards need, beside the line formatting value 1 established. |
| `src/domain/band.ts` | CREATE_NEW | The level bands and the change bands from the brief's decisions, in one place, because History in value 9 is judged on exactly the same rule. |
| `src/ui/day-log.ts` | EXTEND | The plain line list becomes the card list this value is judged on: a card per logged meal, a 'Not logged yet' card per empty fixed slot, and the night insulin card. |
| `src/ui/shell.ts` | EXTEND | The header becomes the designed one: the weekday and date above the heading, with the previous and next day controls. |
| `src/ui/theme.css` | EXTEND | Card, chip, pill and band tokens for both palettes. |
| `src/main.ts` | EXTEND | Hold the date being read and re-read the day log when the stepper moves it. |
| `tests/acceptance/today-screen.spec.ts` | CREATE_NEW | The public oracle for this value. |

### Paradigm
functional

### Decisions
- The Today screen shows three fixed slots in order: breakfast, lunch, dinner. Each is either a meal card or a 'Not logged yet' card. A snack is not a fixed slot: a logged snack appears as its own card after dinner, and no empty snack card is ever shown.
- A meal card shows the slot label, the clock time as HH:MM, the foods joined with ' · ' as 'Oats 60 g · Milk 200 ml', the dose as '5 u', and the two readings with the change, as '104', '186' and '+82'.
- The change is after minus before. It is written with an explicit sign: '+82', '−18' using the true minus sign U+2212, and '0' for no change. When either reading is missing there is no change and the card shows only the reading it has.
- An empty fixed slot card shows the slot label and exactly 'Not logged yet'.
- The night insulin card shows 'Night insulin' and the dose line '18 u at 22:30'. When nothing is recorded for the date it shows 'Night insulin' and exactly 'Not logged yet'.
- The four change bands are the brief's: dropped is a change of −40 or less, stable is −39 to +30, rose is +31 to +60, rose-high is more than +60. The four level bands are: low under 70, in-range 70 to 180, high 181 to 250, very-high over 250.
- A band is published in the DOM as a data-change-band or data-level-band attribute carrying one of those names, and the colour is bound to the attribute in CSS. The oracle asserts the band name, not a colour, because a band is the rule under test and a hex value is how it happens to be painted.
- Band colours, both palettes, from the canvas: dropped #2F5FA8, stable #2E7D4F, rose #B45309, rose-high #7C3A0B; low #B42318, in-range #2E7D4F, high #B45309, very-high #7C3A0B. The canvas keeps these unchanged between light and dark on purpose, so the two themes read the same.
- Today's card colours the change only, never the level, because the card is a judgement about the meal. The level bands exist for History's Before view in value 9 and are unused here.
- The header shows the weekday and date above the heading, and the heading is 'Today' when the date being read is the local today and the date itself otherwise. Previous-day and next-day controls carry the accessible names 'Previous day' and 'Next day'; the next-day control is disabled when the date being read is today, because the log has no future.
- The date being read lives in the composition root, not in a screen. Moving it re-reads the day log through the same port, so nothing caches another day's rows.
- Cards are read-only in this value. Nothing on the Today screen opens a meal or records one; value 3 records and value 6 opens.

### Reuse analysis
| Symbol | Locator | Decision | Reason |
|---|---|---|---|
| foodText | `src/domain/entry.ts:57` | REUSE | The card's food segment is the same text the plain line used; only the joiner differs. |
| clockTime | `src/domain/entry.ts:50` | REUSE | The card's time is the same local HH:MM. |
| slotLabel | `src/domain/entry.ts:47` | REUSE | The card heading and the empty slot card both name the slot the same way. |
| nightInsulinLine | `src/domain/entry.ts:75` | REUSE | '18 u at 22:30' is exactly the night card's dose line. |
| mealLine | `src/domain/entry.ts:68` | REPLACE | The one-line form existed so value 1 had a reading surface. The card supersedes it and nothing else calls it. |
| dayLogLines | `src/domain/entry.ts:83` | REPLACE | Replaced by a per-slot projection, because the screen is now grouped by slot and must show slots that have no meal. |
| dayLogSection | `src/ui/day-log.ts:38` | EXTEND | Keeps its loading, failed and retry states, which are unchanged; only the loaded branch becomes cards. |
| LogStore | `src/ports/log-store.ts:17` | REUSE | The port already reads one date's meals and night insulin, which is everything this screen needs. |
| dateHeading | `src/ui/shell.ts:18` | EXTEND | Already renders a local date; gains the 'Today' form and the uppercase weekday line. |

### Prefactoring
Existing oracle: `tests/acceptance/own-data-only.spec.ts`

Move: Before the cards are built, lift the band rules out of nothing and into src/domain/band.ts, and split the day log's loaded branch from its loading, failed and retry branches, so the card work touches one branch of one function rather than rewriting the screen.

Preserved observation: A person signs in and sees only their own entries for the date, and a second account sees none of them. Value 1's oracle keeps passing throughout, because the rows read and the port they are read through do not change.

### Agreement analysis
Not applicable: No released contract changes. The schema is untouched and the log-store port keeps its shape, so no producer or consumer is left on an older agreement.

### Boundaries
- Driving port: A person reading the Today screen on a phone: see the date, the meals already logged with their doses and readings, which slots are still empty, and the night dose.
- Driven port: The log-store port, unchanged, for one date's meals and night insulin.
- Driven port: The identity port, unchanged, for the session the read runs as.
- Dependency direction: The cards are pure functions of a day log and depend on src/domain; src/domain depends on nothing. The Supabase adapters are untouched by this value.
- Failure: Condition: The day log read fails because the server is unreachable. | Outcome: Retry | Observation: The screen shows 'Cannot reach the server. Try again.' with a usable retry control and no cards at all, rather than a grid of empty slots that would read as a day with nothing logged.
- Failure: Condition: A meal has a before reading but no after reading yet. | Outcome: Refusal | Observation: The card shows the before reading alone, with no arrow and no change, because a change that has not happened must not be drawn as zero.
- Failure: Condition: The next-day control is used while the date being read is today. | Outcome: Refusal | Observation: The control is disabled and the date does not move, because the log has no future.

### Acceptance supports
- `tests/support/local-stack.ts`
- `tests/support/accounts.ts`

### Public oracle
Observation: After sign-in the Today screen shows the date, a card per logged meal (slot, time, foods, dose, before → after with the change), a 'not logged yet' card for an empty slot, and a night insulin card.

Stimulus: Account A owns, dated today in local terms: a breakfast at 07:40 (Oats carb-heavy 60 g, Milk dairy 200 ml, before 104, after 186, 5 units) and a lunch at 12:55 (Chicken rice mixed dish 250 g, Cucumber salad vegetable 80 g, before 112, after 133, 6 units), no dinner, and night insulin of 18 units at 22:30 with bedtime glucose 132. Dated yesterday it owns a single dinner at 19:10 (Soup mixed dish 300 ml, before 150, after 110, 4 units). A browser at a 360 px viewport signs in as account A on the built bundle, reads the Today screen, then uses the previous-day control.

Expected: The header reads 'Today'. A Breakfast card shows 07:40, 'Oats 60 g · Milk 200 ml', '5 u', '104', '186' and '+82' in the rose-high change band. A Lunch card shows 12:55, 'Chicken rice 250 g · Cucumber salad 80 g', '6 u', '112', '133' and '+21' in the stable change band. A Dinner card shows 'Not logged yet'. A night insulin card shows 'Night insulin' and '18 u at 22:30'. The next-day control is disabled. After the previous-day control the header shows yesterday's date rather than 'Today', a Dinner card shows 19:10 and '−40' in the dropped change band, and Breakfast and Lunch both show 'Not logged yet'. The page never scrolls horizontally.

Falsifier: Any of those card texts is absent or attached to the wrong slot, or a change is unsigned or wrongly signed, or a change carries the wrong band name, or an empty slot shows anything but 'Not logged yet', or the night insulin card is missing, or the next-day control is usable while today is being read, or the previous-day control does not move the date and its entries, or the document scrolls horizontally at a 360 px viewport.

### Oracle and verification
Oracle target locator: `tests/acceptance/today-screen.spec.ts`

Verification command: `npm run build`
Verification command: `npm run test:acceptance -- tests/acceptance/today-screen.spec.ts`
Verification command: `npm run test:acceptance`
