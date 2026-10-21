import assert from "node:assert/strict";
import test from "node:test";
import type { CaptureResponse } from "@svi/api-client";
import type { CaptureInput } from "@svi/shared-types";
import { saveSource } from "../apps/mobile/src/libraryActions.js";

const queuedResponse: CaptureResponse = {
  capture: {
    id: "capture-button-test",
    userId: "demo-user",
    originalUrl: "https://www.youtube.com/watch?v=button-test",
    platform: "youtube",
    status: "received",
    currentStage: "received",
    retryCount: 0,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  },
  job: {
    id: "job-button-test",
    captureId: "capture-button-test",
    userId: "demo-user",
    status: "queued",
    stage: "received",
    retryCount: 0,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  },
};

test("Save button action submits the trimmed source and receives a queued capture", async () => {
  let submitted: CaptureInput | undefined;
  const response = await saveSource({
    createCapture: async (input) => {
      submitted = input;
      return queuedResponse;
    },
  }, "  https://www.youtube.com/watch?v=button-test  ", "web");

  assert.deepEqual(submitted, {
    url: "https://www.youtube.com/watch?v=button-test",
    sourceApp: "web",
  });
  assert.equal(response?.capture.id, "capture-button-test");
  assert.equal(response?.job.status, "queued");
});

test("Save button action does not submit an empty source", async () => {
  let called = false;
  const response = await saveSource({
    createCapture: async () => {
      called = true;
      return queuedResponse;
    },
  }, "   ", "web");

  assert.equal(response, undefined);
  assert.equal(called, false);
});
