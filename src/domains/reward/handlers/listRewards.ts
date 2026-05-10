import { withTransaction } from '#a/db.js';
import { assertTeamMembership } from '#a/domains/team/guards/index.js';
import { teamIdParam } from '#a/domains/team/schemas/index.js';
import { getActorUid, logEndpointAudit } from '#a/utils/index.js';
import { RequestHandler } from 'express';

export const listRewards: RequestHandler = async (req, res, next) => {
  const actorUid = req.user?.uid ?? null;
  let teamId: string | null = null;
  try {
    ({ teamId } = teamIdParam.parse(req.params));
    const parsedTeamId = teamId;
    const authenticatedActorUid = getActorUid(req);

    const { rewards, myMembershipCurrency } = await withTransaction(
      async client => {
        await assertTeamMembership(client, parsedTeamId, authenticatedActorUid);

        const rewardsResult = await client.query(
          `SELECT r.id,
                r.name,
                r.cost,
                r.experience_granted   AS "experienceGranted",
                r.type,
                r.description,
                r.icon_u_r_l           AS "iconURL",
                r.created_at           AS "createdAt",
                r.updated_at           AS "updatedAt",
                tr.date_obtained       AS "teamRewardObtainedAt",
                tr.redeemed_at         AS "teamRewardRedeemedAt",
                (SELECT json_agg(json_build_object(
                  'userUid',      ur.user_uid,
                  'displayName',  u.display_name,
                  'photoUrl',     u.photo_u_r_l,
                  'dateObtained', ur.date_obtained,
                  'redeemedAt',   ur.redeemed_at
                ) ORDER BY ur.date_obtained ASC)
                 FROM public.user_reward ur
                 JOIN public."user" u ON u.uid = ur.user_uid
                 WHERE ur.reward_id = r.id
                ) AS "memberLedger"
           FROM public.reward r
           LEFT JOIN LATERAL (
             SELECT date_obtained, redeemed_at
               FROM public.team_reward
              WHERE reward_id = r.id AND team_id = $1
              ORDER BY date_obtained DESC
              LIMIT 1
           ) tr ON true
           WHERE r.team_id = $1
           ORDER BY r.created_at DESC`,
          [parsedTeamId]
        );

        const membershipResult = await client.query(
          `SELECT virtual_currency AS "virtualCurrency"
           FROM public.team_membership
           WHERE team_id = $1 AND user_uid = $2
           LIMIT 1`,
          [parsedTeamId, authenticatedActorUid]
        );

        const myMembershipCurrency =
          membershipResult.rows[0]?.virtualCurrency ?? null;

        return { rewards: rewardsResult.rows, myMembershipCurrency };
      }
    );

    logEndpointAudit({
      operation: 'teams.rewards.list',
      outcome: 'success',
      actorUid: authenticatedActorUid,
      teamId: parsedTeamId,
    });

    return res.json({ rewards, myMembershipCurrency });
  } catch (error) {
    logEndpointAudit({
      operation: 'teams.rewards.list',
      outcome: 'error',
      actorUid,
      teamId,
      error,
    });
    return next(error);
  }
};
