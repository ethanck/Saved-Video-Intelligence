/** Local polling entry point for the metadata worker. */
// Relative source imports keep the compiled Node runner pointed at the matching
// files under `dist/`; the package names remain for workspace consumers.
import { PublicMetadataExtractor } from "../../../packages/ingestion/src/index.js";
import { MetadataWorker } from "../../../workers/metadata-worker/src/index.js";
import { JsonFileRepository } from "./repository.js";

const dataFile = process.env.DATA_FILE ?? "./data/local-store.json";
const pollIntervalMs = Number(process.env.WORKER_POLL_INTERVAL_MS ?? "1000");
const repository = new JsonFileRepository(dataFile);
const worker = new MetadataWorker(repository, new PublicMetadataExtractor({
  timeoutMs: Number(process.env.METADATA_FETCH_TIMEOUT_MS ?? "10000"),
  maxBytes: Number(process.env.METADATA_MAX_BYTES ?? "262144"),
}));
let running = false;

async function poll(): Promise<void> {
  if (running) return;
  running = true;
  try {
    const result = await worker.runOnce();
    if (result.processed) console.log(`Metadata worker processed ${result.captureId}; next stage: ${result.nextStage}`);
  } catch (error) {
    console.error("Metadata worker poll failed", error);
  } finally {
    running = false;
  }
}

const interval = setInterval(() => void poll(), pollIntervalMs);
void poll();

function shutdown(): void {
  clearInterval(interval);
  process.exit(0);
}

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
