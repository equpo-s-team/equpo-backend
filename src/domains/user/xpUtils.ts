/**
 * XP / Leveling system utilities.
 *
 * - Level 1 requires 100 XP.
 * - Each subsequent level requires 1.5× the previous level's threshold.
 * - Formula: xpRequired(N) = 100 * 1.5^(N-1)
 */

export type TaskPriorityKey = 'high' | 'medium' | 'low';

/** XP granted per task completion based on priority. */
export const XP_REWARDS: Record<TaskPriorityKey, number> = {
  high: 60,
  medium: 30,
  low: 15,
} as const;

/** Coins added to team virtualCurrency on task completion. */
export const COIN_REWARDS: Record<TaskPriorityKey, number> = {
  high: 20,
  medium: 15,
  low: 10,
} as const;

const BASE_XP = 100;
const GROWTH_FACTOR = 1.5;

/** Total XP required to reach a given level. */
export function xpRequiredForLevel(level: number): number {
  if (level <= 0) return 0;
  return Math.floor(BASE_XP * Math.pow(GROWTH_FACTOR, level - 1));
}

/** Calculate the level for a given total XP amount. */
export function calculateLevel(totalXp: number): number {
  if (totalXp < BASE_XP) return 0;
  return Math.floor(Math.log(totalXp / BASE_XP) / Math.log(GROWTH_FACTOR)) + 1;
}

/** XP threshold for the NEXT level after the current one. */
export function xpForNextLevel(currentLevel: number): number {
  return xpRequiredForLevel(currentLevel + 1);
}
