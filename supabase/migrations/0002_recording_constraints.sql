-- Recording constraints.
--
-- Value 1 pinned meal_foods.food_type to the brief's seven types at the row. Now
-- that the browser writes these tables rather than only reading them, the other
-- two fixed vocabularies get the same treatment: a mistyped exercise context or
-- amount unit is refused by Postgres rather than surviving as an unclassifiable
-- value that every later comparison has to guess at.
--
-- Both constraints only narrow an existing nullable text column to its fixed
-- list, so every row the seeds and the reading path already write satisfies them.

alter table public.meals
  add constraint meals_exercise_context_check
  check (exercise_context is null
         or exercise_context in ('none', 'before', 'after'));

alter table public.meal_foods
  add constraint meal_foods_unit_check
  check (unit is null
         or unit in ('g', 'ml', 'pc', 'cup', 'tbsp'));
