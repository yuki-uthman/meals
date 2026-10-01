# Meal & Insulin Log

A personal log for one or two people: record each meal with its foods, the glucose
before and after in mg/dL, the rapid-acting dose and the context; record the
night-time long-acting dose; then look back to answer *last time I ate this, how much
did I take and how far did my glucose move?*

A static site on GitHub Pages talking directly to Supabase. There is no server to
operate. **It is not a medical device and it never suggests a dose** — every number it
shows is one you recorded before.

## What it does

- Sign in with email and password; each account reads and writes only its own rows.
- **Today** — a card per meal slot with time, foods, dose and `before → after` with the
  change, a *Not logged yet* card for an empty slot, a night insulin card, and a day
  stepper.
- **Recording** — slot, time, foods (name, type, amount, unit), glucose before, dose,
  exercise context, note, and glucose after whenever you measure it. An in-app number
  pad for glucose fields with chips for your last reading; a one-unit stepper for doses.
- **Night insulin** — the dose, the time and the bedtime reading, with the last five
  nights shown as dose against next-morning reading.
- **Meal detail** — what was eaten, the dose, the readings, the note, and every other
  time you ate the same foods, newest first. *Log again* copies the foods only.
- **Expected after** — while filling an entry, the before reading plus the change of the
  most recent entry with the same foods, slot and dose. It says why when there is none.
- **History** — one row per day, columns for the night and the three meal slots, in a
  Before, Change or Both view. Before is coloured by the level of the reading; Change
  and Both by the change. A food search, offering the foods you have eaten as you
  type, greys out every cell that does not hold that food and leaves the grid as it is.
- **Lookup** — by food, by target change, or by starting reading.

## Setting it up

You need a free Supabase project and a GitHub repository with Pages enabled.

1. **Create the Supabase project**, then apply the schema from this repo:

   ```
   npx supabase link --project-ref <your-project-ref>
   npx supabase db push
   ```

   This creates `meals`, `meal_foods` and `night_insulin`, each owner-scoped with
   row-level security on `auth.uid()`.

2. **Create the accounts.** In the Supabase dashboard under Authentication, add one
   user per person. There is no sign-up screen on purpose: this is a log for one or two
   people, not a product.

3. **Tell the build where Supabase is.** In the repository's Settings → Secrets and
   variables → Actions → *Variables*, add:

   - `SUPABASE_URL` — your project URL
   - `SUPABASE_ANON_KEY` — your project's anon key

   Both are public by design. Row-level security, not key secrecy, is what separates
   the two accounts. **Never put the service-role key here or anywhere in this repo.**

4. **Turn on Pages.** Settings → Pages → Source: *GitHub Actions*. Pushing to `main`
   then builds and publishes, and the app is at
   `https://<user>.github.io/<repo>/`.

## Working on it

```
npm install
npm run dev                  # local dev server

npx supabase start           # local Postgres in Docker, needs Docker running
npm run test:acceptance      # the full acceptance suite in a real browser
npm run build                # typecheck both projects, then build dist/
```

The acceptance suite drives the **built** bundle against the local Supabase stack, so
what it judges is what Pages serves. It brings the stack up and applies the migrations
itself. Every screen is asserted to fit a 360 px viewport without scrolling sideways.

## How it is put together

- `src/domain/` — the rules, as pure functions with no DOM and no SDK: the change and
  level bands, meal identity, the expected-after estimate, the History projection, the
  nearest-match lookups.
- `src/ports/` — the two boundaries: identity and the log store.
- `src/adapters/supabase/` — the only code that knows Supabase exists. It sends no
  `user_id` and filters by none: if a policy were dropped, the acceptance suite would
  fail rather than a client-side filter quietly hiding the leak.
- `src/ui/` — screens as pure functions from state to DOM. No framework.
- `supabase/migrations/` — the schema and its policies.
- `docs/product/brief.md` — the product authority: the values, the decisions and why.
- `docs/product/architecture/brief.md` — the design behind each value.

Glucose is stored and shown as whole mg/dL. A colour band describes what happened and
never recommends anything.
