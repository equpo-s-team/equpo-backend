import type admin from 'firebase-admin';

export type AuthenticatedUser = {
  uid: string;
  claims: admin.auth.DecodedIdToken;
};
