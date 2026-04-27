import { withTransaction } from '#a/db.js';
import {
  addChatRoomMemberInFirestore,
  createChatRoomInFirestore,
  insertSystemMessage,
} from '#a/domains/room/firestore/index.js';
import { upsertTeamMembershipInFirestore } from '#a/domains/team/firestore/teamMembershipFirestore.js';
import { createTeamSchema } from '#a/domains/team/schemas/index.js';
import { assertBody, getActorUid, logEndpointAudit } from '#a/utils/index.js';
import { RequestHandler } from 'express';

export const createTeam: RequestHandler = async (req, res, next) => {
  const actorUid = req.user?.uid ?? null;
  try {
    const input = assertBody(createTeamSchema, req.body);
    const authenticatedActorUid = getActorUid(req);

    const team = await withTransaction(async client => {
      const teamResult = await client.query(
        `INSERT INTO public.team (name, leader_uid, virtual_currency, description, created_at, updated_at)
         VALUES ($1, $2, $3, $4, NOW(), NOW()) RETURNING id, name, leader_uid, virtual_currency, description`,
        [
          input.name,
          authenticatedActorUid,
          input.virtualCurrency,
          input.description ?? null,
        ]
      );

      await client.query(
        `INSERT INTO public.team_membership (user_uid, team_id, role, joined_at)
         VALUES ($1, $2, 'leader', NOW())
         ON CONFLICT (user_uid, team_id) DO UPDATE SET role = 'leader'`,
        [authenticatedActorUid, teamResult.rows[0].id]
      );

      return teamResult.rows[0];
    });

    await upsertTeamMembershipInFirestore(
      team.id as string,
      authenticatedActorUid,
      'leader'
    );

    // Auto-create "General" group + chatRoom
    const generalGroup = await withTransaction(async client => {
      const groupResult = await client.query(
        `INSERT INTO public."group" (team_id, group_name) VALUES ($1, 'General') RETURNING id`,
        [team.id]
      );
      const groupId = groupResult.rows[0].id as string;

      await client.query(
        `INSERT INTO public.group_membership (group_id, user_uid) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [groupId, authenticatedActorUid]
      );

      return { id: groupId };
    });

    await createChatRoomInFirestore(
      team.id as string,
      generalGroup.id,
      'General',
      authenticatedActorUid
    );
    await addChatRoomMemberInFirestore(
      team.id as string,
      generalGroup.id,
      authenticatedActorUid,
      'leader'
    );
    await insertSystemMessage(
      team.id as string,
      generalGroup.id,
      '🎉 Grupo "General" creado'
    );

    logEndpointAudit({
      operation: 'teams.create',
      outcome: 'success',
      actorUid: authenticatedActorUid,
      teamId: team.id as string,
    });

    res.status(201).json({ team });
  } catch (error) {
    logEndpointAudit({
      operation: 'teams.create',
      outcome: 'error',
      actorUid,
      error,
    });
    next(error);
  }
};
