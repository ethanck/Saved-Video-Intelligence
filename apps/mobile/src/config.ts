/**
 * Client configuration is public runtime configuration only. Authentication and
 * provider credentials must never be placed in this Expo bundle.
 */
export const apiBaseUrl = process.env.EXPO_PUBLIC_API_URL ?? "http://127.0.0.1:8787";
export const developmentUserId = process.env.EXPO_PUBLIC_DEV_USER_ID ?? "demo-user";

