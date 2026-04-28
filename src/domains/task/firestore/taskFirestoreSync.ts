import { createHash } from 'node:crypto';

import { getFirestoreDb } from '#a/firebaseAdmin.js';
import type { TaskFirestoreSyncInput } from './taskFirestoreMapper.js';
import { buildTaskFirestoreDocument } from './taskFirestoreMapper.js';

export type StepFirestoreDoc = {
  step: string;
  isDone: boolean;
  position: number;
  createdAt: Date;
  updatedAt: Date;
};

export type CommentaryFirestoreDoc = {
  userUid: string;
  commentary: string;
  createdAt: Date;
  updatedAt: Date;
};

function taskDocumentRef(teamId: string, taskId: string) {
  return getFirestoreDb().collection(teamId).doc(taskId);
}

export async function upsertTaskInFirestore(input: TaskFirestoreSyncInput) {
  const payload = buildTaskFirestoreDocument(input);
  await taskDocumentRef(input.teamId, input.taskId).set(payload, {
    merge: true,
  });
}

export async function patchTaskStatusInFirestore(
  teamId: string,
  taskId: string,
  status: string
) {
  await taskDocumentRef(teamId, taskId).set(
    { status, updatedAt: new Date() },
    { merge: true }
  );
}

export async function patchTaskRolloverInFirestore(
  teamId: string,
  taskId: string,
  nextDueDate: Date
): Promise<void> {
  await taskDocumentRef(teamId, taskId).set(
    { status: 'todo', dueDate: nextDueDate, updatedAt: new Date() },
    { merge: true }
  );
}

export async function deleteTaskFromFirestore(teamId: string, taskId: string) {
  await taskDocumentRef(teamId, taskId).delete();
}

export async function patchStepsInFirestore(
  teamId: string,
  taskId: string,
  steps: StepFirestoreDoc[]
): Promise<void> {
  const stepsMap: Record<string, StepFirestoreDoc> = {};
  for (const s of steps) {
    stepsMap[s.step] = s;
  }
  // Replace the entire steps field so removed keys are dropped.
  // set({ steps }, { merge: true }) deep-merges the map and leaves
  // stale keys behind when a step is deleted.
  await taskDocumentRef(teamId, taskId).update({ steps: stepsMap });
}

export async function patchCommentariesInFirestore(
  teamId: string,
  taskId: string,
  commentaries: CommentaryFirestoreDoc[]
): Promise<void> {
  const map: Record<string, CommentaryFirestoreDoc> = {};
  for (const c of commentaries) {
    const key = createHash('sha256')
      .update(`${taskId}::${c.userUid}::${c.createdAt.toISOString()}`)
      .digest('hex')
      .slice(0, 20);
    map[key] = c;
  }
  await taskDocumentRef(teamId, taskId).update({ commentaries: map });
}
