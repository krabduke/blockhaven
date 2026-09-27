// Brewing: water bottle + ingredient -> potion; potion + gunpowder -> splash potion.
// The stand burns glow dust (10 brews) or an ember core (30 brews) as fuel.

import { POTIONS } from './effects';
import { I, itemDef } from './items';

export const BREW_TICKS = 400;

export function brewFuel(id: number): number {
  return id === I.glow_dust ? 10 : id === I.ember_core ? 30 : 0;
}

/** What `bottle` becomes when brewed with `ingredient`, or undefined if nothing happens. */
export function brewResult(ingredient: number, bottle: number): number | undefined {
  if (bottle === I.water_bottle) {
    const p = POTIONS.find((q) => I[q.ingredient] === ingredient);
    return p ? I['potion_' + p.effect] : undefined;
  }
  const pot = itemDef(bottle)?.potion;
  if (pot && !pot.splash && ingredient === I.gunpowder) return I['splash_potion_' + pot.effect];
  return undefined;
}

export function isBrewIngredient(id: number): boolean {
  return id === I.gunpowder || POTIONS.some((q) => I[q.ingredient] === id);
}
