/** Input validation and safe URL extraction for capture requests. */
import type { CaptureInput } from "./domain.js";

const urlPattern = /https?:\/\/[^\s<>{}|\\^`]+/i;

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

/** Normalize an untrusted request body into the shared capture input shape. */
export function parseCaptureInput(value: unknown): CaptureInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ValidationError("Capture payload must be a JSON object.");
  }

  const body = value as Record<string, unknown>;
  const url = optionalString(body.url, "url");
  const text = optionalString(body.text, "text");
  const title = optionalString(body.title, "title");
  const caption = optionalString(body.caption, "caption");
  const sourceApp = optionalString(body.sourceApp, "sourceApp");
  const resolvedUrl = url ?? extractUrl(text);

  if ("mediaFileName" in body) {
    throw new ValidationError("Only links are saved. Video files may be processed temporarily but are never persisted.");
  }

  if (!resolvedUrl) {
    throw new ValidationError("Provide a public URL or text containing a URL.");
  }

  if (resolvedUrl) {
    validatePublicUrl(resolvedUrl);
  }

  return {
    ...(resolvedUrl ? { url: resolvedUrl } : {}),
    ...(text ? { text } : {}),
    ...(title ? { title } : {}),
    ...(caption ? { caption } : {}),
    ...(sourceApp ? { sourceApp } : {}),
  };
}

/** Validate the manual transcript fallback submitted after automated failures. */
export function parseManualTranscriptInput(value: unknown): { text: string } {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ValidationError("Transcript payload must be a JSON object.");
  }
  const text = optionalString((value as Record<string, unknown>).text, "text");
  if (!text) throw new ValidationError("Transcript text is required.");
  if (text.length > 500_000) throw new ValidationError("Transcript text is too long.");
  return { text };
}

/** Validate the explicit user decision for a GitHub repository suggestion. */
export function parseGitHubRepositorySelectionInput(value: unknown): { decision: "accept" | "reject"; fullName?: string } {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ValidationError("Repository selection payload must be a JSON object.");
  }
  const body = value as Record<string, unknown>;
  if (body.decision !== "accept" && body.decision !== "reject") {
    throw new ValidationError("Repository decision must be accept or reject.");
  }
  if (body.decision === "reject") return { decision: "reject" };
  const fullName = optionalString(body.fullName, "fullName");
  if (!fullName || !/^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/.test(fullName)) {
    throw new ValidationError("fullName must be a valid GitHub owner/name reference.");
  }
  return { decision: "accept", fullName };
}

function optionalString(value: unknown, field: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") throw new ValidationError(`${field} must be a string.`);
  const trimmed = value.trim();
  if (trimmed.length > 10_000) throw new ValidationError(`${field} is too long.`);
  return trimmed || undefined;
}

function extractUrl(text: string | undefined): string | undefined {
  const match = text?.match(urlPattern)?.[0];
  return match?.replace(/[),.;!?]+$/, "");
}

function validatePublicUrl(value: string): void {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new ValidationError("url must be a valid HTTP or HTTPS URL.");
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new ValidationError("Only HTTP and HTTPS URLs are supported.");
  }
  if (!parsed.hostname || parsed.hostname === "localhost" || parsed.hostname.endsWith(".local")) {
    throw new ValidationError("Local or private hosts are not accepted as capture sources.");
  }
}
