/** Transcription-stage handler with ordered backend fallback providers. */
import { isIP } from "node:net";
import type { TranscriptCandidate, TranscriptInput } from "../../../packages/processing/src/index.js";
import type { TranscriptRecord, TranscriptSegment } from "@svi/shared-types";
import {
  TranscriptFallbackChain,
  type PipelineRepository,
  type ProcessingContext,
  type ProcessingResult,
  type TranscriptProvider,
} from "../../../packages/processing/src/index.js";

export interface TranscriptRepository extends PipelineRepository {
  saveTranscript(transcript: TranscriptRecord): Promise<TranscriptRecord>;
}

export type PublicCaptionsProviderOptions = {
  fetchImpl?: typeof fetch;
  maxBytes?: number;
  timeoutMs?: number;
};

/**
 * Reads a public WebVTT/text caption track discovered during metadata fetch.
 * It never downloads video, follows redirects, sends cookies, or crosses
 * private-network boundaries.
 */
export class PublicCaptionsTranscriptProvider implements TranscriptProvider {
  readonly method = "public_captions";
  readonly provider = "public-webvtt";
  private readonly fetchImpl: typeof fetch;
  private readonly maxBytes: number;
  private readonly timeoutMs: number;

  constructor(options: PublicCaptionsProviderOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.maxBytes = options.maxBytes ?? 524_288;
    this.timeoutMs = options.timeoutMs ?? 10_000;
  }

  async transcribe({ capture }: TranscriptInput): Promise<TranscriptCandidate> {
    const captionsUrl = capture.metadata?.captionsUrl;
    if (!captionsUrl) throw new Error("No public caption track was discovered.");
    const url = assertPublicHttpUrl(captionsUrl);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await this.fetchImpl(url, {
        method: "GET",
        headers: {
          accept: "text/vtt,text/plain;q=0.9,application/x-subrip;q=0.8",
          "user-agent": "SavedVideoIntelligenceCaptions/0.1",
        },
        redirect: "manual",
        signal: controller.signal,
      });
      if (response.status >= 300 && response.status < 400) {
        throw new Error("Public caption source returned a redirect; use the canonical track URL.");
      }
      if (!response.ok) throw new Error(`Public caption source returned HTTP ${response.status}.`);

      const text = await readLimitedText(response, this.maxBytes);
      const segments = parseWebVtt(text);
      const transcriptText = segments.map((segment) => segment.text).join(" ").trim();
      if (!transcriptText) throw new Error("Public caption source contained no readable cues.");
      return { text: transcriptText, segments, source: "captions", provider: this.provider };
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        throw new Error(`Public caption request timed out after ${this.timeoutMs}ms.`);
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
}

/**
 * Runs the configured transcript methods in order. A failed provider does not
 * fail the whole capture until every permitted fallback has been attempted.
 */
export class TranscriptionStageHandler {
  private readonly chain: TranscriptFallbackChain;

  constructor(
    private readonly repository: TranscriptRepository,
    providers: readonly TranscriptProvider[],
  ) {
    this.chain = new TranscriptFallbackChain(providers);
  }

  async process(context: ProcessingContext): Promise<ProcessingResult> {
    const result = await this.chain.run({ capture: context.capture });
    if (result.kind === "needs_review") {
      return {
        kind: "needs_review",
        reason: result.reason,
        patch: { transcriptSource: "failed_unavailable" },
      };
    }

    await this.repository.saveTranscript(result.transcript);
    return {
      kind: "advance",
      patch: { transcriptSource: result.transcript.source },
    };
  }
}

/** MVP order: public captions first; manual entry remains the user fallback. */
export function createMvpTranscriptProviders(options: PublicCaptionsProviderOptions = {}): TranscriptProvider[] {
  return [new PublicCaptionsTranscriptProvider(options)];
}

/** Read a bounded public caption response without retaining the remote body. */
async function readLimitedText(response: Response, maxBytes: number): Promise<string> {
  const contentLength = Number(response.headers.get("content-length") ?? "0");
  if (contentLength > maxBytes) throw new Error(`Caption response exceeds the ${maxBytes}-byte limit.`);
  if (!response.body) return response.text();

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maxBytes) throw new Error(`Caption response exceeds the ${maxBytes}-byte limit.`);
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

function parseWebVtt(input: string): TranscriptSegment[] {
  const lines = input.replace(/^\uFEFF/, "").split(/\r?\n/);
  const segments: TranscriptSegment[] = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index]?.trim() ?? "";
    if (!line || line === "WEBVTT" || line.startsWith("NOTE") || line.startsWith("STYLE") || line.startsWith("REGION")) {
      index += 1;
      continue;
    }
    const timestampLine = line.includes("-->") ? line : (lines[index + 1]?.includes("-->") ? lines[index + 1]!.trim() : undefined);
    if (!timestampLine) {
      index += 1;
      continue;
    }
    if (timestampLine !== line) index += 1;
    const match = timestampLine.match(/^(\S+)\s+-->\s+(\S+)/);
    if (!match) {
      index += 1;
      continue;
    }
    const startMs = parseTimestamp(match[1]!);
    const endMs = parseTimestamp(match[2]!);
    index += 1;
    const cueLines: string[] = [];
    while (index < lines.length && lines[index]!.trim()) cueLines.push(lines[index++]!.trim());
    const text = cueLines.join(" ").replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").trim();
    if (text && endMs >= startMs) segments.push({ startMs, endMs, text });
  }
  return segments;
}

function parseTimestamp(value: string): number {
  const parts = value.split(":").map(Number);
  if (parts.some((part) => !Number.isFinite(part))) return 0;
  if (parts.length === 3) return Math.round((parts[0]! * 3600 + parts[1]! * 60 + parts[2]!) * 1000);
  if (parts.length === 2) return Math.round((parts[0]! * 60 + parts[1]!) * 1000);
  return 0;
}

function assertPublicHttpUrl(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("Caption source must be a valid URL.");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error("Caption source must use HTTP or HTTPS.");
  const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (hostname === "localhost" || hostname.endsWith(".local") || hostname === "127.0.0.1" || hostname === "::1" || hostname.startsWith("10.") || hostname.startsWith("192.168.") || isPrivate172(hostname) || (isIP(hostname) !== 0 && isPrivateIpv4(hostname))) {
    throw new Error("Caption source must be publicly reachable.");
  }
  return parsed.toString();
}

function isPrivate172(hostname: string): boolean {
  const match = hostname.match(/^172\.(\d{1,3})\./);
  return Boolean(match && Number(match[1]) >= 16 && Number(match[1]) <= 31);
}

function isPrivateIpv4(hostname: string): boolean {
  const octets = hostname.split(".").map(Number);
  if (octets.length !== 4 || octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) return true;
  return octets[0] === 10 || octets[0] === 127 || (octets[0] === 169 && octets[1]! === 254) || (octets[0] === 192 && octets[1]! === 168) || (octets[0] === 172 && octets[1]! >= 16 && octets[1]! <= 31);
}
