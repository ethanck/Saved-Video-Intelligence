/** Shared mobile/web API client construction and Firebase session handoff. */
import { useMemo } from "react";
import { ApiClient, type ApiClientOptions } from "@svi/api-client";
import { apiBaseUrl, developmentUserId } from "./config";
import { useAuth } from "./auth";

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

/** Build a client for the current user; local development is the only header fallback. */
export function useMobileApiClient(): ApiClient {
  const { configured, user } = useAuth();
  const session = useMemo<MobileAuthSession>(() => {
    if (user) return { getIdToken: () => user.getIdToken() };
    return configured ? {} : { userId: developmentUserId };
  }, [configured, user]);
  return useMemo(() => createMobileApiClient(session), [session]);
}

