/** Lazy Firebase Admin initialization shared by authentication and Firestore. */
import { cert, getApps, initializeApp, type App } from "firebase-admin/app";

/** Return the configured Firebase Admin app without initializing it during tests. */
export function getFirebaseApp(): App {
  const existingApp = getApps()[0];
  if (existingApp) return existingApp;

  const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (serviceAccountJson) {
    const serviceAccount = JSON.parse(serviceAccountJson) as { projectId: string; clientEmail: string; privateKey: string };
    return initializeApp({
      credential: cert({
        projectId: serviceAccount.projectId,
        clientEmail: serviceAccount.clientEmail,
        privateKey: serviceAccount.privateKey.replace(/\\n/g, "\n"),
      }),
      projectId: serviceAccount.projectId,
    });
  }

  return initializeApp({ projectId: process.env.FIREBASE_PROJECT_ID ?? "saved-video-intelligence" });
}
