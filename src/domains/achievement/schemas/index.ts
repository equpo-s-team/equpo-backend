export {
  checkAchievementsOnTaskComplete,
  computeEnvironmentHealth,
} from '../achievementChecker.js';
export type {
  AchievementCheckContext,
  UnlockedAchievement,
} from '../achievementChecker.js';
export { ACHIEVEMENT_KEYS } from '../achievementConstants.js';
export type { AchievementKey } from '../achievementConstants.js';
export {
  createAchievementSchema,
  unlockAchievementSchema,
} from './createAchievementSchema.js';
