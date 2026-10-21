import assert from "node:assert/strict";
import test from "node:test";
import type { CaptureRecord, CaptureStage, ProcessingJob, TranscriptRecord } from "@svi/shared-types";
import type { TranscriptProvider } from "../packages/processing/src/index.js";
import { TranscriptFallbackChain } from "../packages/processing/src/index.js";
import { PublicCaptionsTranscriptProvider, TranscriptionStageHandler } from "../workers/transcription-worker/src/index.js";

function capture(): CaptureRecord {
  return {
    id: "capture-1",
    userId: "user-1",
    originalUrl: "https://example.com/video",
    platform: "web",
    status: "transcribing",
    currentStage: "transcribing",
    retryCount: 0,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function job(): ProcessingJob {
  return {
    id: "job-1",
    captureId: "capture-1",
    userId: "user-1",
    status: "running",
    stage: "transcribing",
    retryCount: 0,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

test("transcript fallback uses the next method after a provider failure", async () => {
  const attempts: string[] = [];
  const providers: TranscriptProvider[] = [
    {
      method: "public_captions",
      provider: "captions-adapter",
      transcribe: async () => {
        attempts.push("captions");
        throw new Error("captions unavailable");
      },
    },
    {
      method: "permitted_media_asr",
      provider: "primary-asr",
      transcribe: async () => {
        attempts.push("primary-asr");
        return { text: "A recovered transcript.", source: "downloaded_media" as const, provider: "primary-asr" };
      },
    },
  ];

  const result = await new TranscriptFallbackChain(providers).run({ capture: capture() }, new Date("2026-01-01T01:00:00.000Z"));

  assert.equal(result.kind, "success");
  if (result.kind !== "success") return;
  assert.deepEqual(attempts, ["captions", "primary-asr"]);
  assert.equal(result.transcript.text, "A recovered transcript.");
  assert.equal(result.transcript.attempts.length, 2);
  assert.equal(result.transcript.attempts[0]?.status, "failed");
  assert.equal(result.transcript.attempts[1]?.status, "succeeded");
});

test("public captions provider reads bounded WebVTT tracks without downloading media", async () => {
  let requestedUrl = "";
  const provider = new PublicCaptionsTranscriptProvider({
    fetchImpl: async (input, init) => {
      requestedUrl = String(input);
      assert.equal(init?.method, "GET");
      assert.equal(init?.redirect, "manual");
      return new Response(`WEBVTT

00:00.000 --> 00:01.500
Hello <b>world</b>.

00:01.500 --> 00:03.000
A second cue.`);
    },
  });

  const result = await provider.transcribe({
    capture: { ...capture(), metadata: { captionsUrl: "https://cdn.example.test/captions.vtt" } },
  });

  assert.equal(requestedUrl, "https://cdn.example.test/captions.vtt");
  assert.equal(result.source, "captions");
  assert.equal(result.provider, "public-webvtt");
  assert.equal(result.text, "Hello world. A second cue.");
  assert.deepEqual(result.segments, [
    { startMs: 0, endMs: 1500, text: "Hello world." },
    { startMs: 1500, endMs: 3000, text: "A second cue." },
  ]);
});

test("transcription handler persists a successful fallback transcript", async () => {
  let saved: TranscriptRecord | undefined;
  const repository = {
    claimNextQueuedJob: async (_stage: CaptureStage) => undefined,
    getCapture: async () => capture(),
    updateCapture: async (value: CaptureRecord) => value,
    updateJob: async (value: ProcessingJob) => value,
    saveTranscript: async (value: TranscriptRecord) => { saved = value; return value; },
  };
  const handler = new TranscriptionStageHandler(repository, [{
    method: "public_captions",
    provider: "captions-adapter",
    transcribe: async () => ({ text: "Caption transcript.", source: "captions" as const, provider: "captions-adapter" }),
  }]);

  const result = await handler.process({ capture: capture(), job: job() });

  assert.deepEqual(result, { kind: "advance", patch: { transcriptSource: "captions" } });
  assert.equal(saved?.text, "Caption transcript.");
});

test("transcription handler routes all-provider failure to manual review", async () => {
  const repository = {
    claimNextQueuedJob: async (_stage: CaptureStage) => undefined,
    getCapture: async () => capture(),
    updateCapture: async (value: CaptureRecord) => value,
    updateJob: async (value: ProcessingJob) => value,
    saveTranscript: async (value: TranscriptRecord) => value,
  };
  const handler = new TranscriptionStageHandler(repository, [{
    method: "public_captions",
    provider: "captions-adapter",
    transcribe: async () => { throw new Error("not available"); },
  }]);

  const result = await handler.process({ capture: capture(), job: job() });

  assert.deepEqual(result, {
    kind: "needs_review",
    reason: "All permitted transcript methods failed. Add a manual transcript or retry later.",
    patch: { transcriptSource: "failed_unavailable" },
  });
});
