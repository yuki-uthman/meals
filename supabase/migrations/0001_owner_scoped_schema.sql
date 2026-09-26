-- Owner-scoped user schema for the Meal & Insulin Log.
--
-- Ownership is enforced here, in Postgres, and nowhere else. Every user table
-- carries user_id defaulting to auth.uid(), has row-level security enabled, and
-- has policies scoped to the owning account for every verb. There is no
-- client-side user_id filter anywhere in the browser bundle, so if a policy
-- below were dropped the acceptance oracle would fail rather than a client
-- filter quietly hiding the leak.
--
-- Glucose is stored as whole mg/dL integers.

-- ---------------------------------------------------------------- meals

create table public.meals (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null default auth.uid()
                     references auth.users (id) on delete cascade,
  slot             text not null
                     check (slot in ('breakfast', 'lunch', 'dinner', 'snack')),
  -- The local calendar date the meal belongs to, beside the clock time. Every
  -- day query selects on this column and never on eaten_at, so no reading
  -- depends on the server's UTC offset and a 22:30 meal cannot fall into the
  -- neighbouring day.
  eaten_on         date not null,
  eaten_at         timestamptz not null,
  glucose_before   integer check (glucose_before between 0 and 2000),
  glucose_after    integer check (glucose_after between 0 and 2000),
  insulin_units    numeric(5, 2) check (insulin_units >= 0),
  exercise_context text,
  note             text
);

create index meals_user_eaten_on_idx on public.meals (user_id, eaten_on, eaten_at);

-- ----------------------------------------------------------- meal_foods

create table public.meal_foods (
  id        uuid primary key default gen_random_uuid(),
  user_id   uuid not null default auth.uid()
              references auth.users (id) on delete cascade,
  meal_id   uuid not null references public.meals (id) on delete cascade,
  name      text not null,
  -- The seven food types the brief fixes. Stated as a constraint rather than a
  -- convention, so a mistyped type is refused at the row rather than surfacing
  -- as an unclassified food later.
  food_type text not null
              check (food_type in ('carb-heavy', 'protein', 'vegetable',
                                   'fruit', 'dairy', 'mixed dish', 'drink')),
  amount    numeric(8, 2) check (amount >= 0),
  unit      text,
  position  integer not null default 0
);

create index meal_foods_meal_idx on public.meal_foods (meal_id, position);
create index meal_foods_user_idx on public.meal_foods (user_id);

-- -------------------------------------------------------- night_insulin

create table public.night_insulin (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null default auth.uid()
                     references auth.users (id) on delete cascade,
  night_on         date not null,
  units            numeric(5, 2) not null check (units >= 0),
  taken_at         timestamptz,
  bedtime_glucose  integer check (bedtime_glucose between 0 and 2000),
  unique (user_id, night_on)
);

create index night_insulin_user_night_idx on public.night_insulin (user_id, night_on);

-- ------------------------------------------------ row-level security

alter table public.meals         enable row level security;
alter table public.meal_foods    enable row level security;
alter table public.night_insulin enable row level security;

-- Deny by default: with row-level security enabled and only the owner policies
-- below, any row whose user_id is not the caller is invisible and untouchable.

create policy meals_owner_select on public.meals
  for select to authenticated using (auth.uid() = user_id);
create policy meals_owner_insert on public.meals
  for insert to authenticated with check (auth.uid() = user_id);
create policy meals_owner_update on public.meals
  for update to authenticated using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
create policy meals_owner_delete on public.meals
  for delete to authenticated using (auth.uid() = user_id);

create policy meal_foods_owner_select on public.meal_foods
  for select to authenticated using (auth.uid() = user_id);
create policy meal_foods_owner_insert on public.meal_foods
  for insert to authenticated with check (auth.uid() = user_id);
create policy meal_foods_owner_update on public.meal_foods
  for update to authenticated using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
create policy meal_foods_owner_delete on public.meal_foods
  for delete to authenticated using (auth.uid() = user_id);

create policy night_insulin_owner_select on public.night_insulin
  for select to authenticated using (auth.uid() = user_id);
create policy night_insulin_owner_insert on public.night_insulin
  for insert to authenticated with check (auth.uid() = user_id);
create policy night_insulin_owner_update on public.night_insulin
  for update to authenticated using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
create policy night_insulin_owner_delete on public.night_insulin
  for delete to authenticated using (auth.uid() = user_id);

-- ------------------------------------------------------------- grants

-- Stated outright rather than inherited from the project's default privileges,
-- so this file alone says who may touch the user schema.

-- An unauthenticated caller has no reach into the user schema at all. This is
-- belt and braces over row-level security: there is no anon policy either.
revoke all on public.meals         from anon;
revoke all on public.meal_foods    from anon;
revoke all on public.night_insulin from anon;

grant select, insert, update, delete on public.meals         to authenticated;
grant select, insert, update, delete on public.meal_foods    to authenticated;
grant select, insert, update, delete on public.night_insulin to authenticated;

-- service_role seeds and administers from outside the browser. Its key never
-- appears in the bundle or in this repository.
grant all on public.meals         to service_role;
grant all on public.meal_foods    to service_role;
grant all on public.night_insulin to service_role;
