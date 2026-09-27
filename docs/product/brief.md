# Product brief

## Request
    Build the Meal & Insulin Log designed in the canvas at https://claude.ai/artifact/DayTnKU1HdFpfskEVWLtYR as a mobile-friendly website for one or two users. The user records each meal (slot, time, foods with type and amount, glucose before and after in mg/dL, rapid-acting insulin units, exercise context, note) and the night-time long-acting insulin, then looks back to answer: last time I ate this, how much did I take and how far did my glucose move? The front end is a static site on GitHub Pages; the backend is Supabase on its free tier.

## Outcomes
-     Before eating a familiar meal, the user sees in under a minute what dose they took last time and how their glucose moved, without scrolling through a diary.
-     Every meal is stored with enough detail (foods, amounts, dose, before, after, context) that two instances of the same meal can be compared.
-     A glance at History shows which meals were stable and which were not, and any cell opens the meal behind it.
-     The app runs on a phone browser from a free GitHub Pages URL and a free Supabase project, with no server for the user to operate.

## Scope

### In scope
-     Email and password sign-in through Supabase Auth; each user reads and writes only their own rows.
-     Today log with a card per meal slot and a night insulin card.
-     Recording a meal with foods (type from a fixed list, amount with unit), readings, dose, exercise context and note.
-     Recording night insulin with bedtime glucose and a five-night dose-to-morning list.
-     In-app number pad for glucose fields; minus/plus stepper for doses.
-     Meal detail with every earlier instance of the same foods, newest first.
-     Log again: copy foods and amounts into a fresh entry with a live expected-after estimate.
-     History grid with Before, Change and Both views.
-     Lookup by food, by change and by start.
-     Light and dark themes following the device setting.
-     Static hosting on GitHub Pages; Postgres schema, row-level security and migrations in the repo for Supabase.

### Out of scope
Applicability: applicable
Reason:     Version one is a personal log for at most two people; anything that turns it into a medical device, a shared product or a native app is deferred.
-     Native iOS or Android apps and app-store distribution.
-     Automatic import from glucose meters, CGMs or insulin pens.
-     Carbohydrate counting, nutrition databases or barcode scanning.
-     Dose recommendations or any advice; the app only shows what happened before.
-     Sharing data between the two users, or clinician access.
-     mmol/L display; the app uses mg/dL only.
-     Offline editing with later sync beyond ordinary browser caching.

## Observations
-     A person opens the GitHub Pages URL on a phone, signs in with email and password, and sees only their own data; a second account sees none of the first account's rows.
-     After sign-in the Today screen shows the date, a card per logged meal (slot, time, foods, dose, before → after with the change), a 'not logged yet' card for an empty slot, and a night insulin card.
-     The user records a meal with slot, time, one or more foods (name, type from the fixed list, amount, unit), glucose before, rapid-acting units, exercise context, note and optionally glucose after; it appears on Today and can be edited later to add the after reading.
-     The user records night insulin (long-acting units, time, bedtime glucose); the screen lists the last five nights as dose and next-morning reading.
-     Tapping a glucose field opens an in-app number pad with chips for the last reading; dose fields change by one unit with minus and plus buttons.
-     Opening a meal shows its foods with amounts, dose, before → after with the change, note, and below that every earlier instance with the same foods, newest first, each as dose, before → after and change; the instance being viewed is marked.
-     From a meal, 'Log again' opens a new entry with only the foods and amounts copied; time, readings, dose and context start empty or at today's values, and saving creates a separate record while the original is unchanged.
-     While logging again, as soon as the before reading is typed the entry shows an expected after reading equal to before plus the change of the most recent entry with the same foods, the same slot and the same dose; changing slot or dose to one with no such entry removes the estimate and says why.
-     History shows one row per day and columns for morning, breakfast, lunch and dinner with a Before, Change and Both view; cells are coloured by the rule in the decisions, the legend follows the view, and tapping a cell opens that meal.
-     Lookup by food: typing a food lists past meals that contain it, with a summary of typical amount, typical dose and average change, and each result opens the meal.
-     Lookup by change: entering a target change and a window (±2, ±5, ±10) lists past meals whose change was nearest, nearest first, each showing dose, before → after and how far off it was.
-     Lookup by start: entering a starting reading and a window (±5, ±10, ±20) lists past meals whose before reading was nearest, nearest first, each showing dose, before → after, the change and how far off it was.
-     In Add food, typing a name lists the person's own foods that match and lets one be chosen, which fills in its type; a name that matches nothing offers to create that food, and a food created once never has to be typed again.
-     The site follows the device's light or dark setting using the two palettes from the canvas, and every screen fills the width of a large Android phone, with no horizontal scrolling at any viewport width from 360 px upward.

## Decisions
-     Glucose is stored and shown in mg/dL as whole numbers.
-     Front end: a static, mobile-first web app served from GitHub Pages; the visual reference is the light and dark canvas at https://claude.ai/artifact/DayTnKU1HdFpfskEVWLtYR.
-     Backend: Supabase free tier. Postgres holds the data, Supabase Auth (email and password) identifies the user, row-level security limits every table to the owning user, and the browser calls Supabase directly with the JS client. No custom server.
-     Supabase schema lives in the repo as SQL migrations run by the Supabase CLI; local development uses the CLI's local stack (Docker) so tests run against real Postgres.
-     Users: one or two, each with a separate account and separate data. A second user is invited by creating their account; no data is shared.
-     Food type list: carb-heavy, protein, vegetable, fruit, dairy, mixed dish, drink. Amount units: g, ml, pc, cup, tbsp.
-     Same meal means the same set of foods with the same amounts and units; slot, time, readings, dose and context are per instance.
-     History colour rule: the Before view is coloured by the level of that reading (low under 70, in range 70 to 180, high 181 to 250, very high over 250); the Change and Both views are coloured by the change (dropped 40 or more, stable within +30, rose +31 to +60, rose over +60). The colour never reflects the absolute level in the Change and Both views.
-     Expected after = before reading plus the change of the most recent entry with the same foods, the same meal slot and the same dose; if no such entry exists, no estimate is shown.
-     Lookups return past meals nearest to the target first; each result shows how far off it was and links to that meal.
-     Night insulin is a separate daily record (dose, time, bedtime glucose), not a meal.
-     The app is not a medical device and never suggests a dose.
-     A food is a record of its own, owned by the person: a name and a type, unique per account once normalised. Add food offers the foods already recorded and creates a new one only when the name matches none, so a food is typed once and chosen thereafter.
-     A meal keeps the food's name and type AS RECORDED at the time, beside the identity of the catalogue entry it was chosen from. Renaming a food later does not rewrite what past meals say was eaten.
-     Layout is fluid, not pinned to the canvas artboard frame. The page fills the phone's width and stays free of horizontal scrolling from 360 px upward; a large Android screen shows more content, not a letterboxed narrow column. The canvas artboards are a visual reference for palette, type and structure, not a target width.

## Values
| Observation | Dependencies |
| --- | --- |
| A person opens the GitHub Pages URL on a phone, signs in with email and password, and sees only their own data; a second account sees none of the first account's rows. |  |
| After sign-in the Today screen shows the date, a card per logged meal (slot, time, foods, dose, before → after with the change), a 'not logged yet' card for an empty slot, and a night insulin card. | A person opens the GitHub Pages URL on a phone, signs in with email and password, and sees only their own data; a second account sees none of the first account's rows. |
| The user records a meal with slot, time, one or more foods (name, type from the fixed list, amount, unit), glucose before, rapid-acting units, exercise context, note and optionally glucose after; it appears on Today and can be edited later to add the after reading. | After sign-in the Today screen shows the date, a card per logged meal (slot, time, foods, dose, before → after with the change), a 'not logged yet' card for an empty slot, and a night insulin card. |
| The user records night insulin (long-acting units, time, bedtime glucose); the screen lists the last five nights as dose and next-morning reading. | After sign-in the Today screen shows the date, a card per logged meal (slot, time, foods, dose, before → after with the change), a 'not logged yet' card for an empty slot, and a night insulin card. |
| Tapping a glucose field opens an in-app number pad with chips for the last reading; dose fields change by one unit with minus and plus buttons. | The user records a meal with slot, time, one or more foods (name, type from the fixed list, amount, unit), glucose before, rapid-acting units, exercise context, note and optionally glucose after; it appears on Today and can be edited later to add the after reading. |
| Opening a meal shows its foods with amounts, dose, before → after with the change, note, and below that every earlier instance with the same foods, newest first, each as dose, before → after and change; the instance being viewed is marked. | The user records a meal with slot, time, one or more foods (name, type from the fixed list, amount, unit), glucose before, rapid-acting units, exercise context, note and optionally glucose after; it appears on Today and can be edited later to add the after reading. |
| From a meal, 'Log again' opens a new entry with only the foods and amounts copied; time, readings, dose and context start empty or at today's values, and saving creates a separate record while the original is unchanged. | Opening a meal shows its foods with amounts, dose, before → after with the change, note, and below that every earlier instance with the same foods, newest first, each as dose, before → after and change; the instance being viewed is marked. |
| While logging again, as soon as the before reading is typed the entry shows an expected after reading equal to before plus the change of the most recent entry with the same foods, the same slot and the same dose; changing slot or dose to one with no such entry removes the estimate and says why. | From a meal, 'Log again' opens a new entry with only the foods and amounts copied; time, readings, dose and context start empty or at today's values, and saving creates a separate record while the original is unchanged. |
| History shows one row per day and columns for morning, breakfast, lunch and dinner with a Before, Change and Both view; cells are coloured by the rule in the decisions, the legend follows the view, and tapping a cell opens that meal. | The user records a meal with slot, time, one or more foods (name, type from the fixed list, amount, unit), glucose before, rapid-acting units, exercise context, note and optionally glucose after; it appears on Today and can be edited later to add the after reading., The user records night insulin (long-acting units, time, bedtime glucose); the screen lists the last five nights as dose and next-morning reading., Opening a meal shows its foods with amounts, dose, before → after with the change, note, and below that every earlier instance with the same foods, newest first, each as dose, before → after and change; the instance being viewed is marked. |
| Lookup by food: typing a food lists past meals that contain it, with a summary of typical amount, typical dose and average change, and each result opens the meal. | Opening a meal shows its foods with amounts, dose, before → after with the change, note, and below that every earlier instance with the same foods, newest first, each as dose, before → after and change; the instance being viewed is marked. |
| Lookup by change: entering a target change and a window (±2, ±5, ±10) lists past meals whose change was nearest, nearest first, each showing dose, before → after and how far off it was. | Opening a meal shows its foods with amounts, dose, before → after with the change, note, and below that every earlier instance with the same foods, newest first, each as dose, before → after and change; the instance being viewed is marked. |
| Lookup by start: entering a starting reading and a window (±5, ±10, ±20) lists past meals whose before reading was nearest, nearest first, each showing dose, before → after, the change and how far off it was. | Opening a meal shows its foods with amounts, dose, before → after with the change, note, and below that every earlier instance with the same foods, newest first, each as dose, before → after and change; the instance being viewed is marked. |
| The site follows the device's light or dark setting using the two palettes from the canvas, and every screen fills the width of a large Android phone, with no horizontal scrolling at any viewport width from 360 px upward. | After sign-in the Today screen shows the date, a card per logged meal (slot, time, foods, dose, before → after with the change), a 'not logged yet' card for an empty slot, and a night insulin card. |
| In Add food, typing a name lists the person's own foods that match and lets one be chosen, which fills in its type; a name that matches nothing offers to create that food, and a food created once never has to be typed again. | The user records a meal with slot, time, one or more foods (name, type from the fixed list, amount, unit), glucose before, rapid-acting units, exercise context, note and optionally glucose after; it appears on Today and can be edited later to add the after reading. |
