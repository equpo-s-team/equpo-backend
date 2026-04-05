import { getFirestoreDb } from '#a/firebaseAdmin.js';

/**
 * Upserts a team membership placeholder document in Firestore.
 * This document is strictly used to allow Firestore Security Rules
 * to verify if a user belongs to a team, acting as a mirror of Postgres.
 */
export async function upsertTeamMembershipInFirestore(
  teamId: string,
  userUid: string,
  role: string
): Promise<void> {
  const db = getFirestoreDb();
  await db
    .collection('teams')
    .doc(teamId)
    .collection('members')
    .doc(userUid)
    .set(
      {
        role,
        updatedAt: new Date().toISOString(),
      },
      { merge: true }
    );
}

/**
 * Deletes a team membership document from Firestore.
 */
export async function deleteTeamMembershipFromFirestore(
  teamId: string,
  userUid: string
): Promise<void> {
  const db = getFirestoreDb();
  await db
    .collection('teams')
    .doc(teamId)
    .collection('members')
    .doc(userUid)
    .delete();
}
