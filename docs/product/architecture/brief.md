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
- Every element that renders data the signed-in account actually recorded carries a data-entry attribute: a food with its amount, a clock time, a dose, a glucose reading. Screen furniture never does -- slot labels, headings, the date, and any 'not logged' placeholder are the same for every account and are not anybody's data. Ownership is judged on data-entry elements, so the oracle keeps its meaning when a later value reshapes the surface.
- 'No entries yet.' is what this value renders for a date the account has nothing on, but it is not what the oracle asserts. The oracle asserts that the page carries no data-entry element, because value 2 replaces that sentence with fixed slot cards and the ownership rule must outlive the wording.

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

Expected: Signed in as account A the day log carries data-entry elements whose text includes 'Oats 60 g', 'Milk 200 ml', '07:40', '5 u', '104', '186' and '18 u at 22:30'. Signing out returns the sign-in screen. Signed in as account B the day log carries no data-entry element at all, and none of account A's recorded text appears anywhere on the page. Account A signing in again still carries its own data-entry elements, so account B's empty log was row-level security and not a lost seed. Both sign-ins succeed and the page never scrolls horizontally.

Falsifier: Account B's page carries any data-entry element, or any text from a row account A owns, or account A's page is missing any of its own recorded values on either sign-in, or signing out leaves the shell on screen, or either account cannot sign in with correct credentials, or the document scrolls horizontally at a 360 px viewport. Slot labels, headings and placeholders are screen furniture and must NOT be treated as account A's data: asserting their absence would falsely fail once value 2 draws a card per slot.

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
- Value 1's data-entry rule carries forward unchanged: a meal card's time, foods, dose and readings each carry data-entry, and the night insulin dose line carries it. A slot label, a heading, the date and a 'Not logged yet' placeholder never do, because they are the same for every account.
- 'No entries yet.' is retired by this value. A date with nothing on it shows the three fixed slot cards reading 'Not logged yet' and a night insulin card reading 'Not logged yet', which is what the observation asks for and is also the surface value 3 logs from.
- startLocalStack must not return until the local stack actually answers. `supabase db reset` restarts containers, so the support polls the auth health endpoint and the REST endpoint until both respond, with a bounded deadline, before any seeding runs. Without it the second spec of a whole-suite run fails with 'fetch failed' while gotrue is still coming back, which reads as a product defect and is not one.

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

Preserved observation: A person signs in and sees only their own entries for the date, and a second account sees none of them. Value 1's oracle keeps passing because it judges ownership on data-entry elements, which the cards carry and the slot labels and placeholders do not.

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

Expected: The header reads 'Today'. A Breakfast card shows 07:40, 'Oats 60 g · Milk 200 ml', '5 u', '104', '186' and '+82' in the rose-high change band. A Lunch card shows 12:55, 'Chicken rice 250 g · Cucumber salad 80 g', '6 u', '112', '133' and '+21' in the stable change band. A Dinner card shows 'Not logged yet'. A night insulin card shows 'Night insulin' and '18 u at 22:30'. The next-day control is disabled. After the previous-day control the header shows yesterday's date rather than 'Today', a Dinner card shows 19:10 and '−40' in the dropped change band, and Breakfast and Lunch both show 'Not logged yet'. The page never scrolls horizontally. Account A's own values carry data-entry; the 'Not logged yet' cards and the slot labels do not.

Falsifier: Any of those card texts is absent or attached to the wrong slot, or a change is unsigned or wrongly signed, or a change carries the wrong band name, or an empty slot shows anything but 'Not logged yet', or the night insulin card is missing, or the next-day control is usable while today is being read, or the previous-day control does not move the date and its entries, or the document scrolls horizontally at a 360 px viewport.

### Oracle and verification
Oracle target locator: `tests/acceptance/today-screen.spec.ts`

Verification command: `npm run build`
Verification command: `npm run test:acceptance -- tests/acceptance/today-screen.spec.ts`
Verification command: `npm run test:acceptance`
## Meal & Insulin Log product brief, value 3: recording a meal

### Purpose
Let the person record a meal -- slot, time, one or more foods with type and amount, glucose before, rapid-acting units, exercise context and note, with glucose after optional -- see it on Today straight away, and reopen it later to add the after reading.

### Constraints
- The front end is a static bundle only; the browser writes through the Supabase JS client and there is no server process.
- Row-level security stays the only thing that scopes a read or a write; no screen may send or filter by user_id.
- The layout is fluid with no horizontal scrolling at any viewport width from 360 px upward.
- Glucose is whole numbers in mg/dL.
- Food types are the brief's seven; amount units are the brief's five.
- The app never recommends a dose. A saved dose is what the person says they took, never a suggestion.

### Targets
| Path | Decision | Reason |
|---|---|---|
| `supabase/migrations/0002_recording_constraints.sql` | CREATE_NEW | Constrain exercise_context and meal_foods.unit to their fixed lists, the same way food_type already is, so a mistyped value is refused at the row. |
| `src/domain/meal-draft.ts` | CREATE_NEW | The draft a person is filling in and the pure rules that say when it may be saved, so the refusals are testable without a browser. |
| `src/domain/entry.ts` | EXTEND | Add the food type and unit vocabularies the draft and the form share. |
| `src/ports/log-store.ts` | EXTEND | Add saving a new meal and updating an existing one, beside reading a date. |
| `src/adapters/supabase/log-store.ts` | EXTEND | Write the meal and its foods through PostgREST, still with no user_id of its own. |
| `src/ui/meal-form.ts` | CREATE_NEW | The New meal and Edit meal screen: slot, time, glucose before, foods, dose, context, note and glucose after. |
| `src/ui/food-form.ts` | CREATE_NEW | The Add food screen: name, type from the fixed list, amount and unit. |
| `src/ui/day-log.ts` | EXTEND | An empty slot card becomes the way to log that slot, and a meal card gains its Edit control. |
| `src/ui/shell.ts` | EXTEND | The frame gains the Cancel and Save header a form screen needs. |
| `src/ui/theme.css` | EXTEND | Form, field, segmented control, chip and list-row tokens for both palettes. |
| `src/main.ts` | EXTEND | Route between Today, New meal, Edit meal and Add food, and re-read the day after a save. |
| `tests/acceptance/record-a-meal.spec.ts` | CREATE_NEW | The public oracle for this value. |

### Paradigm
functional

### Decisions
- A meal is recorded from the Today screen: the 'Not logged yet' card for a slot opens New meal with that slot already chosen, and a logged meal card carries an Edit control named 'Edit breakfast', 'Edit lunch' and so on.
- The Edit control stays on the card for the rest of the delivery. Value 6 makes the card body open the meal detail, and the Edit control keeps its place and its name, so this value's oracle is not broken by that change.
- Every numeric field is a real labelled input that works with the device keyboard: glucose before, glucose after, the dose and a food's amount. Value 5 adds the in-app number pad and the minus and plus stepper as controls that write into these same inputs rather than replacing them, so a field keeps one accessible name and one value for the whole delivery.
- New meal requires a slot, a time and at least one food. Saving without a food is refused in place with 'Add at least one food.' and nothing is written. Glucose before, the dose, exercise context, the note and glucose after are all optional, because a person who forgot to measure must still be able to record what they ate.
- The time field defaults to the current local clock time and the meal is recorded against the date the Today screen is reading, so a meal logged late at night lands on the day the person is looking at rather than on the server's date.
- Exercise context is one of three: 'None', 'Before meal', 'After meal', stored as none, before, after. It defaults to None.
- Amount units are the brief's five: g, ml, pc, cup, tbsp. Food types are the brief's seven, offered as a list, and a food must have one.
- A meal and its foods are written together. If the foods fail to write after the meal row has been created, the meal row is removed again, because a meal with no foods is not a thing this product can compare and a half-written meal would quietly corrupt every later lookup.
- Editing an existing meal opens the same screen with the recorded values in place and the heading 'Edit meal'. Saving updates that row rather than creating another, so adding the after reading later does not produce a second meal.
- Saving returns to Today for the same date and the day is re-read, so the new card is what the store holds rather than what the form believed it wrote.
- Out of scope here and named so the form is not mistaken for finished: 'Start from a past meal' is value 7, the last-time suggestion box is value 8, and the in-app number pad and dose stepper are value 5. The reminder toggle the canvas draws is not in any value and is not built.
- The acceptance suite starts the local stack and applies migrations once per run, not once per spec: a reset restarts containers and costs about ninety seconds, and the suite is a declared verification vector that grows with every value. A spec isolates itself by removing its own accounts and rows through the service role, and seeds accounts under its own email prefix.
- A band boundary is checked against the brief, not guessed: 150 to 182 is +32, which is rose (+31 to +60), not stable (−39 to +30). The first draft of this design said stable and the oracle faithfully encoded that error, so the arithmetic is spelled out here.
- The meal form's fields are labelled exactly 'Slot', 'Time', 'Glucose before', 'Rapid-acting units', 'Exercise', 'Note' and 'Glucose after'. The Add food screen's are 'Food', 'Type', 'Amount' and 'Unit'.
- A field is matched by its EXACT label, never by a loose word or an alternation. Value 5 adds controls named 'Decrease dose' and 'Increase dose' beside the dose field, so a match on /units|dose/i resolves to three elements. The rule generalises value 4's: on one screen, a label and a control name must be distinguishable by exact match, and an oracle must use that exact match rather than a pattern that happens to be unique today.

### Reuse analysis
| Symbol | Locator | Decision | Reason |
|---|---|---|---|
| LogStore | `src/ports/log-store.ts:17` | EXTEND | The same boundary gains writing; a second port for writes would let a screen reach the database two ways. |
| MealSlot | `src/domain/entry.ts:8` | REUSE | The slot vocabulary the cards already use is the one the selector offers. |
| FoodPortion | `src/domain/entry.ts:10` | EXTEND | Reading never needed the food type; recording does, so the type joins the portion. |
| dayLogSection | `src/ui/day-log.ts:59` | EXTEND | The cards it already draws become the entry points; nothing about the reading changes. |
| shell | `src/ui/shell.ts:24` | EXTEND | One frame for every screen, so a form does not invent its own header. |
| localToday | `src/domain/entry.ts:144` | REUSE | The date a meal is recorded against is the one the day log already computes locally. |

### Prefactoring
Existing oracle: `tests/acceptance/today-screen.spec.ts`

Move: Before the form exists, give the shell a header that can carry Cancel and Save, and split the day log's card rendering from its entry points, so the form work adds screens rather than rewriting the two that pass today.

Preserved observation: The Today screen still shows a card per logged meal, a 'Not logged yet' card per empty slot and the night insulin card, and ownership is still judged on data-entry elements.

### Agreement analysis
| Contract | Role | Locator | Decision | Reason |
|---|---|---|---|---|
| The meals and meal_foods tables and their row-level security | producer | `supabase/migrations/0001_owner_scoped_schema.sql:14` | UNCHANGED_COMPATIBLE | 0002 only narrows two text columns to their fixed lists; every row the seeds and the reading path already write satisfies them. |
| The log-store port read shape | consumer | `src/ports/log-store.ts:17` | UNCHANGED_COMPATIBLE | dayLog keeps its signature and its outcomes; writing is added beside it. |

### Boundaries
- Driving port: A person recording what they ate: choose the slot and time, add foods with type and amount, enter the glucose before, the dose, the context and a note, save, and come back later to add the after reading.
- Driven port: The log-store port for writing a meal with its foods, updating one, and re-reading the date.
- Driven port: The identity port, unchanged, for the session the write runs as.
- Dependency direction: The form is a pure function of a draft plus handlers; the draft rules live in src/domain and import nothing. The Supabase adapter depends on the port, never the form.
- Failure: Condition: Save is used with no food added. | Outcome: Refusal | Observation: The screen stays, shows 'Add at least one food.', and nothing is written.
- Failure: Condition: The meal row writes but its foods do not. | Outcome: Refusal | Observation: The meal row is removed again, the screen shows 'Could not save the meal. Nothing was recorded.', and Today is unchanged.
- Failure: Condition: The server cannot be reached while saving. | Outcome: Retry | Observation: The screen keeps every value the person entered, shows 'Cannot reach the server. Try again.', and the Save control becomes usable again.
- Failure: Condition: The save is sent and the response is lost, so the browser cannot tell whether Postgres committed it. | Outcome: Indeterminate | Observation: The screen shows 'Could not confirm the save. Check Today before saving again.' and does not retry by itself, because a duplicated meal would corrupt every comparison this product exists for.

### Acceptance supports
- `tests/support/local-stack.ts`
- `tests/support/accounts.ts`

### Public oracle
Observation: The user records a meal with slot, time, one or more foods (name, type from the fixed list, amount, unit), glucose before, rapid-acting units, exercise context, note and optionally glucose after; it appears on Today and can be edited later to add the after reading.

Stimulus: Account A owns nothing. On the built bundle at a 360 px viewport it signs in, uses the Dinner slot's 'Not logged yet' card, and records: time 19:10, glucose before 150, food 'Chicken rice' of type Mixed dish, amount 250 g, a second food 'Cucumber salad' of type Vegetable, amount 80 g, dose 6 units, exercise context 'Before meal', note 'walked home', and no after reading. It saves. It then uses that card's Edit control, enters glucose after 182 and saves again. Separately, on a fresh New meal with no food added, it uses Save.

Expected: After the first save Today shows a Dinner card with 19:10, 'Chicken rice 250 g · Cucumber salad 80 g', '6 u' and '150' with no change shown, because there is no after reading yet. After the edit the same single Dinner card shows '150', '182' and '+32' in the rose change band, because the brief puts stable at −39 to +30 and +32 is above it, and there is still exactly one dinner on the date. Saving a meal with no food is refused in place with 'Add at least one food.' and Today gains no card. The page never scrolls horizontally.

Falsifier: A recorded value is missing from the card or wrong, or a change is drawn before an after reading exists, or the edit creates a second dinner rather than updating the first, or a meal with no food is written, or the note, the exercise context or the food types are not what was entered when the meal is reopened, or the document scrolls horizontally at a 360 px viewport.

### Oracle and verification
Oracle target locator: `tests/acceptance/record-a-meal.spec.ts`

Verification command: `npm run build`
Verification command: `npm run test:acceptance -- tests/acceptance/record-a-meal.spec.ts`
Verification command: `npm run test:acceptance`
## Meal & Insulin Log product brief, value 4: recording night insulin

### Purpose
Let the person record the night's long-acting dose, its time and the bedtime glucose, and show the last five nights as dose and next-morning reading so the effect of a basal change is visible.

### Constraints
- The front end is a static bundle only; the browser writes through the Supabase JS client and there is no server process.
- Row-level security stays the only thing that scopes a read or a write.
- The layout is fluid with no horizontal scrolling at any viewport width from 360 px upward.
- Glucose is whole numbers in mg/dL.
- Night insulin is a separate daily record, not a meal.
- The app never recommends a dose. The five-night list reports what happened and draws no conclusion from it.

### Targets
| Path | Decision | Reason |
|---|---|---|
| `src/domain/night.ts` | CREATE_NEW | The night draft, the five-night projection and the next-morning derivation, as pure functions testable without a browser. |
| `src/ports/log-store.ts` | EXTEND | Add saving a night record and reading the recent nights with their following mornings. |
| `src/adapters/supabase/log-store.ts` | EXTEND | Write the night row and read the nights and the meals whose earliest reading supplies each morning. |
| `src/ui/night-form.ts` | CREATE_NEW | The Night insulin screen: the dose, the time, the bedtime glucose and the last five nights. |
| `src/ui/day-log.ts` | EXTEND | The night insulin card becomes the way into that screen. |
| `src/ui/theme.css` | EXTEND | The night screen's dark surface and the level band tokens, in both palettes. |
| `src/main.ts` | EXTEND | Route to the night screen and re-read the day after a save. |
| `tests/acceptance/night-insulin.spec.ts` | CREATE_NEW | The public oracle for this value. |

### Paradigm
functional

### Decisions
- The night screen is reached from the night insulin card on Today, and records against the date the Today screen is reading. The schema already holds one night record per account per date, so saving a second time updates that night rather than adding another.
- The next-morning reading is DERIVED, not recorded: it is the glucose before the earliest meal recorded on the following calendar date. The brief's list of what the person records for a night is the dose, the time and the bedtime glucose, and nothing else, so asking for a separate morning value would be work the brief does not ask for. A night whose following date has no meal with a before reading shows an em dash and carries no band.
- The five-night list shows the five most recent nights strictly before the date being recorded, newest first. Each row is the short date as 'Mon 21', the dose as '18 u', and the next-morning reading as a whole number.
- The next-morning reading is coloured by LEVEL, not by change, because the question a basal dose answers is whether you woke up in range. This is the first use of the level bands src/domain/band.ts already holds, and they are published as data-level-band exactly as the change bands are published as data-change-band.
- The canvas paints a morning reading of 76 in a warning colour. The brief's level bands put 70 to 180 in range, so 76 is in-range here. The brief's rule wins over the mock-up's shade, and that is deliberate rather than an oversight.
- The dose, the time and the bedtime glucose are real labelled inputs, as value 3 settled for every numeric field. Value 5 adds the minus and plus stepper and the in-app number pad as controls that write into these same inputs, so a field keeps one accessible name and one value for the whole delivery.
- The dose is required; the time and the bedtime glucose are optional, because a person who took their basal and did not measure must still be able to record the dose.
- Saving returns to Today for the same date and the day is re-read, so the night card shows what the store holds.
- The three fields are labelled 'Dose', 'Taken at' and 'Bedtime glucose'. 'Taken at' rather than the canvas's 'Time' on purpose: 'Time' is a substring of 'Bedtime glucose', so a label match on it resolves to two fields and no implementation can satisfy it. Labels on one screen must not contain one another.

### Reuse analysis
| Symbol | Locator | Decision | Reason |
|---|---|---|---|
| LogStore | `src/ports/log-store.ts:34` | EXTEND | One boundary for every read and write; a second port would let a screen reach the database two ways. |
| NightInsulin | `src/domain/entry.ts:26` | REUSE | The night row the day log already reads is the row this screen writes. |
| nightInsulinLine | `src/domain/entry.ts:105` | REUSE | '18 u at 22:30' is already the night card's dose line and does not change. |
| levelBand | `src/domain/band.ts:1` | REUSE | The level bands were written for History in value 9; the morning reading is the first thing to need them and must not get a second copy of the rule. |
| dayLogSection | `src/ui/day-log.ts:59` | EXTEND | The night card it already draws becomes the entry point; the reading does not change. |

### Prefactoring
Not applicable: The seams this value needs already exist: the log-store port takes writes since value 3, the shell carries a Cancel and Save header, and the band rules are already factored out. There is nothing to move first.

### Agreement analysis
| Contract | Role | Locator | Decision | Reason |
|---|---|---|---|---|
| The night_insulin table, its unique night per account and its row-level security | producer | `supabase/migrations/0001_owner_scoped_schema.sql:59` | UNCHANGED_COMPATIBLE | The table already holds every column this value writes, including the one-night-per-date uniqueness the update relies on. No migration. |
| The log-store port | consumer | `src/ports/log-store.ts:34` | UNCHANGED_COMPATIBLE | dayLog and saveMeal keep their signatures; the night operations are added beside them. |

### Boundaries
- Driving port: A person recording the night dose: open the night card, set the units, the time and the bedtime reading, save, and read the last five nights to see what each dose was followed by.
- Driven port: The log-store port for writing the night record and reading the recent nights with their following mornings.
- Driven port: The identity port, unchanged, for the session the write runs as.
- Dependency direction: The night screen is a pure function of a draft and a five-night projection; the projection and the derivation live in src/domain and import nothing.
- Failure: Condition: Save is used with no dose entered. | Outcome: Refusal | Observation: The screen stays, shows 'Enter the dose.', and nothing is written.
- Failure: Condition: The server cannot be reached while saving. | Outcome: Retry | Observation: The screen keeps every value entered, shows 'Cannot reach the server. Try again.', and the Save control becomes usable again.
- Failure: Condition: The five-night read fails. | Outcome: Retry | Observation: The list shows 'Cannot reach the server. Try again.' with a usable retry control, and shows no nights rather than stale ones. The dose the person is entering is untouched.
- Failure: Condition: A night has no meal with a before reading on the following date. | Outcome: Indeterminate | Observation: The row shows the dose and an em dash for the morning, and carries no level band, because no reading was taken and a missing measurement must not be drawn as a value.

### Acceptance supports
- `tests/support/local-stack.ts`
- `tests/support/accounts.ts`

### Public oracle
Observation: The user records night insulin (long-acting units, time, bedtime glucose); the screen lists the last five nights as dose and next-morning reading.

Stimulus: Account A owns five night records, dated one to five days before today in local terms, with doses 18, 18, 16, 16 and 20 units in that order from most recent. It also owns one meal on each of the four days before today, whose earliest before reading is 106 on yesterday, 190 two days ago, 64 three days ago and 260 four days ago. Today has no night record and no meal. A browser at a 360 px viewport signs in as account A, opens the night insulin card from Today, and records 18 units in 'Dose', 22:30 in 'Taken at' and 128 in 'Bedtime glucose', then saves.

Expected: The night screen lists exactly five rows, newest first. The first is yesterday's night, '18 u', and an em dash for the morning with no level band, because today has no reading. The second is '18 u' with '106' in the in-range level band. The third is '16 u' with '190' in the high band. The fourth is '16 u' with '64' in the low band. The fifth is '20 u' with '260' in the very-high band. After saving, Today's night insulin card shows '18 u at 22:30'. Saving again with the dose cleared is refused with 'Enter the dose.' and the stored night is unchanged. The page never scrolls horizontally.

Falsifier: The list is not five rows or not newest first, or a dose or morning reading is wrong or attached to the wrong night, or a morning reading carries the wrong level band, or a night with no following reading shows a number or a band instead of an em dash, or saving does not update Today's night card, or a second night row is created for the same date, or the document scrolls horizontally at a 360 px viewport.

### Oracle and verification
Oracle target locator: `tests/acceptance/night-insulin.spec.ts`

Verification command: `npm run build`
Verification command: `npm run test:acceptance -- tests/acceptance/night-insulin.spec.ts`
Verification command: `npm run test:acceptance`
## Meal & Insulin Log product brief, value 5: the in-app number pad and the dose stepper

### Purpose
Make glucose and dose entry a one-thumb job: tapping a glucose field opens an in-app number pad carrying chips for the readings the person is most likely to want, and a dose moves by exactly one unit with a minus and a plus button.

### Constraints
- The front end is a static bundle only; there is no server process.
- Row-level security stays the only thing that scopes a read.
- The layout is fluid with no horizontal scrolling at any viewport width from 360 px upward.
- Glucose is whole numbers in mg/dL.
- The app never recommends a dose. A chip repeats a reading the person already took; the stepper only moves a number the person is choosing.

### Targets
| Path | Decision | Reason |
|---|---|---|
| `src/domain/recent-readings.ts` | CREATE_NEW | Which readings become chips, as pure functions over what the account already recorded. |
| `src/domain/number-entry.ts` | CREATE_NEW | The digit, delete and clear rules and the one-unit step, as pure functions, so the keying behaviour is testable without a DOM. |
| `src/ports/log-store.ts` | EXTEND | Add reading the values the chips need: the most recent glucose reading, and the before reading of the most recent meal in a slot. |
| `src/adapters/supabase/log-store.ts` | EXTEND | Read those two values through PostgREST, still with no user_id of its own. |
| `src/ui/number-pad.ts` | CREATE_NEW | The pad itself: the chips, the digits, Clear, Delete and Done. |
| `src/ui/stepper.ts` | CREATE_NEW | The minus and plus control a dose field carries. |
| `src/ui/meal-form.ts` | EXTEND | Its two glucose fields open the pad and its dose field gains the stepper. |
| `src/ui/night-form.ts` | EXTEND | Its bedtime glucose opens the pad and its dose gains the stepper. |
| `src/ui/theme.css` | EXTEND | Pad, chip, key and stepper tokens in both palettes. |
| `src/main.ts` | EXTEND | Supply the chip readings to the forms that open the pad. |
| `tests/acceptance/number-pad.spec.ts` | CREATE_NEW | The public oracle for this value. |

### Paradigm
functional

### Decisions
- The pad writes into the very input value 3 declared. That input is NEVER made readonly and never loses its label, because value 3's oracle fills it directly and a readonly field would fail that oracle while looking like a product improvement.
- A glucose input carries inputmode='none' so a phone shows no system keyboard and the in-app pad has the screen to itself. It stays an ordinary focusable text input, so a hardware keyboard and an automated fill both still work. This is how the pad replaces the system keyboard without replacing the field.
- Tapping or focusing a glucose field opens the pad. The pad is one group with the accessible name 'Number pad', holding the digits 0 to 9, a 'Clear' control, a 'Delete' control and a 'Done' control. Done closes the pad and leaves the value in the field.
- A digit appends to the right. Delete removes the rightmost digit. Clear empties the field. The pad accepts at most three digits, because a mg/dL reading above 999 is not a reading; the schema's wider bound stays as a guard rather than as an invitation.
- Two chips, when there is something to put in them. 'Last reading 133 · 12:55' is the most recent glucose value the account recorded, with the time of the entry it came from; a meal's after reading counts as later than its before reading, since both hang off the meal's own time. 'Before last dinner 110' is the before reading of the most recent meal in the slot being recorded. A chip with no reading behind it is not rendered at all rather than rendered empty.
- Tapping a chip puts its number in the field, replacing whatever was there. It does not close the pad, so a mistaken tap is one Clear away.
- A dose field carries a minus and a plus button, named 'Decrease dose' and 'Increase dose', each moving the dose by exactly one unit. The dose never goes below zero: minus at zero does nothing. The dose input stays typeable, so a dose of 12 does not need twelve taps.
- The night screen's dose and bedtime glucose get the same two controls, because a person keying a number at 22:30 wants the same thumb-sized target as at noon.
- The food amount field keeps the system keyboard. The brief asks for the pad on glucose fields and the stepper on doses, and an amount in grams is not either of those.

### Reuse analysis
| Symbol | Locator | Decision | Reason |
|---|---|---|---|
| LogStore | `src/ports/log-store.ts:34` | EXTEND | The chips are reads, and every read goes through the one boundary. |
| clockTime | `src/domain/entry.ts:50` | REUSE | The chip's time is the same local HH:MM the cards show. |
| slotLabel | `src/domain/entry.ts:47` | REUSE | 'Before last dinner' names the slot the way every other screen names it. |
| mealForm | `src/ui/meal-form.ts:1` | EXTEND | The fields already exist and keep their labels; only their input method changes. |
| nightForm | `src/ui/night-form.ts:1` | EXTEND | Same two controls on the same kinds of field, rather than a second spelling of them. |

### Prefactoring
Existing oracle: `tests/acceptance/record-a-meal.spec.ts`

Move: Before the pad exists, lift each numeric field in the meal and night forms into one field helper that owns its label, its input and its trailing controls, so the pad and the stepper attach in one place rather than at five call sites.

Preserved observation: A meal is still recorded from an empty slot with its foods, dose, readings, context and note, still shows on Today, and still reopens to take the after reading. Its fields keep their labels and stay fillable.

### Agreement analysis
| Contract | Role | Locator | Decision | Reason |
|---|---|---|---|---|
| The labelled numeric fields of the meal and night forms | producer | `src/ui/meal-form.ts:1` | UNCHANGED_COMPATIBLE | Labels, accessible names and values are unchanged. The fields gain a companion control and lose the system keyboard, which no existing oracle depends on. |
| The record-a-meal and night-insulin oracles as consumers of those fields | consumer | `tests/acceptance/record-a-meal.spec.ts:165` | UNCHANGED_COMPATIBLE | They fill fields by label and read values back; inputmode is not something they assert and readonly is forbidden by decision. |

### Boundaries
- Driving port: A person keying a number with one thumb: tap a glucose field, take a chip or key the digits, correct a slip, finish; step a dose up or down one unit at a time.
- Driven port: The log-store port for the two chip readings.
- Driven port: The identity port, unchanged, for the session the read runs as.
- Dependency direction: The keying rules and the chip projections are pure functions in src/domain with no DOM and no SDK. The pad and the stepper are pure functions of state plus handlers.
- Failure: Condition: A fourth digit is keyed. | Outcome: Refusal | Observation: The field keeps its three digits and the extra key does nothing, because a reading above 999 is not a reading.
- Failure: Condition: Delete is used on an empty field. | Outcome: Refusal | Observation: The field stays empty and nothing else changes.
- Failure: Condition: Decrease is used on a dose of zero. | Outcome: Refusal | Observation: The dose stays at zero, because a negative dose is not a thing that can be taken.
- Failure: Condition: The chip readings cannot be read because the server is unreachable. | Outcome: Retry | Observation: The pad opens with its digits working and no chips at all, because keying the number by hand must never be blocked by a convenience that failed to load.

### Acceptance supports
- `tests/support/local-stack.ts`
- `tests/support/accounts.ts`

### Public oracle
Observation: Tapping a glucose field opens an in-app number pad with chips for the last reading; dose fields change by one unit with minus and plus buttons.

Stimulus: Account A owns a lunch today at 12:55 with before 112 and after 133, and a dinner yesterday at 19:10 with before 110. A browser at a 360 px viewport signs in, opens New meal from the Dinner slot's 'Not logged yet' card, and taps the glucose before field. It then keys 1, 5 and 0, keys a fourth digit 7, uses Delete, uses Clear, taps the 'Before last dinner 110' chip, and uses Done. It then uses Increase dose three times and Decrease dose once, and on a separate attempt uses Decrease dose on a dose of zero.

Expected: Tapping the field reveals a group named 'Number pad' carrying a chip reading 'Last reading 133 · 12:55' and a chip reading 'Before last dinner 110'. Keying 1, 5, 0 puts 150 in the field. The fourth digit leaves it at 150. Delete leaves 15. Clear leaves it empty. The chip puts 110 in the field and the pad stays open. Done closes the pad and the field still holds 110. Three Increase presses make the dose 3 and one Decrease makes it 2. Decrease on a dose of zero leaves it at zero. The page never scrolls horizontally.

Falsifier: The pad does not appear on tapping the field, or either chip is absent or carries the wrong number or time, or a digit does not append, or a fourth digit is accepted, or Delete does not remove exactly the rightmost digit, or Clear does not empty the field, or a chip does not fill the field or closes the pad, or Done does not close the pad or loses the value, or a step moves the dose by anything other than one, or the dose goes below zero, or the document scrolls horizontally at a 360 px viewport.

### Oracle and verification
Oracle target locator: `tests/acceptance/number-pad.spec.ts`

Verification command: `npm run build`
Verification command: `npm run test:acceptance -- tests/acceptance/number-pad.spec.ts`
Verification command: `npm run test:acceptance`
