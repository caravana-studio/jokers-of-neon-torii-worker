import admin from 'firebase-admin';
import { readFileSync } from 'fs';
import { join } from 'path';
import { env } from '../env.js';

let initialized = false;

export function initFirebaseIfNeeded(): void {
  if (initialized || !env.NOTIFICATIONS_ENABLED) {
    return;
  }

  let serviceAccount: object;
  if (env.FIREBASE_CREDENTIALS_JSON) {
    serviceAccount = JSON.parse(env.FIREBASE_CREDENTIALS_JSON);
  } else if (env.FIREBASE_CREDENTIALS_PATH) {
    const credentialsPath = join(process.cwd(), env.FIREBASE_CREDENTIALS_PATH);
    serviceAccount = JSON.parse(readFileSync(credentialsPath, 'utf-8'));
  } else {
    throw new Error('NOTIFICATIONS_ENABLED=true requires FIREBASE_CREDENTIALS_JSON or FIREBASE_CREDENTIALS_PATH');
  }

  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount as admin.ServiceAccount),
  });
  initialized = true;
  console.log('[firebase] initialized');
}

export function getFirebaseAdmin(): typeof admin {
  initFirebaseIfNeeded();
  return admin;
}
