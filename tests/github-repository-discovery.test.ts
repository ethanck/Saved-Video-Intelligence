import assert from "node:assert/strict";
import test from "node:test";
import type { CaptureRecord } from "@svi/shared-types";
import {
  GitHubApiRepositorySearcher,
  GitHubRepositoryDiscoveryEngine,
} from "../packages/processing/src/index.js";

function capture(overrides: Partial<CaptureRecord> = {}): CaptureRecord {
  return {
    id: "capture-1",
    userId: "user-1",
    originalUrl: "https://www.youtube.com/watch?v=abc",
    platform: "youtube",
    title: "Video title",
    status: "discovering_repositories",
    currentStage: "discovering_repositories",
    retryCount: 0,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

test("repository discovery preserves direct GitHub references without remote search", async () => {
  const engine = new GitHubRepositoryDiscoveryEngine({
    searchRepositories: async () => { throw new Error("remote search disabled"); },
  });

  const result = await engine.discover({
    capture: capture({ caption: "Code is here: https://github.com/acme/demo-repo" }),
  });

  assert.equal(result.status, "found");
  assert.equal(result.candidates[0]?.fullName, "acme/demo-repo");
  assert.equal(result.candidates[0]?.confidence, 1);
  assert.equal(result.candidates[0]?.evidence[0]?.kind, "direct_url");
});

test("repository discovery ranks contextual GitHub search results for review", async () => {
  const queries: string[] = [];
  const engine = new GitHubRepositoryDiscoveryEngine({
    searchRepositories: async (query) => {
      queries.push(query);
      return [{
        fullName: "prisma/prisma",
        owner: "prisma",
        name: "prisma",
        url: "https://github.com/prisma/prisma",
        description: "Next-generation Node.js and TypeScript ORM",
        stars: 40000,
      }];
    },
  });

  const result = await engine.discover({
    capture: capture({ title: "Prisma ORM" }),
  });

  assert.equal(queries.length, 1);
  assert.equal(result.status, "needs_review");
  assert.equal(result.candidates[0]?.fullName, "prisma/prisma");
  assert.equal(result.candidates[0]?.evidence[0]?.kind, "context_search");
  assert.ok((result.candidates[0]?.confidence ?? 0) > 0.5);
});

test("GitHub search adapter sends the backend token and normalizes API results", async () => {
  let requestedUrl = "";
  let authorization = "";
  const searcher = new GitHubApiRepositorySearcher({
    token: "server-only-token",
    fetchImpl: async (input, init) => {
      requestedUrl = String(input);
      authorization = new Headers(init?.headers).get("authorization") ?? "";
      return new Response(JSON.stringify({ items: [{
        full_name: "acme/demo-repo",
        name: "demo-repo",
        html_url: "https://github.com/acme/demo-repo",
        owner: { login: "acme" },
        description: "A demo repository",
        stargazers_count: 12,
      }] }), { status: 200 });
    },
  });

  const results = await searcher.searchRepositories("demo repo");

  assert.match(requestedUrl, /api\.github\.com\/search\/repositories\?q=demo\+repo/);
  assert.equal(authorization, "Bearer server-only-token");
  assert.deepEqual(results[0], {
    fullName: "acme/demo-repo",
    owner: "acme",
    name: "demo-repo",
    url: "https://github.com/acme/demo-repo",
    description: "A demo repository",
    stars: 12,
  });
});

