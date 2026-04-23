import { createHash } from 'node:crypto';

import { getFirestoreDb } from '#a/firebaseAdmin.js';
import { buildTaskFirestoreDocument } from './taskFirestoreMapper.js';
import type { TaskFirestoreSyncInput } from './taskFirestoreMapper.js';

export type StepFirestoreDoc = {
  step: string;
  isDone: boolean;
  position: number;
  createdAt: Date;
  updatedAt: Date;
};

export type CommentaryFirestoreDoc = {
  userUid: string;
  displayName: string | null;
  photoURL: string | null;
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
  await taskDocumentRef(teamId, taskId).set({ steps: stepsMap }, { merge: true });
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
  await taskDocumentRef(teamId, taskId).set({ commentaries: map }, { merge: true });
}
