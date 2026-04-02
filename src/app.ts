import cors from 'cors';
import express, { Application, Router } from 'express';
import { requireUser } from './auth.js';
import { requireSystem } from './systemAuth.js';
import { withTransaction } from './db.js';
import { config } from './config.js';
import { assertBody } from '@/utils';
import {
  assertTeamLeaderPermission,
  assertTeamPermission,
  assertUserBelongsToTeam,
} from '@/domains/team/guards';
import { createAchievementSchema } from '@/domains/achievement/schemas';
import { createSystemUserRewardSchema } from './domains/reward/schemas/index.js';
import {
  createTeamRewardSchema,
  createTeamSchema,
  inviteTeamMemberSchema,
  teamIdParam,
  teamMemberParam,
  updateTeamMemberRoleSchema,
  updateTeamSchema,
} from '@/domains/team/schemas';
import winston from 'winston';
import { ERROR_STATUS, SUCCESS_STATUS } from './constants/httpStatusCodes';
import { EqupoError } from '@/types/EqupoError';
import { AuthenticatedRequest } from '@/types/AuthenticatedRequest';

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

api.get('/health', (_req, res) => {
  res.json({ ok: true, prefix: config.apiPrefix });
});

api.post(
  '/teams',
  requireUser,
  async (req: AuthenticatedRequest, res, next) => {
    try {
      const input = assertBody(createTeamSchema, req.body);
      const actorUid = req.user.uid;

      const team = await withTransaction(async client => {
        const teamResult = await client.query(
          `INSERT INTO public.team (name, leader_uid, virtual_currency, description, created_at, updated_at)
         VALUES ($1, $2, $3, $4, NOW(), NOW()) RETURNING id, name, leader_uid, virtual_currency, description`,
          [
            input.name,
            actorUid,
            input.virtualCurrency,
            input.description ?? null,
          ]
        );

        await client.query(
          `INSERT INTO public.team_membership (user_uid, team_id, role, joined_at)
         VALUES ($1, $2, 'leader', NOW())
         ON CONFLICT (user_uid, team_id) DO UPDATE SET role = 'leader'`,
          [actorUid, teamResult.rows[0].id]
        );

        return teamResult.rows[0];
      });

      res.status(201).json({ team });
    } catch (error) {
      next(error);
    }
  }
);

api.patch('/teams/:teamId', requireUser, async (req, res, next) => {
  try {
    const { teamId } = teamIdParam.parse(req.params);
    const input = assertBody(updateTeamSchema, req.body);

    if (!Object.keys(input).length) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    const team = await withTransaction(async client => {
      await assertTeamPermission(client, teamId, req.user.uid);

      const updates: string[] = [];
      const values: any[] = [];
      let index = 1;

      if (input.name !== undefined) {
        updates.push(`name = $${index++}`);
        values.push(input.name);
      }
      if (input.description !== undefined) {
        updates.push(`description = $${index++}`);
        values.push(input.description);
      }
      if (input.virtualCurrency !== undefined) {
        updates.push(`virtual_currency = $${index++}`);
        values.push(input.virtualCurrency);
      }

      updates.push('updated_at = NOW()');
      values.push(teamId);

      const result = await client.query(
        `UPDATE public.team SET ${updates.join(', ')} WHERE id = $${index} RETURNING id, name, leader_uid, virtual_currency, description, updated_at`,
        values
      );

      return result.rows[0];
    });

    return res.json({ team });
  } catch (error) {
    return next(error);
  }
});

api.post('/teams/:teamId/members', requireUser, async (req, res, next) => {
  try {
    const { teamId } = teamIdParam.parse(req.params);
    const input = assertBody(inviteTeamMemberSchema, req.body);

    const membership = await withTransaction(async client => {
      await assertTeamPermission(client, teamId, req.user.uid);

      const result = await client.query(
        `INSERT INTO public.team_membership (user_uid, team_id, role, joined_at)
         VALUES ($1, $2, $3, NOW())
         ON CONFLICT (user_uid, team_id)
         DO NOTHING
         RETURNING user_uid, team_id, role`,
        [input.userUid, teamId, input.role]
      );

      if (!result.rowCount) {
        const error = new EqupoError(
          'User is already a member of this team. Use role-change endpoint to modify role.'
        );
        error.status = ERROR_STATUS.CONFLICT;
        throw error;
      }

      return result.rows[0];
    });

    return res.status(SUCCESS_STATUS.CREATED).json({ membership });
  } catch (error) {
    return next(error);
  }
});

api.patch(
  '/teams/:teamId/members/:userUid/role',
  requireUser,
  async (req, res, next) => {
    try {
      const { teamId, userUid } = teamMemberParam.parse(req.params);
      const input = assertBody(updateTeamMemberRoleSchema, req.body);

      const membership = await withTransaction(async client => {
        await assertTeamLeaderPermission(client, teamId, req.user.uid);

        const result = await client.query(
          `UPDATE public.team_membership
         SET role = $3
         WHERE team_id = $1 AND user_uid = $2
         RETURNING user_uid, team_id, role`,
          [teamId, userUid, input.role]
        );

        if (!result.rowCount) {
          const error = new EqupoError('Team membership not found');
          error.status = ERROR_STATUS.NOT_FOUND;
          throw error;
        }

        return result.rows[0];
      });

      return res.json({ membership });
    } catch (error) {
      return next(error);
    }
  }
);

api.post('/teams/:teamId/rewards', requireUser, async (req, res, next) => {
  try {
    const { teamId } = teamIdParam.parse(req.params);
    const input = assertBody(createTeamRewardSchema, req.body);

    const teamReward = await withTransaction(async client => {
      await assertTeamPermission(client, teamId, req.user.uid);

      const result = await client.query(
        `INSERT INTO public.team_reward (team_id, reward_id, date_obtained, created_at, updated_at)
         VALUES ($1, $2, COALESCE($3::timestamptz, NOW()), NOW(), NOW())
         ON CONFLICT (team_id, reward_id)
         DO UPDATE SET updated_at = NOW()
         RETURNING team_id, reward_id, date_obtained, updated_at`,
        [teamId, input.rewardId, input.dateObtained ?? null]
      );

      return result.rows[0];
    });

    return res.status(SUCCESS_STATUS.CREATED).json({ teamReward });
  } catch (error) {
    return next(error);
  }
});

api.post('/teams/:teamId/achievements', requireUser, async (req, res, next) => {
  try {
    const { teamId } = teamIdParam.parse(req.params);
    const input = assertBody(createAchievementSchema, req.body);

    const achievement = await withTransaction(async client => {
      await assertTeamPermission(client, teamId, req.user.uid);
      await assertUserBelongsToTeam(client, teamId, input.userUid);

      const result = await client.query(
        `INSERT INTO public.achievement (user_uid, name, description, icon_url, unlocked_at, created_at, updated_at)
         VALUES ($1, $2, $3, $4, COALESCE($5::timestamptz, NOW()), NOW(), NOW())
         RETURNING id, user_uid, name, unlocked_at`,
        [
          input.userUid,
          input.name,
          input.description ?? null,
          input.iconURL ?? null,
          input.unlockedAt ?? null,
        ]
      );

      return result.rows[0];
    });

    return res.status(201).json({ achievement });
  } catch (error) {
    return next(error);
  }
});

api.post(
  '/internal/users/:userUid/rewards',
  requireSystem,
  async (req, res, next) => {
    try {
      const input = assertBody(createSystemUserRewardSchema, req.body);
      const { userUid } = req.params;

      const userReward = await withTransaction(async client => {
        const result = await client.query(
          `INSERT INTO public.user_reward (user_uid, reward_id, date_obtained, created_at, updated_at)
         VALUES ($1, $2, COALESCE($3::timestamptz, NOW()), NOW(), NOW())
         ON CONFLICT (user_uid, reward_id)
         DO UPDATE SET updated_at = NOW()
         RETURNING user_uid, reward_id, date_obtained, updated_at`,
          [userUid, input.rewardId, input.dateObtained ?? null]
        );
        return result.rows[0];
      });

      return res.status(201).json({ userReward });
    } catch (error) {
      return next(error);
    }
  }
);

app.use(config.apiPrefix, api);

app.use((error, _req, res) => {
  const status = Number(error.status || 500);
  if (status >= 500) {
    winston.error('Server error:', error);
  }

  const payload = { error: error.message || 'Internal server error' };
  if (error.details) {
    payload.details = error.details;
  }

  res.status(status).json(payload);
});
