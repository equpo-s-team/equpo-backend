import { createHash } from 'node:crypto';
import { getFirestoreDb } from '#a/firebaseAdmin.js';

function commentaryDocId(taskId: string, commentary: string): string {
  return createHash('sha256')
    .update(`${taskId}::${commentary}`)
    .digest('hex')
    .slice(0, 20);
}

function commentaryDocRef(teamId: string, taskId: string, commentary: string) {
  return getFirestoreDb()
    .collection(teamId)
    .doc(taskId)
    .collection('commentaries')
    .doc(commentaryDocId(taskId, commentary));
}

export async function upsertCommentaryInFirestore(input: {
  teamId: string;
  taskId: string;
  commentary: string;
  userUid: string;
  displayName: string | null;
  photoURL: string | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  await commentaryDocRef(input.teamId, input.taskId, input.commentary).set({
    taskId: input.taskId,
    userUid: input.userUid,
    displayName: input.displayName,
    photoURL: input.photoURL,
    commentary: input.commentary,
    createdAt: input.createdAt,
    updatedAt: input.updatedAt,
  });
}

export async function updateCommentaryInFirestore(input: {
  teamId: string;
  taskId: string;
  oldCommentary: string;
  newCommentary: string;
  updatedAt: Date;
}) {
  const oldRef = commentaryDocRef(input.teamId, input.taskId, input.oldCommentary);
  const oldSnap = await oldRef.get();
  const oldData = oldSnap.data() ?? {};
  await oldRef.delete();
  await commentaryDocRef(input.teamId, input.taskId, input.newCommentary).set({
    ...oldData,
    commentary: input.newCommentary,
    updatedAt: input.updatedAt,
  });
}

export async function deleteCommentaryFromFirestore(
  teamId: string,
  taskId: string,
  commentary: string,
) {
  await commentaryDocRef(teamId, taskId, commentary).delete();
}
