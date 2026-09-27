// The account's own foods, and the pure rules that say which of them a typed name
// offers, which one it already is, and how each is named on screen. No DOM and no
// SDK here, so every rule this value is judged on is testable without a browser.
//
// A food is a record of its own: a name and a type, owned by one account. What was
// eaten stays recorded on the meal, so nothing here is ever the record of the past
// -- this is only what stops a person retyping.

import { foodTypeLabel, type FoodType } from './entry';

export type CatalogueFood = {
  readonly id: string;
  readonly name: string;
  /** A food cannot enter the catalogue without a type, so this is never null. */
  readonly foodType: FoodType;
  /** When the food entered the catalogue. */
  readonly addedAt: Date;
  /** When it was last eaten, or null when it has not been eaten yet. */
  readonly lastEatenAt: Date | null;
};

/**
 * Refused because the account is unique on the NORMALISED name: 'CHICKEN RICE' is
 * the food it already has. Nothing is written, so the food it has keeps its own type.
 */
export const ALREADY_OWNED = 'You already have that food.';

/** A food cannot enter the catalogue without a type, so creating one without is refused. */
export const NEEDS_TYPE = 'Choose a type for this food.';

/**
 * A name that is not a food of this account's and was not offered for creation
 * either. Nothing is created silently, so the person is sent back to the two
 * offers that are already on the screen.
 */
export const CHOOSE_OR_CREATE = 'Choose one of your foods, or create this one.';

/**
 * At most eight foods are offered. A list longer than a thumb-reach is a list
 * nobody reads to the end of; typing narrows it.
 */
export const MATCH_LIMIT = 8;

/**
 * A food's name as identity: trimmed and lower-cased. 'Oats' and 'oats ' are one
 * food, and this is the one place that says so.
 */
export const normalisedName = (name: string): string => name.trim().toLowerCase();

/** When a food was last put to use, which is what the offer is ordered by. */
const usedAt = (food: CatalogueFood): number =>
  (food.lastEatenAt ?? food.addedAt).getTime();

const byMostRecentlyUsed = (a: CatalogueFood, b: CatalogueFood): number =>
  usedAt(b) - usedAt(a);

/**
 * The foods to offer beneath the name field: the ones whose normalised name
 * CONTAINS the typed text, most recently used first, and never more than the
 * screen lists. An empty field offers the most recently used, because the point of
 * the catalogue is that the commonest food is one tap away.
 */
export const matchingFoods = (
  catalogue: readonly CatalogueFood[],
  typed: string,
): readonly CatalogueFood[] => {
  const wanted = normalisedName(typed);
  return [...catalogue]
    .filter((food) => normalisedName(food.name).includes(wanted))
    .sort(byMostRecentlyUsed)
    .slice(0, MATCH_LIMIT);
};

/**
 * The food this typed name IS, character for character once trimmed. This decides
 * whether creation is offered at all: a name that is already on screen as a
 * matching food does not need a second offer to create it.
 */
export const exactlyNamedFood = (
  catalogue: readonly CatalogueFood[],
  typed: string,
): CatalogueFood | null =>
  catalogue.find((food) => food.name.trim() === typed.trim()) ?? null;

/**
 * The food this typed name already is as IDENTITY -- normalised, so differing only
 * in case or in spacing is the same food. This decides what may be created, which
 * is a different question from what is offered: 'CHICKEN RICE' is offered for
 * creation because it is not stored character for character, and refused on the
 * attempt because the account already owns that food.
 */
export const ownedFood = (
  catalogue: readonly CatalogueFood[],
  typed: string,
): CatalogueFood | null => {
  const wanted = normalisedName(typed);
  return catalogue.find((food) => normalisedName(food.name) === wanted) ?? null;
};

/** 'Chicken rice · Mixed dish': the food and its type, which is what is chosen. */
export const catalogueFoodLabel = (food: CatalogueFood): string =>
  `${food.name} · ${foodTypeLabel(food.foodType)}`;

/** 'Create "Chicken rice"': the offer, naming the food it would create. */
export const createFoodLabel = (typed: string): string => `Create "${typed.trim()}"`;

/** The catalogue with a newly created food in it, so the offer is right at once. */
export const withCatalogueFood = (
  catalogue: readonly CatalogueFood[],
  food: CatalogueFood,
): readonly CatalogueFood[] => [...catalogue, food];
