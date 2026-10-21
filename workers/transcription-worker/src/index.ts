/** Transcription-stage handler with ordered backend fallback providers. */
import type { TranscriptRecord } from "@svi/shared-types";
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

/** Explicit placeholder until a real permitted provider is configured. */
export class UnconfiguredTranscriptProvider implements TranscriptProvider {
  constructor(
    readonly method: string,
    readonly provider: string,
  ) {}

  async transcribe(): Promise<never> {
    throw new Error(`${this.provider} transcript provider is not configured.`);
  }
}

/** Default order: captions, then media ASR, then an alternate audio ASR. */
export function createUnconfiguredTranscriptProviders(): TranscriptProvider[] {
  return [
    new UnconfiguredTranscriptProvider("public_captions", "captions-adapter"),
    new UnconfiguredTranscriptProvider("permitted_media_asr", "primary-asr"),
    new UnconfiguredTranscriptProvider("permitted_audio_asr", "alternate-asr"),
  ];
}
