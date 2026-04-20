import admin from 'firebase-admin';
import dotenv from 'dotenv';

dotenv.config();

const DEFAULT_EXPECTED_PROJECT_ID = 'equpo1';

function normalize(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function resolveProjectIdFromFirebaseConfig(): string | null {
  const rawConfig = normalize(process.env.FIREBASE_CONFIG);
  if (!rawConfig) {
    return null;
  }

  try {
    if (rawConfig.startsWith('{')) {
      const parsed = JSON.parse(rawConfig) as { projectId?: string };
      return normalize(parsed.projectId);
    }
  } catch {
    return null;
  }

  return null;
}

function resolveActiveProjectId(): string | null {
  return (
    normalize(process.env.GOOGLE_CLOUD_PROJECT) ||
    normalize(process.env.GCLOUD_PROJECT) ||
    normalize(process.env.FIREBASE_PROJECT_ID) ||
    resolveProjectIdFromFirebaseConfig()
  );
}

if (!admin.apps.length) {
  const envProjectId = resolveActiveProjectId() || DEFAULT_EXPECTED_PROJECT_ID;
  const expectedProjectId =
    normalize(process.env.FIREBASE_PROJECT_ID_EXPECTED) ||
    DEFAULT_EXPECTED_PROJECT_ID;
  const storageBucket =
    normalize(process.env.FIREBASE_STORAGE_BUCKET) || undefined;

  admin.initializeApp({
    projectId: envProjectId,
    storageBucket,
  });

  const activeProjectId =
    normalize(admin.app().options.projectId) || envProjectId;

  if (!activeProjectId) {
    throw new Error(
      'Firebase project id is missing. Set GOOGLE_CLOUD_PROJECT/GCLOUD_PROJECT or FIREBASE_CONFIG before starting the backend.'
    );
  }

  if (activeProjectId !== expectedProjectId) {
    throw new Error(
      `Firebase project mismatch. Expected "${expectedProjectId}" but got "${activeProjectId}".`
    );
  }
}

export function getFirebaseAdmin() {
  return admin;
}

export function getFirebaseAuth() {
  return admin.auth();
}

export function getFirestoreDb() {
  return admin.firestore();
}

export function getStorageBucket() {
  const configuredBucket = normalize(process.env.FIREBASE_STORAGE_BUCKET);
  if (configuredBucket) {
    return admin.storage().bucket(configuredBucket);
  }

  return admin.storage().bucket();
}
