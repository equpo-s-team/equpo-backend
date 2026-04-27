import { ERROR_STATUS, SUCCESS_STATUS } from '#a/constants/httpStatusCodes.js';
import { pool, withTransaction } from '#a/db.js';
import {
  addChatRoomMemberInFirestore,
  createChatRoomInFirestore,
  insertSystemMessage,
} from '#a/domains/room/firestore/index.js';
import { createGroupSchema } from '#a/domains/room/schemas/index.js';
import {
  assertTeamPermission,
  assertUserBelongsToTeam,
} from '#a/domains/team/guards/index.js';
import { teamIdParam } from '#a/domains/team/schemas/index.js';
import { EqupoError } from '#a/types/EqupoError.js';
import { assertBody, getActorUid, logEndpointAudit } from '#a/utils/index.js';
import { getFirestoreDb } from '#a/firebaseAdmin.js';
import { RequestHandler } from 'express';

export const createGroup: RequestHandler = async (req, res, next) => {
  const actorUid = req.user?.uid ?? null;
  let teamId: string | null = null;
  try {
    ({ teamId } = teamIdParam.parse(req.params));
    const parsedTeamId = teamId;
    const input = assertBody(createGroupSchema, req.body);
    const authenticatedActorUid = getActorUid(req);

    const group = await withTransaction(async client => {
      await assertTeamPermission(client, parsedTeamId, authenticatedActorUid);

      const memberUids = input.memberUids ?? [];

      // Validate each member: must belong to team and must NOT be a spectator
      for (const uid of memberUids) {
        await assertUserBelongsToTeam(client, parsedTeamId, uid);
        const roleResult = await client.query(
          `SELECT role FROM public.team_membership WHERE team_id = $1 AND user_uid = $2 LIMIT 1`,
          [parsedTeamId, uid]
        );
        if (roleResult.rows[0]?.role === 'spectator') {
          throw new EqupoError(
            'Spectators cannot be added to work groups',
            ERROR_STATUS.VALIDATION
          );
        }
      }

      const groupResult = await client.query(
        `INSERT INTO public."group" (team_id, group_name, photo_u_r_l)
         VALUES ($1, $2, $3)
         RETURNING id, group_name AS "groupName", photo_u_r_l AS "photoUrl"`,
        [parsedTeamId, input.name, input.photoUrl ?? null]
      );
      const createdGroup = groupResult.rows[0];

      await client.query(
        `INSERT INTO public.group_membership (group_id, user_uid) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [createdGroup.id, authenticatedActorUid]
      );

      for (const uid of memberUids) {
        if (uid !== authenticatedActorUid) {
          await client.query(
            `INSERT INTO public.group_membership (group_id, user_uid) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
            [createdGroup.id, uid]
          );
        }
      }

      return createdGroup;
    });

    await createChatRoomInFirestore(
      parsedTeamId,
      group.id as string,
      input.name,
      authenticatedActorUid
    );

    // Persist photoUrl on the Firestore chatRoom document
    if (input.photoUrl) {
      const db = getFirestoreDb();
      await db
        .collection('teams')
        .doc(parsedTeamId)
        .collection('chatRooms')
        .doc(group.id as string)
        .update({ photoUrl: input.photoUrl });
    }

    await addChatRoomMemberInFirestore(
      parsedTeamId,
      group.id as string,
      authenticatedActorUid,
      'creator'
    );

    const memberUids = input.memberUids ?? [];
    for (const uid of memberUids) {
      if (uid !== authenticatedActorUid) {
        await addChatRoomMemberInFirestore(
          parsedTeamId,
          group.id as string,
          uid,
          'member'
        );
      }
    }

    const creatorResult = await pool.query(
      `SELECT display_name FROM public."user" WHERE uid = $1 LIMIT 1`,
      [authenticatedActorUid]
    );
    const creatorName =
      (creatorResult.rows[0]?.display_name as string | null) ??
      authenticatedActorUid;
    await insertSystemMessage(
      parsedTeamId,
      group.id as string,
      `🎉 Grupo "${input.name}" creado por ${creatorName}`
    );

    logEndpointAudit({
      operation: 'teams.groups.create',
      outcome: 'success',
      actorUid: authenticatedActorUid,
      teamId: parsedTeamId,
    });

    return res.status(SUCCESS_STATUS.CREATED).json({ group });
  } catch (error) {
    logEndpointAudit({
      operation: 'teams.groups.create',
      outcome: 'error',
      actorUid,
      teamId,
      error,
    });
    return next(error);
  }
};
