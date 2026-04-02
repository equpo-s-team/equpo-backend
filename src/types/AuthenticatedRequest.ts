import admin from 'firebase-admin';
import { Request } from 'express';

export interface AuthenticatedRequest extends Request {
  user: {
    uid: string;
    claims: admin.auth.DecodedIdToken;
  };
}

if (!admin.apps.length) {
  admin.initializeApp();
}
