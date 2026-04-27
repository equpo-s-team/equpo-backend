import { pool } from '#a/db.js';
import { getActorUid } from '#a/utils/index.js';
import { RequestHandler } from 'express';

export const getMyTeams: RequestHandler = async (req, res, next) => {
  try {
    const actorUid = getActorUid(req);

    const result = await pool.query(
      `SELECT
         t.id,
         t.name,
         t.leader_uid       AS "leaderUid",
         t.virtual_currency AS "virtualCurrency",
         t.description,
         t.photo_u_r_l      AS "photoUrl",
         t.created_at       AS "createdAt",
         t.updated_at       AS "updatedAt",
         COALESCE(
           json_agg(
             json_build_object(
               'userUid',     tm.user_uid,
               'role',        tm.role,
               'joinedAt',    tm.joined_at,
               'displayName', u.display_name
             )
           ) FILTER (WHERE tm.user_uid IS NOT NULL),
           '[]'
         ) AS members
       FROM public.team t
       INNER JOIN public.team_membership me
         ON me.team_id = t.id AND me.user_uid = $1
       LEFT JOIN public.team_membership tm
         ON tm.team_id = t.id
       LEFT JOIN public."user" u
         ON u.uid = tm.user_uid
       GROUP BY t.id
       ORDER BY t.created_at DESC`,
      [actorUid]
    );

    return res.json({ teams: result.rows });
  } catch (error) {
    return next(error);
  }
};
