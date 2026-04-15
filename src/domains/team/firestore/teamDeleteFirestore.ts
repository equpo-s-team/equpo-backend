import { getFirebaseAdmin, getFirestoreDb } from '#a/firebaseAdmin.js';

/**
 * Recursively deletes all Firestore documents and subcollections
 * under teams/{teamId}: members, chatRooms (with members + messages), and the team doc.
 */
export async function deleteTeamFromFirestore(teamId: string): Promise<void> {
  const db = getFirestoreDb();
  const teamRef = db.collection('teams').doc(teamId);

  // 1. Delete all chatRooms and their subcollections
  const chatRoomsSnapshot = await teamRef.collection('chatRooms').get();
  for (const chatRoomDoc of chatRoomsSnapshot.docs) {
    const roomRef = chatRoomDoc.ref;

    // Delete room members
    const membersSnapshot = await roomRef.collection('members').get();
    const memberDeletes = membersSnapshot.docs.map(d => d.ref.delete());
    await Promise.all(memberDeletes);

    // Delete room messages
    const messagesSnapshot = await roomRef.collection('messages').get();
    const messageDeletes = messagesSnapshot.docs.map(d => d.ref.delete());
    await Promise.all(messageDeletes);

    // Delete the chatRoom doc itself
    await roomRef.delete();
  }

  // 2. Delete all team members docs
  const membersSnapshot = await teamRef.collection('members').get();
  const memberDeletes = membersSnapshot.docs.map(d => d.ref.delete());
  await Promise.all(memberDeletes);

  // 3. Delete the team doc itself
  await teamRef.delete();
}

/**
 * Deletes all Firebase Storage files under the teams/{teamId}/ prefix.
 * This covers the team profile image and all chatRoom uploads.
 */
export async function deleteTeamStorageFiles(teamId: string): Promise<void> {
  const admin = getFirebaseAdmin();
  const bucket = admin.storage().bucket();
  const prefix = `teams/${teamId}/`;

  try {
    await bucket.deleteFiles({ prefix });
  } catch {
    // Silently ignore if no files exist (e.g., team never had uploads)
  }
}
