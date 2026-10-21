/** Firebase ID-token verification with a development-only header fallback. */
import type { IncomingMessage } from "node:http";
import { getAuth } from "firebase-admin/auth";
import { getFirebaseApp } from "./firebase.js";

export class AuthenticationError extends Error {
  constructor(message = "Invalid authentication token.") {
    super(message);
    this.name = "AuthenticationError";
  }
}

export interface Authenticator {
  authenticate(request: IncomingMessage): Promise<string | undefined>;
}

/**
 * Verify Firebase bearer tokens in production. Local development keeps the
 * existing x-user-id header so API tests and offline work do not need cloud auth.
 */
export class FirebaseAuthenticator implements Authenticator {
  async authenticate(request: IncomingMessage): Promise<string | undefined> {
    const authorization = request.headers.authorization;
    if (typeof authorization === "string" && authorization.startsWith("Bearer ")) {
      const token = authorization.slice("Bearer ".length).trim();
      if (!token) throw new AuthenticationError();
      try {
        const decoded = await getAuth(getFirebaseApp()).verifyIdToken(token);
        return decoded.uid;
      } catch {
        throw new AuthenticationError();
      }
    }

    if (process.env.NODE_ENV !== "production") {
      const developmentUserId = request.headers["x-user-id"];
      if (typeof developmentUserId === "string" && developmentUserId.trim()) return developmentUserId.trim();
    }
    return undefined;
  }
}
