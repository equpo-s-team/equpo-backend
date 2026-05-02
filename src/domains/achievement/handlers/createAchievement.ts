import { withTransaction } from '#a/db.js';
import { createAchievementSchema } from '#a/domains/achievement/schemas/index.js';
import { teamIdParam } from '#a/domains/team/schemas/index.js';
import { assertBody, logEndpointAudit } from '#a/utils/index.js';
import { RequestHandler } from 'express';

export const createAchievement: RequestHandler = async (req, res, next) => {
  const actorUid = 'system';
  let teamId: string | null = null;
  try {
    ({ teamId } = teamIdParam.parse(req.params));
    const parsedTeamId = teamId;
    const input = assertBody(createAchievementSchema, req.body);

    const achievement = await withTransaction(async client => {
      // System-only endpoint: no user membership check needed
      const result = await client.query(
        `INSERT INTO public.achievement (name, description, icon_url, created_at, updated_at)
         VALUES ($1, $2, $3, NOW(), NOW())
         RETURNING id, name, description, icon_url, created_at, updated_at`,
        [input.name, input.description ?? null, input.iconURL ?? null]
      );

      return result.rows[0];
    });

    logEndpointAudit({
      operation: 'teams.achievements.create',
      outcome: 'success',
      actorUid,
      teamId: parsedTeamId,
    });

    return res.status(201).json({ achievement });
  } catch (error) {
    logEndpointAudit({
      operation: 'teams.achievements.create',
      outcome: 'error',
      actorUid,
      teamId,
      error,
    });
    return next(error);
  }
};
