/** Shared mobile/web API client construction and future session handoff. */
import { ApiClient, type ApiClientOptions } from "@svi/api-client";
import { apiBaseUrl, developmentUserId } from "./config";

/** Auth values supplied by the eventual Firebase session provider. */
export type MobileAuthSession = Pick<ApiClientOptions, "userId" | "getIdToken">;

/**
 * Create the transport used by both Expo native and Expo web screens.
 *
 * Until the mobile sign-in UI is wired, the default is deliberately limited to
 * the local development identity. Production callers should pass only a
 * Firebase ID-token provider and omit `userId`.
 */
export function createMobileApiClient(session: MobileAuthSession = { userId: developmentUserId }): ApiClient {
  return new ApiClient({ baseUrl: apiBaseUrl, ...session });
}

