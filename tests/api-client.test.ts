import assert from "node:assert/strict";
import test from "node:test";
import { ApiClient, ApiClientError } from "../packages/api-client/src/index.js";
import type { CaptureRecord, ProcessingJob } from "@svi/shared-types";

const capture: CaptureRecord = {
  id: "capture-1",
  userId: "user-1",
  originalUrl: "https://example.com/video",
  platform: "web",
  status: "failed",
  currentStage: "failed",
  retryCount: 0,
  errorMessage: "Source unavailable.",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const job: ProcessingJob = {
  id: "job-1",
  captureId: capture.id,
  userId: capture.userId,
  status: "queued",
  stage: "received",
  retryCount: 1,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

/** Verify the platform-neutral client without opening a network connection. */
test("ApiClient sends authenticated retry requests and returns the queued capture", async () => {
  let requestUrl = "";
  let requestInit: RequestInit | undefined;
  const client = new ApiClient({
    baseUrl: "https://api.example.test/",
    userId: "user-1",
    fetchImpl: async (input, init) => {
      requestUrl = String(input);
      requestInit = init;
      return new Response(JSON.stringify({ capture: { ...capture, status: "received", currentStage: "received", retryCount: 1 }, job }), {
        headers: { "content-type": "application/json" },
        status: 202,
      });
    },
  });

  const response = await client.retryCapture(capture.id);

  assert.equal(requestUrl, "https://api.example.test/v1/captures/capture-1/retry");
  assert.equal(requestInit?.method, "POST");
  assert.equal(new Headers(requestInit?.headers).get("x-user-id"), "user-1");
  assert.equal(response.capture.retryCount, 1);
  assert.equal(response.job.status, "queued");
});

test("ApiClient exposes structured API errors", async () => {
  const client = new ApiClient({
    baseUrl: "https://api.example.test",
    userId: "user-1",
    fetchImpl: async () => new Response(JSON.stringify({ error: { message: "Capture not found." } }), {
      headers: { "content-type": "application/json" },
      status: 404,
    }),
  });

  await assert.rejects(
    client.getCapture("missing"),
    (error: unknown) => error instanceof ApiClientError && error.status === 404 && error.message === "Capture not found.",
  );
});

test("ApiClient explains network failures with the configured API URL", async () => {
  const client = new ApiClient({
    baseUrl: "http://127.0.0.1:8787",
    fetchImpl: async () => {
      throw new TypeError("Failed to fetch");
    },
  });

  await assert.rejects(
    client.listCaptures(),
    (error: unknown) => error instanceof ApiClientError
      && error.status === 0
      && error.message === "Could not reach the API at http://127.0.0.1:8787. Failed to fetch",
  );
});

test("ApiClient can send a Firebase ID token without a development identity header", async () => {
  let requestInit: RequestInit | undefined;
  const client = new ApiClient({
    baseUrl: "https://api.example.test",
    getIdToken: async () => "firebase-token",
    fetchImpl: async (_input, init) => {
      requestInit = init;
      return new Response(JSON.stringify({ captures: [] }), {
        headers: { "content-type": "application/json" },
        status: 200,
      });
    },
  });

  await client.listCaptures();

  const headers = new Headers(requestInit?.headers);
  assert.equal(headers.get("authorization"), "Bearer firebase-token");
  assert.equal(headers.get("x-user-id"), null);
});
