import { withTransaction } from '#a/db.js';
import { reportOverviewQuery } from '#a/domains/task/schemas/index.js';
import { getReportDateRange, getReportsKpi } from '#a/domains/task/utils.js';
import { assertTeamMembership } from '#a/domains/team/guards/index.js';
import { teamIdParam } from '#a/domains/team/schemas/index.js';
import { getActorUid, logEndpointAudit } from '#a/utils/index.js';
import { RequestHandler } from 'express';

export const getReportsKpiHandler: RequestHandler = async (req, res, next) => {
  const actorUid = req.user?.uid ?? null;
  let teamId: string | null = null;
  try {
    ({ teamId } = teamIdParam.parse(req.params));
    const parsedTeamId = teamId;
    const authenticatedActorUid = getActorUid(req);
    const { days } = reportOverviewQuery.parse(req.query);
    const { rangeStart, rangeEnd } = getReportDateRange(days);

    const payload = await withTransaction(async client => {
      await assertTeamMembership(client, parsedTeamId, authenticatedActorUid);

      const roleResult = await client.query(
        `SELECT role
           FROM public.team_membership
           WHERE team_id = $1 AND user_uid = $2
           LIMIT 1`,
        [parsedTeamId, authenticatedActorUid]
      );

      const kpi = await getReportsKpi(
        client,
        parsedTeamId,
        rangeStart,
        rangeEnd
      );

      const teamResult = await client.query(
        `SELECT environment_health FROM public.team WHERE id = $1 LIMIT 1`,
        [parsedTeamId]
      );
      const environmentHealth = Number(
        teamResult.rows[0]?.environment_health ?? 60
      );

      return {
        kpi,
        environmentHealth,
        meta: {
          teamId: parsedTeamId,
          days,
          rangeStart: rangeStart.toISOString(),
          rangeEnd: rangeEnd.toISOString(),
          generatedAt: new Date().toISOString(),
          actorRole: (roleResult.rows[0]?.role as string | undefined) ?? null,
        },
      };
    });

    logEndpointAudit({
      operation: 'reports.kpi',
      outcome: 'success',
      actorUid: authenticatedActorUid,
      teamId: parsedTeamId,
    });

    return res.json(payload);
  } catch (error) {
    logEndpointAudit({
      operation: 'reports.kpi',
      outcome: 'error',
      actorUid,
      teamId,
      error,
    });
    return next(error);
  }
};
