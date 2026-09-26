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
- The meal form's fields are labelled exactly 'Slot', 'Time', 'Glucose before', 'Rapid-acting units', 'Exercise', 'Note' and 'Glucose after'. The Add food screen's are 'Food name', 'Type', 'Amount' and 'Unit' -- 'Food name' and not 'Food', so it cannot be confused with the 'Foods' heading of the list it adds to.
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
- Opening the pad must NOT replace, reset or detach the glucose input. The pad seeds itself from the field's current value and writes back into that same node, so a value already in the field survives being focused. This is not a test convenience: focusing a field is how a hardware-keyboard user starts typing, and a re-render that discards the node eats their first keystrokes exactly as it breaks value 3's oracle.

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
- Failure: Condition: A glucose field already holds a value and is then focused, opening the pad. | Outcome: Refusal | Observation: The field keeps its value and the pad opens showing that value as its current entry. Nothing is cleared, because the person focused a field rather than asking to start again.

### Acceptance supports
- `tests/support/local-stack.ts`
- `tests/support/accounts.ts`

### Public oracle
Observation: Tapping a glucose field opens an in-app number pad with chips for the last reading; dose fields change by one unit with minus and plus buttons.

Stimulus: Account A owns a lunch today at 12:55 with before 112 and after 133, and a dinner yesterday at 19:10 with before 110. A browser at a 360 px viewport signs in, opens New meal from the Dinner slot's 'Not logged yet' card, and taps the glucose before field. It then keys 1, 5 and 0, keys a fourth digit 7, uses Delete, uses Clear, taps the 'Before last dinner 110' chip, and uses Done. It then uses Increase dose three times and Decrease dose once, and on a separate attempt uses Decrease dose on a dose of zero. Separately it fills the glucose after field directly, without the pad, and then focuses it.

Expected: Tapping the field reveals a group named 'Number pad' carrying a chip reading 'Last reading 133 · 12:55' and a chip reading 'Before last dinner 110'. Keying 1, 5, 0 puts 150 in the field. The fourth digit leaves it at 150. Delete leaves 15. Clear leaves it empty. The chip puts 110 in the field and the pad stays open. Done closes the pad and the field still holds 110. Three Increase presses make the dose 3 and one Decrease makes it 2. Decrease on a dose of zero leaves it at zero. The page never scrolls horizontally. A value put into a glucose field directly survives focusing it: the field still holds it and the pad opens showing it, so the field remains an ordinary input that the pad assists rather than replaces.

Falsifier: The pad does not appear on tapping the field, or either chip is absent or carries the wrong number or time, or a digit does not append, or a fourth digit is accepted, or Delete does not remove exactly the rightmost digit, or Clear does not empty the field, or a chip does not fill the field or closes the pad, or Done does not close the pad or loses the value, or a step moves the dose by anything other than one, or the dose goes below zero, or the document scrolls horizontally at a 360 px viewport. It also fails if focusing a glucose field that already holds a value clears or discards that value.

### Oracle and verification
Oracle target locator: `tests/acceptance/number-pad.spec.ts`

Verification command: `npm run build`
Verification command: `npm run test:acceptance -- tests/acceptance/number-pad.spec.ts`
Verification command: `npm run test:acceptance`
## Meal & Insulin Log product brief, value 6: the meal detail and every instance of the same foods

### Purpose
Open one meal and see what was eaten, the dose, the two readings with the change and the note, and below that every time the same foods were eaten, newest first, with the one being viewed marked -- which is how the person answers 'what happened last time I ate this?'.

### Constraints
- The front end is a static bundle only; there is no server process.
- Row-level security stays the only thing that scopes a read; an instance list may never reach another account's meals.
- The layout is fluid with no horizontal scrolling at any viewport width from 360 px upward.
- Glucose is whole numbers in mg/dL.
- Same meal means the same set of foods with the same amounts and units; slot, time, readings, dose and context are per instance.
- The app never recommends a dose. The instance list reports what each dose was followed by and draws no conclusion.

### Targets
| Path | Decision | Reason |
|---|---|---|
| `src/domain/meal-identity.ts` | CREATE_NEW | The 'same foods' key and the instance list projection, as pure functions, because this is the rule the product's whole premise rests on. |
| `src/ports/log-store.ts` | EXTEND | Add reading one meal by id and reading every instance that shares its foods. |
| `src/adapters/supabase/log-store.ts` | EXTEND | Read the meal and the account's meals with their foods, so the domain can group them by identity. |
| `src/ui/meal-detail.ts` | CREATE_NEW | The detail screen: the summary, what was eaten, the note and the instance list. |
| `src/ui/day-log.ts` | EXTEND | A meal card's body becomes the way into its detail, while its Edit control stays where value 3 put it. |
| `src/ui/theme.css` | EXTEND | Detail summary, instance row and viewing-mark tokens in both palettes. |
| `src/main.ts` | EXTEND | Route to the detail for a meal id and back, and from the detail into Edit. |
| `tests/acceptance/meal-detail.spec.ts` | CREATE_NEW | The public oracle for this value. |

### Paradigm
functional

### Decisions
- Two meals are the same meal when their foods form the same multiset of name, amount and unit. The name is compared trimmed and case-insensitively, so 'oats' and 'Oats' are one food; the amount and the unit must match exactly. Order does not matter. The food TYPE is not part of identity, because the brief defines sameness by foods, amounts and units only, and a type is a classification of a food rather than a property of the meal.
- The identity key is computed in the domain, not in SQL, because it is a multiset over related rows and a person's whole history here is one or two people's meals. If that ever stops being cheap the key becomes a stored column, and the rule stays in one place either way.
- The instance list is EVERY instance of those foods, the viewed one included, newest first by date then by clock time. Including it is what makes marking it meaningful, and the brief asks for the viewed instance to be marked.
- The viewed instance carries a visible 'viewing' mark and is the only row that does. The mark is text, not only a border, so it is readable without colour.
- An instance row reads as the date and slot, the dose, the two readings and the change with its change band: 'Thu 10 Sep · Dinner', '6 u', '110', '142', '+32'. A row whose meal has no after reading shows the before alone with no change, exactly as a Today card does.
- The heading counts the instances: 'Every time you ate this · 4'.
- The summary shows the before, the change and the after, the dose, and nothing else numeric. There is no 'after 2 h' claim: the schema records no interval between the two readings, so naming one would be an invention.
- The note section appears only when the meal has a note. An empty section would say something false about a meal nobody annotated.
- A meal card on Today gains a link in its body, named for the meal, that opens the detail. The card stays a list item carrying exactly the data-entry elements value 2 established, and the Edit control stays on the card where value 3 put it, so neither earlier oracle changes meaning.
- 'Log again with these foods' is value 7 and is not built here. The detail screen leaves room for it and nothing more.

### Reuse analysis
| Symbol | Locator | Decision | Reason |
|---|---|---|---|
| LogStore | `src/ports/log-store.ts:34` | EXTEND | Every read goes through the one boundary. |
| changeBand | `src/domain/band.ts:1` | REUSE | An instance row's change is banded by the same rule as a Today card and a History cell. |
| foodText | `src/domain/entry.ts:57` | REUSE | 'Chicken rice 250 g' is already how a food with its amount reads. |
| doseText | `src/domain/entry.ts:64` | REUSE | '6 u' is already how a dose reads. |
| slotLabel | `src/domain/entry.ts:47` | REUSE | An instance row names its slot the way every screen does. |
| dayLogSection | `src/ui/day-log.ts:59` | EXTEND | The card gains a link; its structure and its marked data stay as two oracles already read them. |

### Prefactoring
Existing oracle: `tests/acceptance/today-screen.spec.ts`

Move: Before the detail exists, lift the meal card's reading of dose, readings and change into one shared projection, so the Today card, the instance row and the detail summary all read one rule rather than three copies of it.

Preserved observation: The Today screen still shows a card per logged meal with its time, foods, dose and readings, a 'Not logged yet' card per empty slot and the night insulin card, and ownership is still judged on data-entry elements.

### Agreement analysis
| Contract | Role | Locator | Decision | Reason |
|---|---|---|---|---|
| The meal card's structure and its data-entry marking | producer | `src/ui/day-log.ts:59` | UNCHANGED_COMPATIBLE | The card stays a list item with the same marked values and the same Edit control; a link is added inside it. |
| The today-screen and record-a-meal oracles as consumers of that card | consumer | `tests/acceptance/today-screen.spec.ts:262` | UNCHANGED_COMPATIBLE | They read the card's text and its band attributes, neither of which moves. |

### Boundaries
- Driving port: A person opening a meal: see what was eaten with amounts and types, the dose, the two readings with the change and the note, and every other time the same foods were eaten with what each dose was followed by.
- Driven port: The log-store port for the meal and for the account's meals with their foods.
- Driven port: The identity port, unchanged, for the session the read runs as.
- Dependency direction: The identity rule and the instance projection are pure functions in src/domain over meals already read. The screen is a pure function of that projection.
- Failure: Condition: The meal id in the route names no meal the account owns. | Outcome: Refusal | Observation: The screen shows 'That meal is not here.' with a way back to Today, and never a blank detail, because an id that row-level security hides must read as absent rather than as broken.
- Failure: Condition: The instance read fails because the server is unreachable. | Outcome: Retry | Observation: The summary, foods and note still show, and the instance section alone shows 'Cannot reach the server. Try again.' with a usable retry control, because the meal in hand is worth reading even when its history cannot be fetched.
- Failure: Condition: The meal is the only instance of its foods. | Outcome: Indeterminate | Observation: The heading reads 'Every time you ate this · 1' and the single row is the viewed one, marked. No comparison is offered, because there is nothing yet to compare against and an empty list would read as a missing history rather than a first time.

### Acceptance supports
- `tests/support/local-stack.ts`
- `tests/support/accounts.ts`

### Public oracle
Observation: Opening a meal shows its foods with amounts, dose, before → after with the change, note, and below that every earlier instance with the same foods, newest first, each as dose, before → after and change; the instance being viewed is marked.

Stimulus: Account A owns four dinners whose foods are Chicken rice of type Mixed dish 250 g and Cucumber salad of type Vegetable 80 g: today at 19:05 with 6 units, 110 to 142 and the note 'Ate slowly, 20 min walk afterwards.'; seven days ago with 8 units, 145 to 121; thirty days ago with 5 units, 122 to 178; thirty-six days ago with 7 units, 168 to 120. It also owns a dinner of Soup of type Mixed dish 300 ml with 4 units, 150 to 110, and a dinner whose foods are the same two names with Cucumber salad at 90 g instead of 80 g. A browser at a 360 px viewport signs in and opens today's Dinner card body from Today.

Expected: The detail names the slot Dinner with today's date and 19:05. The summary shows '110', '142', '+32' in the rose change band and '6 u'. What was eaten lists 'Chicken rice' with 'Mixed dish' and '250 g', and 'Cucumber salad' with 'Vegetable' and '80 g'. The note reads 'Ate slowly, 20 min walk afterwards.'. The instance heading reads 'Every time you ate this · 4' and exactly four rows follow, newest first: '6 u' 110 to 142 '+32' in rose and marked 'viewing'; '8 u' 145 to 121 '−24' in stable; '5 u' 122 to 178 '+56' in rose; '7 u' 168 to 120 '−48' in dropped. Only the first row is marked. Neither the Soup dinner nor the 90 g dinner appears. The page never scrolls horizontally.

Falsifier: A food, amount, type, dose, reading, change or band is missing or wrong, or the note is absent, or the instance count is not 4, or the rows are not newest first, or more or fewer than one row is marked, or the marked row is not the one being viewed, or the Soup dinner appears, or the dinner differing only by an amount appears, or a change is drawn for a meal with no after reading, or the document scrolls horizontally at a 360 px viewport.

### Oracle and verification
Oracle target locator: `tests/acceptance/meal-detail.spec.ts`

Verification command: `npm run build`
Verification command: `npm run test:acceptance -- tests/acceptance/meal-detail.spec.ts`
Verification command: `npm run test:acceptance`
## Meal & Insulin Log product brief, value 7: logging the same foods again

### Purpose
From a meal, start a fresh entry with only its foods and amounts copied, so the same composition can be compared across days without retyping it, and saving leaves the original exactly as it was.

### Constraints
- The front end is a static bundle only; there is no server process.
- Row-level security stays the only thing that scopes a read or a write.
- The layout is fluid with no horizontal scrolling at any viewport width from 360 px upward.
- Glucose is whole numbers in mg/dL.
- The app never recommends a dose.

### Targets
| Path | Decision | Reason |
|---|---|---|
| `src/domain/meal-draft.ts` | EXTEND | A draft seeded from an existing meal: its foods and amounts copied, everything else fresh. |
| `src/ui/meal-detail.ts` | EXTEND | The 'Log again with these foods' control and the sentence saying what it does. |
| `src/ui/meal-form.ts` | EXTEND | The subtitle naming the meal the foods came from, so a person cannot lose track of what they are repeating. |
| `src/ui/theme.css` | EXTEND | The copied-food row and the subtitle, in both palettes. |
| `src/main.ts` | EXTEND | Route from a meal into a fresh entry seeded from it, and back to Today after the save. |
| `tests/acceptance/log-again.spec.ts` | CREATE_NEW | The public oracle for this value. |
| `src/ports/log-store.ts` | EXTEND | Add the by-id meal read value 6 declared and was never built, so a detail does not depend on which day is loaded. |
| `src/adapters/supabase/log-store.ts` | EXTEND | Read one meal with its foods by id, still with no user_id of its own. |

### Paradigm
functional

### Decisions
- 'Log again with these foods' copies the foods only: each food's name, its type and its amount with its unit. The type travels with the food because a food row cannot exist without one and the type is a property of that food rather than of the occasion.
- The DOSE STARTS EMPTY. The canvas pre-fills it with the dose taken last time, and this design deliberately does not. A dose offered as a starting value is a dose recommended, however it is labelled, and the brief says outright that the app never recommends one. Value 8 will show what happened last time at a dose the person has chosen, which reports rather than proposes.
- The glucose readings, the note and the after reading also start empty, and the exercise context starts at None. The time starts at the current local clock time.
- The slot starts at the source meal's slot. A slot is not a reading, a dose, a time or a context, and repeating a dinner almost always means another dinner; the person can still change it, and value 8 depends on the slot being a deliberate choice.
- A repeat is recorded against TODAY's local date, whichever date the person browsed to find the source meal. Repeating a meal is something done when eating it again, so the entry belongs to the day it is made on. Saving returns to Today for today.
- Saving creates a new meal and touches nothing on the source. The source keeps its own readings, dose, context and note, and the repeat is a separate row, because the entire premise of the product is comparing two instances of the same composition.
- The form names its source: 'same foods as Thu 10 Sep · Dinner' under the heading. A copied food's amount is editable, and changing it makes the entry a different meal by the identity rule of value 6, which is correct and needs no warning.
- Value 8's expected-after estimate is not built here. This value copies foods and records a separate entry; the estimate is the next value.
- A meal detail is opened by reading that meal BY ITS ID through the port, never by looking it up in whatever day log happens to be loaded. Value 6 declared that read and it was not built; the detail was assembled from the day-log snapshot instead, so opening a meal could silently do nothing when the snapshot did not hold it. Measured: after saving a repeat and stepping back to the source's day, tapping the card left the person on the day log with no explanation.
- Opening a meal must never silently do nothing. Every path either shows the detail or says why not: a meal the account cannot read shows 'That meal is not here.' with a way back. A guard that returns quietly is a dead control, which is worse than an error because the person cannot tell it from a missed tap.

### Reuse analysis
| Symbol | Locator | Decision | Reason |
|---|---|---|---|
| mealDraft | `src/domain/meal-draft.ts:1` | EXTEND | A seeded draft is the same draft with its foods already in it, not a second kind of draft. |
| mealForm | `src/ui/meal-form.ts:1` | EXTEND | One recording screen. A separate 'repeat' screen would drift from the one that records everything else. |
| saveMeal | `src/ports/log-store.ts:41` | REUSE | A repeat is an ordinary new meal; the write path does not change. |
| sameFoodsKey | `src/domain/meal-identity.ts:1` | REUSE | The instance list must recognise the repeat as the same meal, which is exactly value 6's rule and must not be restated. |
| localToday | `src/domain/entry.ts:144` | REUSE | The date a repeat lands on is the local today the rest of the app already computes. |

### Prefactoring
Not applicable: The seams are already in place: the meal form takes a draft, the draft has a shape, the write path takes a recording, and the identity rule is factored out. This value seeds a draft and adds one control.

### Agreement analysis
| Contract | Role | Locator | Decision | Reason |
|---|---|---|---|---|
| The meal form and its labelled fields | producer | `src/ui/meal-form.ts:1` | UNCHANGED_COMPATIBLE | The same screen with the same labels gains a subtitle and arrives with foods already in the draft. No field changes name or behaviour. |
| The meal identity rule as the consumer that must pair the repeat with its source | consumer | `src/domain/meal-identity.ts:1` | UNCHANGED_COMPATIBLE | Copying name, amount and unit exactly is what makes the repeat the same meal under the existing rule; nothing about the rule moves. |

### Boundaries
- Driving port: A person eating something they have eaten before: open that meal, start a fresh entry from its foods, enter today's reading, dose and context, and save it as its own record.
- Driven port: The log-store port for reading the source meal and writing the new one.
- Driven port: The identity port, unchanged, for the session the write runs as.
- Dependency direction: Seeding a draft from a meal is a pure function in src/domain. The screen is unchanged in kind: a pure function of a draft plus handlers.
- Failure: Condition: The save fails after the foods were copied. | Outcome: Retry | Observation: The screen keeps every copied food and every value entered, shows 'Cannot reach the server. Try again.', and the source meal is untouched.
- Failure: Condition: Every copied food is removed before saving. | Outcome: Refusal | Observation: Saving is refused with 'Add at least one food.', exactly as a meal recorded from scratch is, because an entry with no foods cannot be compared with anything.
- Failure: Condition: The source meal has been deleted or hidden by row-level security between opening it and repeating it. | Outcome: Refusal | Observation: The screen shows 'That meal is not here.' and offers a way back to Today rather than a form seeded from nothing.
- Failure: Condition: A meal detail is opened while the day log for another date is still being read. | Outcome: Retry | Observation: The detail opens anyway, because it is read by id and does not depend on the day log. If its own read fails it shows 'Cannot reach the server. Try again.' with a usable retry control.

### Acceptance supports
- `tests/support/local-stack.ts`
- `tests/support/accounts.ts`

### Public oracle
Observation: From a meal, 'Log again' opens a new entry with only the foods and amounts copied; time, readings, dose and context start empty or at today's values, and saving creates a separate record while the original is unchanged.

Stimulus: Account A owns one dinner dated yesterday in local terms at 19:05: Chicken rice of type Mixed dish 250 g and Cucumber salad of type Vegetable 80 g, glucose before 110, glucose after 142, 6 units, exercise context 'After meal' and the note 'Ate slowly'. A browser at a 360 px viewport signs in, steps back one day, opens that dinner's card body, and uses 'Log again with these foods'. It reads the form as it arrives, then enters glucose before 145 and 7 units and saves.

Expected: The form arrives titled for a new meal, naming its source as the same foods as yesterday's Dinner. It holds Chicken rice 'Mixed dish' 250 g and Cucumber salad 'Vegetable' 80 g. The slot is Dinner. Glucose before, the dose, the note and glucose after are all EMPTY, the exercise context is None, and the time is not 19:05. After saving, Today for TODAY shows a Dinner card with 'Chicken rice 250 g · Cucumber salad 80 g', '145' and '7 u' and no change. Stepping back one day still shows yesterday's Dinner with '110', '142', '+32' and '6 u', its note and context unchanged. Opening either meal lists 'Every time you ate this · 2'. The page never scrolls horizontally. Opening the source meal after the repeat was saved shows its detail, with its note and its own readings, from whichever date is being read.

Falsifier: A food, type, amount or unit is not copied, or anything besides the foods is carried over -- in particular a pre-filled dose, reading, note or the source's time -- or the exercise context does not start at None, or the new entry lands on yesterday instead of today, or the source meal's own values change in any way, or saving updates the source instead of creating a second record, or the two are not recognised as the same meal, or the document scrolls horizontally at a 360 px viewport. It also fails if tapping a meal card leaves the person on the day log with no detail and no message.

### Oracle and verification
Oracle target locator: `tests/acceptance/log-again.spec.ts`

Verification command: `npm run build`
Verification command: `npm run test:acceptance -- tests/acceptance/log-again.spec.ts`
Verification command: `npm run test:acceptance`
## Meal & Insulin Log product brief, value 8: the expected-after estimate

### Purpose
While an entry is being filled in, report what the same foods at the same slot and the same dose did last time, as an expected after reading, and say plainly why there is no estimate when there is nothing matching to report.

### Constraints
- The front end is a static bundle only; there is no server process.
- Row-level security stays the only thing that scopes a read; an estimate may never be based on another account's meal.
- The layout is fluid with no horizontal scrolling at any viewport width from 360 px upward.
- Glucose is whole numbers in mg/dL.
- Expected after = the before reading plus the change of the most recent entry with the same foods, the same meal slot and the same dose; if no such entry exists, no estimate is shown.
- The app never recommends a dose. The estimate reports what one recorded occasion did at a dose the person has already chosen, and never proposes a dose.

### Targets
| Path | Decision | Reason |
|---|---|---|
| `src/domain/expected-after.ts` | CREATE_NEW | The estimate and the reason there is none, as one pure function over the account's own meals, because this is the rule the brief states most precisely. |
| `src/ui/meal-form.ts` | EXTEND | The Expected after panel, live beside the before reading, the slot and the dose. |
| `src/ui/theme.css` | EXTEND | The estimate panel in both palettes, with the number taking its change band. |
| `src/main.ts` | EXTEND | Supply the form with the account's meal history and recompute the estimate as the draft changes. |
| `tests/acceptance/expected-after.spec.ts` | CREATE_NEW | The public oracle for this value. |

### Paradigm
functional

### Decisions
- The estimate is the before reading plus the change of ONE matching entry: the most recent entry with the same foods by value 6's identity rule, the same slot, and the same dose. Most recent means by date then clock time. The meal being edited is never its own basis.
- A matching entry must have BOTH readings. An entry with no after reading has no change, so it cannot be the basis and is skipped as though it did not match, because inventing a change of zero would report something that never happened.
- Doses are compared as numbers, so 6 and 6.00 are the same dose. A dose is part of the match, not a tolerance: 6 u and 7 u are different doses and the brief says so.
- Four reasons for no estimate, each said plainly rather than left blank. No before reading: 'Type your reading before eating to see an estimate.' A before reading but no dose: 'Enter the dose to see an estimate.' No entry at all with these foods in this slot: 'No dinner on record with these foods.' Entries in this slot with these foods but none at this dose: 'No dinner at 7 u. Most recent was 6 u (+32).', naming the most recent one at any dose so the person can see what is on record.
- The estimate names its source: the dose, the two readings, the signed change and the date of the entry it came from. An estimate that cannot be traced to one recorded occasion would read as a prediction the app had made up.
- The estimated number carries the change band of the change it is built from, published as data-change-band exactly as everywhere else, so the same arithmetic is never coloured two ways.
- The panel is live: changing the before reading, the slot or the dose recomputes it immediately, and changing slot or dose to one with no match replaces the number with the reason.
- The panel appears on ANY meal entry that has foods, not only on one reached through 'Log again'. The rule does not depend on how the foods got into the draft, and a person who typed the same foods by hand deserves the same report. The observation names the repeat flow, which the oracle exercises.
- The panel is labelled 'Expected after' and is never labelled as a suggestion, a target or a recommendation. It sits beside the after reading field and never fills it in: the person records what they measured, not what was expected.

### Reuse analysis
| Symbol | Locator | Decision | Reason |
|---|---|---|---|
| sameFoodsKey | `src/domain/meal-identity.ts:1` | REUSE | 'The same foods' here must mean exactly what it means on the detail screen, or two screens would disagree about which meals are the same. |
| changeBand | `src/domain/band.ts:1` | REUSE | The estimate's colour is the band of its own change, by the one rule. |
| mealHistory | `src/ports/log-store.ts:78` | REUSE | The account's meals with their foods are already read through this operation for the instance list; the estimate needs the same data and must not add a second read. |
| doseText | `src/domain/entry.ts:64` | REUSE | '6 u' reads the same in the reason text as everywhere else. |
| slotLabel | `src/domain/entry.ts:47` | REUSE | The reason text names the slot the way every screen names it. |
| mealForm | `src/ui/meal-form.ts:1` | EXTEND | One recording screen gains a panel; a separate screen for the estimate would divorce it from the fields it depends on. |

### Prefactoring
Existing oracle: `tests/acceptance/log-again.spec.ts`

Move: Before the panel exists, give the meal form one place where a draft change is observed, so the estimate recomputes from the draft rather than from three separate field handlers.

Preserved observation: Logging again still copies only the foods and amounts, still starts the readings, dose, note and context fresh, and still saves as a separate record leaving the source untouched.

### Agreement analysis
| Contract | Role | Locator | Decision | Reason |
|---|---|---|---|---|
| The meal form's fields and labels | producer | `src/ui/meal-form.ts:1` | UNCHANGED_COMPATIBLE | No field changes name, value or behaviour. A read-only panel is added; in particular the after reading field is never written to. |
| The meal identity rule | consumer | `src/domain/meal-identity.ts:1` | UNCHANGED_COMPATIBLE | The estimate consumes the same key the detail screen produces, unchanged. |

### Boundaries
- Driving port: A person about to eat something they have eaten before: enter the reading and the dose they are taking, and see what the same foods at the same slot and the same dose did last time.
- Driven port: The log-store port's meal history, already used by the instance list.
- Driven port: The identity port, unchanged, for the session the read runs as.
- Dependency direction: The estimate is one pure function of a draft and a list of meals, in src/domain, with no DOM and no SDK. The panel is a pure function of its result.
- Failure: Condition: The meal history cannot be read because the server is unreachable. | Outcome: Retry | Observation: The panel shows 'Cannot reach the server. Try again.' with a usable retry control, and no number. Every field stays usable, because an estimate is a convenience and must never block recording what happened.
- Failure: Condition: The most recent matching entry has no after reading. | Outcome: Refusal | Observation: That entry is skipped and the next matching one is used; if none has both readings the panel gives the no-entry reason rather than a number, because a change that was never measured cannot be reported.
- Failure: Condition: The before reading is cleared after an estimate was shown. | Outcome: Refusal | Observation: The number disappears and the panel returns to 'Type your reading before eating to see an estimate.', because an estimate without a starting point is meaningless.

### Acceptance supports
- `tests/support/local-stack.ts`
- `tests/support/accounts.ts`

### Public oracle
Observation: While logging again, as soon as the before reading is typed the entry shows an expected after reading equal to before plus the change of the most recent entry with the same foods, the same slot and the same dose; changing slot or dose to one with no such entry removes the estimate and says why.

Stimulus: Account A owns, all with the foods Chicken rice of type Mixed dish 250 g and Cucumber salad of type Vegetable 80 g: a dinner seven days ago with 6 units, 110 to 142; a dinner fourteen days ago with 6 units, 120 to 150; a dinner ten days ago with 8 units, 145 to 121; a dinner three days ago with 6 units and a before reading of 130 and NO after reading; and a lunch five days ago with 6 units, 100 to 150. A browser at a 360 px viewport signs in, opens the seven-day-old dinner and uses 'Log again with these foods'. It reads the panel before typing anything, then enters glucose before 150 and reads it, then enters the dose 6, then changes the dose to 8, then to 7, then changes the slot to Breakfast, then clears the before reading.

Expected: Before anything is typed the panel reads 'Type your reading before eating to see an estimate.' With 150 entered and no dose it reads 'Enter the dose to see an estimate.' At 6 units it shows 182 in the rose change band and names its source as 6 u, 110 to 142, +32, on the date seven days ago -- not the fourteen-day-old dinner, which is older, nor the three-day-old one, which has no after reading, nor the lunch, which is another slot. At 8 units it shows 126 in the stable band and names 8 u, 145 to 121, −24. At 7 units there is no number and it reads 'No dinner at 7 u. Most recent was 6 u (+32).' With the slot changed to Breakfast there is no number and it reads 'No breakfast on record with these foods.' With the before reading cleared it returns to 'Type your reading before eating to see an estimate.' The after reading field is empty throughout. The page never scrolls horizontally.

Falsifier: The estimate is not the before reading plus the matching change, or it is based on an older entry when a newer one matches, or on an entry with no after reading, or on another slot, or on another dose, or the panel shows a number when nothing matches, or a reason is missing or does not name why, or the estimated number carries the wrong change band, or the estimate is written into the after reading field, or the panel does not update when the slot or dose changes, or the document scrolls horizontally at a 360 px viewport.

### Oracle and verification
Oracle target locator: `tests/acceptance/expected-after.spec.ts`

Verification command: `npm run build`
Verification command: `npm run test:acceptance -- tests/acceptance/expected-after.spec.ts`
Verification command: `npm run test:acceptance`
