-- The food catalogue: a food is a record of its own.
--
-- Until now a food existed only as a line inside a meal, so eating the same thing
-- twice meant typing it twice. This migration gives a food a row of its own, owner
-- scoped exactly as the three existing tables are, and links the food lines that
-- already exist to it.
--
-- What it deliberately does NOT do is move the record of what was eaten. meal_foods
-- KEEPS its own name and food_type: those columns are what the meal says was eaten
-- at the time, so renaming a food later must not rewrite the past and deleting one
-- must not delete history. The catalogue exists to stop retyping, not to become the
-- source of truth for what already happened.

-- ---------------------------------------------------------------- foods

create table public.foods (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid()
               references auth.users (id) on delete cascade,
  name       text not null check (btrim(name) <> ''),
  -- The same seven types the brief fixes and meal_foods already constrains, stated
  -- again here rather than inherited, so a catalogue entry cannot carry a
  -- classification a meal line could not.
  food_type  text not null
               check (food_type in ('carb-heavy', 'protein', 'vegetable',
                                    'fruit', 'dairy', 'mixed dish', 'drink')),
  created_at timestamptz not null default now()
);

-- A food is unique per account on its NORMALISED name -- trimmed and lower-cased.
-- 'Oats' and 'oats ' are one food, because a catalogue that holds both has not
-- saved anybody any typing. The rule lives here, in the index, so it holds however
-- the row is written.
create unique index foods_user_normalised_name_idx
  on public.foods (user_id, lower(btrim(name)));

create index foods_user_idx on public.foods (user_id);

-- ------------------------------------------------- the link from a meal's food

-- ON DELETE SET NULL, never cascade: removing a food from the catalogue removes a
-- convenience, not a meal. The line keeps its name, its type and its amount and
-- simply stops pointing at a catalogue entry.
alter table public.meal_foods
  add column food_id uuid references public.foods (id) on delete set null;

create index meal_foods_food_idx on public.meal_foods (food_id);

-- ------------------------------------------------------------- the backfill

-- One food per distinct normalised name each account has already eaten, taking the
-- food_type of its MOST RECENT use: the classification the person settled on last
-- is the one the catalogue offers. Nothing already recorded is touched, so every
-- delivered oracle keeps its meaning and the person's history survives intact.
insert into public.foods (user_id, name, food_type)
select distinct on (eaten.user_id, lower(btrim(eaten.name)))
       eaten.user_id,
       btrim(eaten.name),
       eaten.food_type
  from public.meal_foods eaten
  join public.meals meal on meal.id = eaten.meal_id
 where btrim(eaten.name) <> ''
 order by eaten.user_id,
          lower(btrim(eaten.name)),
          meal.eaten_on desc,
          meal.eaten_at desc;

-- Every food line that already existed now points at its catalogue entry. Only
-- food_id is written: no name, type, amount or unit already recorded changes.
update public.meal_foods eaten
   set food_id = catalogued.id
  from public.foods catalogued
 where catalogued.user_id = eaten.user_id
   and lower(btrim(catalogued.name)) = lower(btrim(eaten.name));

-- ------------------------------------------------ row-level security

alter table public.foods enable row level security;

-- Deny by default, and the same four owner policies the existing tables carry: one
-- account's foods may never reach another's.

create policy foods_owner_select on public.foods
  for select to authenticated using (auth.uid() = user_id);
create policy foods_owner_insert on public.foods
  for insert to authenticated with check (auth.uid() = user_id);
create policy foods_owner_update on public.foods
  for update to authenticated using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
create policy foods_owner_delete on public.foods
  for delete to authenticated using (auth.uid() = user_id);

-- ------------------------------------------------------------- grants

-- An unauthenticated caller has no reach into the catalogue at all, belt and
-- braces over row-level security: there is no anon policy either.
revoke all on public.foods from anon;

grant select, insert, update, delete on public.foods to authenticated;

-- service_role seeds and administers from outside the browser.
grant all on public.foods to service_role;
