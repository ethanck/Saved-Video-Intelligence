/**
 * Client configuration is public runtime configuration only. Authentication and
 * provider credentials must never be placed in this Expo bundle. The Firebase
 * values below are public client configuration; service-account and provider
 * credentials remain server-only.
 */
export const apiBaseUrl = process.env.EXPO_PUBLIC_API_URL ?? "http://127.0.0.1:8787";
export const developmentUserId = process.env.EXPO_PUBLIC_DEV_USER_ID ?? "demo-user";

export const firebaseClientConfig = {
  apiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.EXPO_PUBLIC_FIREBASE_APP_ID,
};

export const firebaseAuthConfigured = Object.values(firebaseClientConfig).every(
  (value) => typeof value === "string" && value.length > 0,
);

export const localDevelopmentApi = /^http:\/\/(localhost|127\.0\.0\.1)(?::\d+)?$/i.test(apiBaseUrl);

