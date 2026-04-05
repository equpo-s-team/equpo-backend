import { getFirestoreDb } from '#a/firebaseAdmin.js';
import { buildTaskFirestoreDocument } from './taskFirestoreMapper.js';
import type { TaskFirestoreSyncInput } from './taskFirestoreMapper.js';

function taskDocumentRef(teamId: string, taskId: string) {
  return getFirestoreDb().collection(teamId).doc(taskId);
}

export async function upsertTaskInFirestore(input: TaskFirestoreSyncInput) {
  const payload = buildTaskFirestoreDocument(input);
  await taskDocumentRef(input.teamId, input.taskId).set(payload, {
    merge: true,
  });
}

export async function deleteTaskFromFirestore(teamId: string, taskId: string) {
  await taskDocumentRef(teamId, taskId).delete();
}
