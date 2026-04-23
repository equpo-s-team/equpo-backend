export { createAchievementSchema } from './createAchievementSchema.js';
export { unlockAchievementSchema } from './createAchievementSchema.js';
export { ACHIEVEMENT_KEYS } from '../achievementConstants.js';
export type { AchievementKey } from '../achievementConstants.js';
export {
  checkAchievementsOnTaskComplete,
  computeEnvironmentHealth,
} from '../achievementChecker.js';
export type {
  UnlockedAchievement,
  AchievementCheckContext,
} from '../achievementChecker.js';
