// Status effects from potions (and a few foods): what each one is called, its
// colour, and whether it helps or harms. The player applies them each tick;
// splash potions spread them to everything nearby.

export type EffectId =
  | 'swiftness' | 'slowness' | 'healing' | 'regeneration' | 'fire_resistance' | 'night_vision'
  | 'water_breathing' | 'strength' | 'leaping' | 'slow_falling' | 'poison' | 'hero';

export interface EffectDef {
  name: string;
  /** Potion liquid and particle colour. */
  color: string;
  good: boolean;
  /** Applied once when drunk or splashed, instead of lasting. */
  instant?: boolean;
}

export const EFFECTS: Record<EffectId, EffectDef> = {
  swiftness: { name: 'Swiftness', color: '#7cc8f0', good: true },
  slowness: { name: 'Slowness', color: '#5a6a8a', good: false },
  healing: { name: 'Healing', color: '#f04a5a', good: true, instant: true },
  regeneration: { name: 'Regeneration', color: '#e878b8', good: true },
  fire_resistance: { name: 'Fire Resistance', color: '#f0a040', good: true },
  night_vision: { name: 'Night Vision', color: '#3a5ae0', good: true },
  water_breathing: { name: 'Water Breathing', color: '#3aa0c8', good: true },
  strength: { name: 'Strength', color: '#b8342a', good: true },
  leaping: { name: 'Leaping', color: '#9ae04a', good: true },
  slow_falling: { name: 'Slow Falling', color: '#f0ecd8', good: true },
  poison: { name: 'Poison', color: '#5a8a2a', good: false },
  /** Earned by beating a raid: villagers trade for less. */
  hero: { name: 'Village Hero', color: '#e8c040', good: true },
};

export interface ActiveEffect { level: number; ticks: number }

/** "1:30" style remaining time. */
export function formatTicks(ticks: number): string {
  const s = Math.ceil(ticks / 20);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * Brewable potions: effect, duration in ticks (0 for instant), and the ingredient
 * that turns a water bottle into it. Ingredient keys refer to items.
 */
export const POTIONS: { effect: EffectId; ticks: number; ingredient: string }[] = [
  { effect: 'swiftness', ticks: 3600, ingredient: 'sugar' },
  { effect: 'healing', ticks: 0, ingredient: 'red_berries' },
  { effect: 'regeneration', ticks: 900, ingredient: 'golden_apple' },
  { effect: 'fire_resistance', ticks: 3600, ingredient: 'emberquartz' },
  { effect: 'night_vision', ticks: 3600, ingredient: 'carrot' },
  { effect: 'water_breathing', ticks: 3600, ingredient: 'raw_fish' },
  { effect: 'strength', ticks: 3600, ingredient: 'crystal_shard' },
  { effect: 'leaping', ticks: 3600, ingredient: 'bog_slime' },
  { effect: 'slow_falling', ticks: 1800, ingredient: 'feather' },
  { effect: 'poison', ticks: 900, ingredient: 'rotten_flesh' },
];
