/** Discovery-stage handler for finding GitHub repositories referenced by a capture. */
import type { GitHubRepositoryDiscoveryRecord } from "@svi/shared-types";
import {
  GitHubApiRepositorySearcher,
  GitHubRepositoryDiscoveryEngine,
  type GitHubRepositorySearcher,
  type PipelineRepository,
  type ProcessingContext,
  type ProcessingResult,
} from "../../../packages/processing/src/index.js";

export interface RepositoryDiscoveryRepository extends PipelineRepository {
  getTranscript(userId: string, captureId: string): Promise<import("@svi/shared-types").TranscriptRecord | undefined>;
  saveGitHubRepositoryDiscovery(discovery: GitHubRepositoryDiscoveryRecord): Promise<GitHubRepositoryDiscoveryRecord>;
}

export class GitHubRepositoryDiscoveryStageHandler {
  private readonly engine: GitHubRepositoryDiscoveryEngine;

  constructor(
    private readonly repository: RepositoryDiscoveryRepository,
    searcher: GitHubRepositorySearcher,
  ) {
    this.engine = new GitHubRepositoryDiscoveryEngine(searcher);
  }

  async process(context: ProcessingContext): Promise<ProcessingResult> {
    const transcript = await this.repository.getTranscript(context.capture.userId, context.capture.id);
    const discovery = await this.engine.discover({ capture: context.capture, ...(transcript ? { transcript } : {}) });
    await this.repository.saveGitHubRepositoryDiscovery(discovery);
    return {
      kind: "needs_review",
      reason: discovery.status === "found"
        ? "GitHub repository candidates are ready for your review."
        : discovery.status === "not_found"
          ? "No GitHub repository was identified. Review the capture or continue manually."
          : "GitHub repository discovery needs your review.",
    };
  }
}

/**
 * GitHub search is opt-in so a local worker never sends source context outside
 * the backend by accident. Explicit repository URLs still get persisted as
 * candidates even while remote search is disabled.
 */
export function createGitHubRepositorySearcherFromEnvironment(): GitHubRepositorySearcher {
  if (process.env.GITHUB_DISCOVERY_ENABLED !== "true") {
    return {
      searchRepositories: async () => {
        throw new Error("GitHub repository discovery search is not enabled.");
      },
    };
  }

  return new GitHubApiRepositorySearcher({
    ...(process.env.GITHUB_TOKEN ? { token: process.env.GITHUB_TOKEN } : {}),
  });
}
