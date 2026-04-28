import { getFirestoreDb } from '#a/firebaseAdmin.js';
import { FieldValue } from 'firebase-admin/firestore';

/**
 * Creates a chatRoom document in Firestore linked to a group.
 * The chatRoom ID equals the groupId for 1:1 mapping.
 */
export async function createChatRoomInFirestore(
  teamId: string,
  groupId: string,
  name: string,
  createdBy: string
): Promise<void> {
  const db = getFirestoreDb();
  await db
    .collection('teams')
    .doc(teamId)
    .collection('chatRooms')
    .doc(groupId)
    .set({
      name,
      type: 'group',
      createdBy,
      createdAt: FieldValue.serverTimestamp(),
    });
}

/**
 * Adds a member to a chatRoom's members subcollection in Firestore.
 * This mirrors the group_membership in PostgreSQL.
 */
export async function addChatRoomMemberInFirestore(
  teamId: string,
  groupId: string,
  userUid: string,
  role: string
): Promise<void> {
  const db = getFirestoreDb();
  await db
    .collection('teams')
    .doc(teamId)
    .collection('chatRooms')
    .doc(groupId)
    .collection('members')
    .doc(userUid)
    .set(
      {
        role,
        addedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
}

/**
 * Removes a member from a chatRoom in Firestore.
 */
export async function removeChatRoomMemberFromFirestore(
  teamId: string,
  groupId: string,
  userUid: string
): Promise<void> {
  const db = getFirestoreDb();
  await db
    .collection('teams')
    .doc(teamId)
    .collection('chatRooms')
    .doc(groupId)
    .collection('members')
    .doc(userUid)
    .delete();
}

/**
 * Inserts a system message into a chatRoom.
 * Only the backend (Admin SDK) can create system messages;
 * the frontend security rules block type: 'system' from clients.
 */
export async function insertSystemMessage(
  teamId: string,
  groupId: string,
  text: string
): Promise<void> {
  const db = getFirestoreDb();
  await db
    .collection('teams')
    .doc(teamId)
    .collection('chatRooms')
    .doc(groupId)
    .collection('messages')
    .add({
      senderUid: 'system',
      senderName: 'Sistema',
      text,
      createdAt: FieldValue.serverTimestamp(),
      type: 'system',
      deleted: false,
    });
}

/**
 * Updates a chatRoom document in Firestore.
 */
export async function updateChatRoomInFirestore(
  teamId: string,
  groupId: string,
  data: { name?: string; photoUrl?: string }
): Promise<void> {
  const db = getFirestoreDb();
  await db
    .collection('teams')
    .doc(teamId)
    .collection('chatRooms')
    .doc(groupId)
    .set(data, { merge: true });
}

/**
 * Deletes a chatRoom document and its subcollections (members, messages) from Firestore.
 */
export async function deleteChatRoomFromFirestore(
  teamId: string,
  groupId: string
): Promise<void> {
  const db = getFirestoreDb();
  const roomRef = db
    .collection('teams')
    .doc(teamId)
    .collection('chatRooms')
    .doc(groupId);

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
