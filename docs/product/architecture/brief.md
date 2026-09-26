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
| `package.json` | CREATE_NEW | The repository has no Node manifest; the build, the Supabase client dependency and the verification scripts need one. |
| `tsconfig.json` | CREATE_NEW | TypeScript is the source language, so the compiler needs strict settings the build and the tests share. |
| `vite.config.ts` | CREATE_NEW | Vite produces the static bundle GitHub Pages serves and resolves the base path for a project page. |
| `index.html` | CREATE_NEW | The single page the static host serves; it carries the viewport meta that makes the layout fluid. |
| `src/main.ts` | CREATE_NEW | The composition root that builds the adapters, reads the session and renders either the sign-in screen or the signed-in shell. |
| `src/ports/identity.ts` | CREATE_NEW | The driving port for sign-in, sign-out and current account, so the domain compiles without the Supabase SDK. |
| `src/ports/log-store.ts` | CREATE_NEW | The driven port this value already consumes: read the signed-in account's entries for one date. |
| `src/domain/entry.ts` | CREATE_NEW | The Entry and NightInsulin types and the pure functions that turn one into its day-log line, so the reading rule is testable without a browser. |
| `src/adapters/supabase/client.ts` | CREATE_NEW | Builds the single Supabase JS client from build-time public configuration. |
| `src/adapters/supabase/identity.ts` | CREATE_NEW | Implements the identity port against Supabase Auth and maps its errors onto the named failure outcomes. |
| `src/adapters/supabase/log-store.ts` | CREATE_NEW | Implements the log-store port against PostgREST with no user_id filter of its own, so row-level security alone decides what comes back. |
| `src/ui/sign-in.ts` | CREATE_NEW | The sign-in screen: a labelled email and password form with the refusal and retry messages. |
| `src/ui/shell.ts` | CREATE_NEW | The signed-in frame: the header, the sign-out control and the slot the day log renders into. |
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
- meals holds id, user_id, slot, eaten_at, glucose_before, glucose_after, insulin_units, exercise_context, note. meal_foods holds id, user_id, meal_id, name, food_type, amount, unit, position. night_insulin holds id, user_id, night_on, units, taken_at, bedtime_glucose. Glucose columns are integers in mg/dL.
- Every user table carries user_id uuid not null default auth.uid() references auth.users(id) on delete cascade, has row-level security enabled, and has policies using (auth.uid() = user_id) for select, update and delete and with check (auth.uid() = user_id) for insert.
- Ownership is enforced in Postgres, never in the browser. The log-store adapter issues no user_id filter of its own; if a policy were dropped the oracle would fail rather than a client-side filter hiding it.
- The reading surface for this value is deliberately plain: one text line per entry, no cards and no meal slots. A meal line reads 'Breakfast · 07:40 · Oats 60 g, Milk 200 ml' and a night insulin line reads '18 u at 22:30'. Value 2 reshapes these same rows into the designed cards.
- When the signed-in account owns no entries for the date, the day log shows exactly 'No entries yet.'
- The Supabase client's own persisted session is the session. The app renders the sign-in screen when there is none and the shell when there is, and re-renders on the auth state change event.
- Acceptance runs against the Supabase CLI local stack in Docker with two seeded accounts, so the oracle exercises real Postgres and real row-level security rather than a stub.
- The oracle drives the built bundle served as static files, because a live GitHub Pages URL is not a locally falsifiable observation; the Pages workflow publishes that same bundle.
- The oracle and its test supports are the only bytes the acceptance step writes. supabase/migrations/0001_owner_scoped_schema.sql is production scope and is written at craft time, so the oracle is red until the schema and its policies exist.

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

Stimulus: Two accounts exist in the local Supabase stack. Account A owns, dated today: one meals row (slot breakfast, eaten_at 07:40, glucose_before 104, glucose_after 186, insulin_units 5) with two meal_foods rows (Oats, 60 g and Milk, 200 ml), and one night_insulin row (units 18, taken_at 22:30, bedtime_glucose 132). Account B owns no rows in any of the three tables. A browser at a 360 px viewport loads the built static bundle, signs in as account A and reads the day log, then signs out and signs in as account B on the same bundle and reads the day log again.

Expected: Signed in as account A the day log shows the line 'Breakfast · 07:40 · Oats 60 g, Milk 200 ml' and the line '18 u at 22:30'. Signed in as account B the day log shows exactly 'No entries yet.' and neither of account A's lines, nor any other text from account A's rows, appears anywhere on the page. Both sign-ins succeed and the page never scrolls horizontally.

Falsifier: Account B's page contains any text from a row account A owns, or account A's own two lines are missing from its day log, or either account cannot sign in with correct credentials, or the document scrolls horizontally at a 360 px viewport.

### Oracle and verification
Oracle target locator: `tests/acceptance/own-data-only.spec.ts`

Verification command: `npm run build`
Verification command: `npm run test:acceptance`
