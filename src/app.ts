import { requireUser } from '#a/auth.js';
import { config } from '#a/config.js';
import { createAchievement } from '#a/domains/achievement/handlers/createAchievement.js';
import { getAchievements } from '#a/domains/achievement/handlers/getAchievements.js';
import { unlockAchievement } from '#a/domains/achievement/handlers/unlockAchievement.js';
import { grantSystemReward } from '#a/domains/reward/handlers/grantSystemReward.js';
import { listRewards } from '#a/domains/reward/handlers/listRewards.js';
import { createReward } from '#a/domains/reward/handlers/createReward.js';
import { updateReward } from '#a/domains/reward/handlers/updateReward.js';
import { deleteReward } from '#a/domains/reward/handlers/deleteReward.js';
import { purchaseTeamReward } from '#a/domains/reward/handlers/purchaseTeamReward.js';
import { purchaseMemberReward } from '#a/domains/reward/handlers/purchaseMemberReward.js';
import { redeemTeamReward } from '#a/domains/reward/handlers/redeemTeamReward.js';
import { redeemMemberReward } from '#a/domains/reward/handlers/redeemMemberReward.js';
import { addGroupMembers } from '#a/domains/room/handlers/addGroupMembers.js';
import { createGroup } from '#a/domains/room/handlers/createGroup.js';
import { deleteGroup } from '#a/domains/room/handlers/deleteGroup.js';
import { generateZegoTokenEndpoint } from '#a/domains/room/handlers/generateZegoTokenEndpoint.js';
import { getGroups } from '#a/domains/room/handlers/getGroups.js';
import { updateGroup } from '#a/domains/room/handlers/updateGroup.js';
import { createTask } from '#a/domains/task/handlers/createTask.js';
import { createTaskCommentary } from '#a/domains/task/handlers/createTaskCommentary.js';
import { createTaskStep } from '#a/domains/task/handlers/createTaskStep.js';
import { deleteTask } from '#a/domains/task/handlers/deleteTask.js';
import { deleteTaskCommentary } from '#a/domains/task/handlers/deleteTaskCommentary.js';
import { deleteTaskStep } from '#a/domains/task/handlers/deleteTaskStep.js';
import { getMyValidTaskIds } from '#a/domains/task/handlers/getMyValidTaskIds.js';
import { getTaskCommentaries } from '#a/domains/task/handlers/getTaskCommentaries.js';
import { getTasks } from '#a/domains/task/handlers/getTasks.js';
import { getTaskSteps } from '#a/domains/task/handlers/getTaskSteps.js';
import { getReportsKpiHandler } from '#a/domains/task/handlers/getReportsKpi.js';
import { getReportsOverviewHandler } from '#a/domains/task/handlers/getReportsOverview.js';
import { rolloverTask } from '#a/domains/task/handlers/rolloverTask.js';
import { toggleTaskStep } from '#a/domains/task/handlers/toggleTaskStep.js';
import { updateTask } from '#a/domains/task/handlers/updateTask.js';
import { updateTaskCommentary } from '#a/domains/task/handlers/updateTaskCommentary.js';
import { updateTaskStep } from '#a/domains/task/handlers/updateTaskStep.js';
import { createInvitationCode } from '#a/domains/team/handlers/createInvitationCode.js';
import { createTeam } from '#a/domains/team/handlers/createTeam.js';
import { deleteTeam } from '#a/domains/team/handlers/deleteTeam.js';
import { getMyTeams } from '#a/domains/team/handlers/getMyTeams.js';
import { getTeamInvitePreview } from '#a/domains/team/handlers/getTeamInvitePreview.js';
import { getTeamMembers } from '#a/domains/team/handlers/getTeamMembers.js';
import { inviteTeamMember } from '#a/domains/team/handlers/inviteTeamMember.js';
import { joinTeamWithInviteCode } from '#a/domains/team/handlers/joinTeamWithInviteCode.js';
import { removeTeamMember } from '#a/domains/team/handlers/removeTeamMember.js';
import { updateTeam } from '#a/domains/team/handlers/updateTeam.js';
import { updateTeamMemberRole } from '#a/domains/team/handlers/updateTeamMemberRole.js';
import { getQuote } from '#a/domains/quotes/handlers/getQuote.js';
import { environmentInteract } from '#a/domains/team/handlers/environmentInteract.js';
import { getProfile } from '#a/domains/user/handlers/getProfile.js';
import { mirrorAvatar } from '#a/domains/user/handlers/mirrorAvatar.js';
import { getUserPreview } from '#a/domains/user/handlers/getUserPreview.js';
import { generateDescriptionHandler } from '#a/domains/ai/handlers/generateDescription.js';
import { requireSystem } from '#a/systemAuth.js';
import { EqupoError } from '#a/types/EqupoError.js';
import { createUserRateLimitMiddleware } from '#a/utils/index.js';
import cors from 'cors';
import express, {
  Application,
  ErrorRequestHandler,
  NextFunction,
  Request,
  Response,
  Router,
} from 'express';
import winston from 'winston';

export const app: Application = express();

app.use(
  cors({
    origin(origin, callback) {
      if (!origin || config.allowedOrigins.includes(origin)) {
        callback(null, true);
        return;
      }
      callback(new Error(`Origin not allowed: ${origin}`));
    },
    credentials: true,
  })
);
app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

const api: Router = express.Router();
const userRateLimit = createUserRateLimitMiddleware(config.rateLimit);

api.get('/health', (_req, res) => {
  res.json({ ok: true, prefix: config.apiPrefix });
});

api.get('/quotes/random', requireUser, userRateLimit, getQuote);

api.get('/teams/me', requireUser, getMyTeams);

// ── GET /teams/invite-preview ── Preview team info from invite code ────────
api.get(
  '/teams/invite-preview',
  requireUser,
  userRateLimit,
  getTeamInvitePreview
);

api.get('/users/me/profile', requireUser, getProfile);
api.get('/users/me/profile', requireUser, getProfile);
api.post('/users/me/avatar/mirror', requireUser, userRateLimit, mirrorAvatar);

api.post(
  '/teams/:teamId/environment/interact',
  requireUser,
  userRateLimit,
  environmentInteract
);

api.post(
  '/teams/:teamId/environment/interact',
  requireUser,
  userRateLimit,
  environmentInteract
);

// ── GET /users/preview ── Preview user info by UID ───────────────────────────
api.get('/users/preview', requireUser, userRateLimit, getUserPreview);

api.post('/teams', requireUser, userRateLimit, createTeam);

// ── POST /teams/:teamId/invitation-codes ── Create invitation code ──────────
api.post(
  '/teams/:teamId/invitation-codes',
  requireUser,
  userRateLimit,
  createInvitationCode
);

// ── POST /teams/join ── Join a team using an invitation code ────────────────
api.post('/teams/join', requireUser, userRateLimit, joinTeamWithInviteCode);

api.patch('/teams/:teamId', requireUser, userRateLimit, updateTeam);

api.post(
  '/teams/:teamId/members',
  requireUser,
  userRateLimit,
  inviteTeamMember
);

api.patch(
  '/teams/:teamId/members/:userUid/role',
  requireUser,
  userRateLimit,
  updateTeamMemberRole
);

// ── DELETE /teams/:teamId/members/:userUid ── Kick a team member ─────────────
api.delete(
  '/teams/:teamId/members/:userUid',
  requireUser,
  userRateLimit,
  removeTeamMember
);

// ── DELETE /teams/:teamId ── Delete the entire team ──────────────────────────
api.delete('/teams/:teamId', requireUser, userRateLimit, deleteTeam);

// ── Shop / Rewards ────────────────────────────────────────────────────────────
api.get('/teams/:teamId/rewards', requireUser, userRateLimit, listRewards);
api.post('/teams/:teamId/rewards', requireUser, userRateLimit, createReward);
api.patch(
  '/teams/:teamId/rewards/:rewardId',
  requireUser,
  userRateLimit,
  updateReward
);
api.delete(
  '/teams/:teamId/rewards/:rewardId',
  requireUser,
  userRateLimit,
  deleteReward
);
api.post(
  '/teams/:teamId/rewards/:rewardId/purchase-team',
  requireUser,
  userRateLimit,
  purchaseTeamReward
);
api.post(
  '/teams/:teamId/rewards/:rewardId/purchase-member',
  requireUser,
  userRateLimit,
  purchaseMemberReward
);
api.post(
  '/teams/:teamId/rewards/:rewardId/redeem-team',
  requireUser,
  userRateLimit,
  redeemTeamReward
);
api.post(
  '/teams/:teamId/users/:userUid/rewards/:rewardId/redeem',
  requireUser,
  userRateLimit,
  redeemMemberReward
);

api.post(
  '/teams/:teamId/achievements/unlocks',
  requireUser,
  userRateLimit,
  unlockAchievement
);

api.get(
  '/teams/:teamId/achievements',
  requireUser,
  userRateLimit,
  getAchievements
);

api.post('/teams/:teamId/tasks', requireUser, userRateLimit, createTask);

api.patch(
  '/teams/:teamId/tasks/:taskId',
  requireUser,
  userRateLimit,
  updateTask
);

api.get('/teams/:teamId/members', requireUser, userRateLimit, getTeamMembers);

api.get('/teams/:teamId/groups', requireUser, userRateLimit, getGroups);

api.post('/teams/:teamId/groups', requireUser, userRateLimit, createGroup);

api.post(
  '/teams/:teamId/groups/:groupId/members',
  requireUser,
  userRateLimit,
  addGroupMembers
);

api.patch(
  '/teams/:teamId/groups/:groupId',
  requireUser,
  userRateLimit,
  updateGroup
);

api.delete(
  '/teams/:teamId/groups/:groupId',
  requireUser,
  userRateLimit,
  deleteGroup
);

api.post(
  '/teams/:teamId/rooms/:roomId/zego-token',
  requireUser,
  userRateLimit,
  generateZegoTokenEndpoint
);

api.get('/teams/:teamId/tasks', requireUser, userRateLimit, getTasks);

api.get(
  '/teams/:teamId/reports/kpi',
  requireUser,
  userRateLimit,
  getReportsKpiHandler
);

api.get(
  '/teams/:teamId/reports/overview',
  requireUser,
  userRateLimit,
  getReportsOverviewHandler
);

api.delete(
  '/teams/:teamId/tasks/:taskId',
  requireUser,
  userRateLimit,
  deleteTask
);

// ─────────────────────────────────────────────────────────────────────────────
// Task Steps
// ─────────────────────────────────────────────────────────────────────────────

api.get(
  '/teams/:teamId/tasks/:taskId/steps',
  requireUser,
  userRateLimit,
  getTaskSteps
);

api.post(
  '/teams/:teamId/tasks/:taskId/steps',
  requireUser,
  userRateLimit,
  createTaskStep
);

api.patch(
  '/teams/:teamId/tasks/:taskId/steps/:stepId/toggle',
  requireUser,
  userRateLimit,
  toggleTaskStep
);

api.patch(
  '/teams/:teamId/tasks/:taskId/steps/:stepId',
  requireUser,
  userRateLimit,
  updateTaskStep
);

api.delete(
  '/teams/:teamId/tasks/:taskId/steps/:stepId',
  requireUser,
  userRateLimit,
  deleteTaskStep
);

// ─────────────────────────────────────────────────────────────────────────────
// Task Recurring Rollover
// ─────────────────────────────────────────────────────────────────────────────

api.post(
  '/teams/:teamId/tasks/:taskId/rollover',
  requireUser,
  userRateLimit,
  rolloverTask
);

// ─────────────────────────────────────────────────────────────────────────────
// Task Commentaries
// ─────────────────────────────────────────────────────────────────────────────

api.get(
  '/teams/:teamId/tasks/:taskId/commentaries',
  requireUser,
  userRateLimit,
  getTaskCommentaries
);

api.post(
  '/teams/:teamId/tasks/:taskId/commentaries',
  requireUser,
  userRateLimit,
  createTaskCommentary
);

api.patch(
  '/teams/:teamId/tasks/:taskId/commentaries/:commentaryId',
  requireUser,
  userRateLimit,
  updateTaskCommentary
);

api.delete(
  '/teams/:teamId/tasks/:taskId/commentaries/:commentaryId',
  requireUser,
  userRateLimit,
  deleteTaskCommentary
);

api.get(
  '/teams/:teamId/tasks/my-valid-ids',
  requireUser,
  userRateLimit,
  getMyValidTaskIds
);

api.post(
  '/internal/teams/:teamId/achievements',
  requireSystem,
  createAchievement
);
api.post('/internal/users/:userUid/rewards', requireSystem, grantSystemReward);

api.post(
  '/ai/generate-description',
  requireUser,
  userRateLimit,
  generateDescriptionHandler
);

app.use(config.apiPrefix, api);

const errorHandler: ErrorRequestHandler = (
  error: EqupoError,
  _req: Request,
  res: Response,
  _next: NextFunction
) => {
  const status = Number(error.status || 500);
  if (status >= 500) {
    winston.error('Server error:', error);
  }

  const payload: { error: string; details?: EqupoError['details'] } = {
    error: error.message || 'Internal server error',
  };
  if (error.details) {
    payload.details = error.details;
  }

  res.status(status).json(payload);
};

app.use(errorHandler);
