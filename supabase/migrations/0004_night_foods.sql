-- What was eaten with the night dose.
--
-- A bedtime reading on the low side is answered with something small to eat
-- before the long-acting dose, and that snack is part of the night: it is what
-- the next morning's reading has to be read against. So a night gets food lines
-- of its own, shaped exactly as a meal's are -- name, type, amount, unit and
-- position, with the same three vocabularies constrained at the row.
--
-- The lines are the night's and not a meal's on purpose: the brief keeps night
-- insulin a separate daily record rather than a meal, so the snack is not a
-- 'snack' slot meal and never appears on the meal screens, in the meal history
-- or in the lookups.
--
-- Optional, always: a night with no food lines is the ordinary night.

create table public.night_foods (
  id        uuid primary key default gen_random_uuid(),
  user_id   uuid not null default auth.uid()
              references auth.users (id) on delete cascade,
  -- Removing a night removes what was eaten with it.
  night_id  uuid not null references public.night_insulin (id) on delete cascade,
  name      text not null,
  food_type text not null
              check (food_type in ('carb-heavy', 'protein', 'vegetable',
                                   'fruit', 'dairy', 'mixed dish', 'drink')),
  amount    numeric(8, 2) check (amount >= 0),
  unit      text check (unit is null
                        or unit in ('g', 'ml', 'pc', 'cup', 'tbsp')),
  position  integer not null default 0
);

create index night_foods_night_idx on public.night_foods (night_id, position);
create index night_foods_user_idx on public.night_foods (user_id);

-- ------------------------------------------------ row-level security

alter table public.night_foods enable row level security;

-- Deny by default, and the same four owner policies every other table carries.

create policy night_foods_owner_select on public.night_foods
  for select to authenticated using (auth.uid() = user_id);
create policy night_foods_owner_insert on public.night_foods
  for insert to authenticated with check (auth.uid() = user_id);
create policy night_foods_owner_update on public.night_foods
  for update to authenticated using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
create policy night_foods_owner_delete on public.night_foods
  for delete to authenticated using (auth.uid() = user_id);

-- ------------------------------------------------------------- grants

revoke all on public.night_foods from anon;

grant select, insert, update, delete on public.night_foods to authenticated;

grant all on public.night_foods to service_role;
