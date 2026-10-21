/** Domain factories and platform detection for saved captures. */
import { randomUUID } from "node:crypto";
import type { CaptureInput, CaptureRecord, CaptureStage, ProcessingJob } from "@svi/shared-types";
export type { CaptureInput, CaptureRecord, CaptureStage, LocalStore, ProcessingJob, TranscriptSource } from "@svi/shared-types";

/** Create the initial capture record before asynchronous processing begins. */
export function createCapture(userId: string, input: CaptureInput, now = new Date()): CaptureRecord {
  const platform = input.url ? detectPlatform(input.url) : "upload";
  const timestamp = now.toISOString();

  return {
    id: randomUUID(),
    userId,
    ...(input.url ? { originalUrl: input.url } : {}),
    platform,
    ...(input.title ? { title: input.title } : {}),
    ...(input.caption ? { caption: input.caption } : {}),
    ...(input.sourceApp ? { sourceApp: input.sourceApp } : {}),
    status: "received",
    currentStage: "received",
    retryCount: 0,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

/** Create the first queued processing job for a capture. */
export function createProcessingJob(capture: CaptureRecord, now = new Date(), stage: CaptureStage = capture.currentStage): ProcessingJob {
  const timestamp = now.toISOString();

  return {
    id: randomUUID(),
    captureId: capture.id,
    userId: capture.userId,
    status: "queued",
    stage,
    retryCount: capture.retryCount,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

/** Map a source URL to the provider label shown in the Inbox. */
export function detectPlatform(url: string): string {
  const hostname = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  if (hostname === "tiktok.com" || hostname.endsWith(".tiktok.com")) return "tiktok";
  if (hostname === "instagram.com" || hostname.endsWith(".instagram.com")) return "instagram";
  if (hostname === "youtube.com" || hostname === "youtu.be" || hostname.endsWith(".youtube.com")) return "youtube";
  if (hostname === "x.com" || hostname === "twitter.com" || hostname.endsWith(".x.com")) return "x";
  return "web";
}
