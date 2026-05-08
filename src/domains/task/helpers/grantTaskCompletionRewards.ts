import type { PoolClient } from 'pg';

import { checkAchievementsOnTaskComplete } from '#a/domains/achievement/schemas/index.js';
import {
  COIN_REWARDS,
  XP_REWARDS,
  calculateLevel,
} from '#a/domains/user/xpUtils.js';

export interface TaskCompletionInput {
  client: PoolClient;
  teamId: string;
  taskId: string;
  actorUid: string;
  taskPriority: string;
  assignedUserUid: string | null;
  assignedGroupId: string | null;
}

type RecipientResult = {
  uid: string;
  xpGained: number;
  userCoinsGained: number;
  membershipCoinsGained: number;
  newXp: number;
  newLevel: number;
  newUserVirtualCurrency: number;
  newMembershipVirtualCurrency: number | null;
  leveledUp: boolean;
};

export interface TaskCompletionResult {
  xpReward: {
    xpGained: number;
    coinsGained: number;
    userCoinsGained: number;
    newXp: number;
    newLevel: number;
    newUserVirtualCurrency: number;
    leveledUp: boolean;
    recipients: RecipientResult[];
  };
  unlockedAchievements: Array<{
    id: string;
    name: string;
    description: string | null;
    iconUrl: string | null;
    unlockedAt: string;
  }>;
}

export async function grantTaskCompletionRewards({
  client,
  teamId,
  taskId,
  actorUid,
  taskPriority,
  assignedUserUid,
  assignedGroupId,
}: TaskCompletionInput): Promise<TaskCompletionResult> {
  const priority = taskPriority ?? 'medium';
  const xpAmount =
    XP_REWARDS[priority as keyof typeof XP_REWARDS] ?? XP_REWARDS.medium;
  const userCoinAmount = Math.floor(
    (COIN_REWARDS[priority as keyof typeof COIN_REWARDS] ??
      COIN_REWARDS.medium) / 2
  );
  const teamCoinAmount =
    COIN_REWARDS[priority as keyof typeof COIN_REWARDS] ?? COIN_REWARDS.medium;

  // Build the de-duplicated recipient list from assigned user + group members.
  // Fall back to the actor for unassigned tasks.
  const recipientUids = new Set<string>();
  if (assignedUserUid) recipientUids.add(assignedUserUid);
  if (assignedGroupId) {
    const groupRows = await client.query(
      `SELECT user_uid FROM public.group_membership WHERE group_id = $1`,
      [assignedGroupId]
    );
    for (const r of groupRows.rows as { user_uid: string }[]) {
      recipientUids.add(r.user_uid);
    }
  }
  if (recipientUids.size === 0) recipientUids.add(actorUid);

  const recipientResults: RecipientResult[] = [];

  for (const uid of recipientUids) {
    const userResult = await client.query(
      `UPDATE public."user"
         SET experience_points = COALESCE(experience_points, 0) + $1,
             virtual_currency = COALESCE(virtual_currency, 0) + $3,
             updated_at = NOW()
         WHERE uid = $2
         RETURNING experience_points, level, virtual_currency`,
      [xpAmount, uid, userCoinAmount]
    );

    const newTotalXp = Number(userResult.rows[0]?.experience_points ?? 0);
    const newLevel = calculateLevel(newTotalXp);
    const oldLevel = Number(userResult.rows[0]?.level ?? 0);
    const leveledUp = newLevel > oldLevel;

    if (leveledUp) {
      await client.query(
        `UPDATE public."user" SET level = $1, updated_at = NOW() WHERE uid = $2`,
        [newLevel, uid]
      );
    }

    // Credit the per-user-per-team membership wallet.
    // Leaders may not have a team_membership row — skip silently if so.
    const membershipResult = await client.query(
      `UPDATE public.team_membership
         SET virtual_currency = COALESCE(virtual_currency, 0) + $1
         WHERE user_uid = $2 AND team_id = $3
         RETURNING virtual_currency`,
      [userCoinAmount, uid, teamId]
    );
    const newMembershipVirtualCurrency =
      membershipResult.rowCount && membershipResult.rowCount > 0
        ? Number(membershipResult.rows[0].virtual_currency)
        : null;

    recipientResults.push({
      uid,
      xpGained: xpAmount,
      userCoinsGained: userCoinAmount,
      membershipCoinsGained: userCoinAmount,
      newXp: newTotalXp,
      newLevel,
      newUserVirtualCurrency: Number(userResult.rows[0]?.virtual_currency ?? 0),
      newMembershipVirtualCurrency,
      leveledUp,
    });
  }

  // Grant coins to the team once regardless of recipient count.
  await client.query(
    `UPDATE public.team
       SET virtual_currency = COALESCE(virtual_currency, 0) + $1,
           updated_at = NOW()
       WHERE id = $2`,
    [teamCoinAmount, teamId]
  );

  // Check achievements for the actor.
  const actorResult = recipientResults.find(r => r.uid === actorUid);
  const unlockedAchievements = await checkAchievementsOnTaskComplete({
    client,
    userUid: actorUid,
    teamId,
    taskId,
    newLevel: actorResult?.newLevel ?? 0,
    assignedUserUid,
    assignedGroupId,
  });

  // Legacy top-level fields from the actor's entry (or first recipient).
  const legacy = actorResult ?? recipientResults[0];

  return {
    xpReward: {
      xpGained: xpAmount,
      coinsGained: teamCoinAmount,
      userCoinsGained: legacy?.userCoinsGained ?? userCoinAmount,
      newXp: legacy?.newXp ?? 0,
      newLevel: legacy?.newLevel ?? 0,
      newUserVirtualCurrency: legacy?.newUserVirtualCurrency ?? 0,
      leveledUp: legacy?.leveledUp ?? false,
      recipients: recipientResults,
    },
    unlockedAchievements,
  };
}
