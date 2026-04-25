export { buildTaskFirestoreDocument } from './taskFirestoreMapper.js';
export type { TaskFirestoreSyncInput } from './taskFirestoreMapper.js';
export {
  upsertTaskInFirestore,
  patchTaskStatusInFirestore,
  patchTaskRolloverInFirestore,
  deleteTaskFromFirestore,
  patchStepsInFirestore,
  patchCommentariesInFirestore,
} from './taskFirestoreSync.js';
export type {
  StepFirestoreDoc,
  CommentaryFirestoreDoc,
} from './taskFirestoreSync.js';
export {
  upsertCommentaryInFirestore,
  updateCommentaryInFirestore,
  deleteCommentaryFromFirestore,
} from './commentaryFirestoreSync.js';
