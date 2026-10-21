# Codebase inventory

This file is the quick orientation map for agents working on Saved Video Intelligence. Every source file in the repository should have one clear owner and purpose. If a file no longer fits one of these responsibilities, remove it or update this inventory in the same change.

## Runtime layers

| Path | Purpose |
| --- | --- |
| `apps/api/src/server.ts` | Node HTTP routes for health, capture intake, Inbox reads, and retries. |
| `apps/api/src/auth.ts` | Firebase ID-token verification and development-only header fallback. |
| `apps/api/src/firebase.ts` | Lazy Firebase Admin app initialization from ADC or server-only service-account configuration. |
| `apps/api/src/domain.ts` | Domain factories and source-platform detection. |
| `apps/api/src/validation.ts` | Request validation, URL extraction, and basic public-host safety checks. |
| `apps/api/src/repository.ts` | `KnowledgeRepository` storage contract and local JSON implementation. |
| `apps/api/src/firestore-repository.ts` | Firestore implementation of the repository contract. |
| `apps/api/src/metadata-worker-runner.ts` | Local polling process that connects the repository to the metadata worker. |
| `packages/shared-types/src/index.ts` | Shared capture, job, stage, and local-store types used across packages. |
| `packages/api-client/src/index.ts` | Fetch-based client used by Expo native and web builds. |
| `packages/ingestion/src/index.ts` | Provider-neutral metadata extraction boundary, safe public HTML adapter, and explicit no-op implementation. |
| `packages/processing/src/index.ts` | Provider-neutral processing stages, forward transitions, and pipeline contracts. |
| `packages/processing/src/github-repository-discovery.ts` | GitHub URL/slug extraction, bounded search queries, ranking, and provenance evidence. |
| `packages/processing/src/queue.ts` | Local no-op and Cloud Tasks processing-queue dispatchers. |
| `workers/metadata-worker/src/index.ts` | One-job-at-a-time worker orchestration and stage transitions. |
| `workers/pipeline-worker/src/index.ts` | Generic one-stage worker that invokes backend providers and queues the next stage or review. |
| `workers/transcription-worker/src/index.ts` | Ordered transcript fallback chain and transcript persistence handler. |
| `workers/repository-discovery-worker/src/index.ts` | GitHub discovery stage handler and backend-only search configuration. |
| `workers/worker-runtime/src/server.ts` | Authenticated HTTP entry point for Cloud Run worker services. |
| `apps/mobile/src/LibraryScreen.tsx` | Universal React Native/React Native Web capture and Inbox screen. |
| `apps/mobile/src/CaptureDetailScreen.tsx` | Universal capture detail, processing history, source provenance, and retry screen. |
| `apps/mobile/src/api.ts` | Shared mobile/web API client factory and Firebase-session handoff boundary. |
| `apps/mobile/src/auth.tsx` | Persisted Firebase Auth session, email/password UI, remote-auth gate, and local development gate. |
| `apps/mobile/src/config.ts` | Public API URL, Firebase client configuration, and development-mode detection. |
| `apps/mobile/src/libraryActions.ts` | Testable source-save action used by the universal Library screen. |
| `apps/mobile/app/_layout.tsx` | Expo Router root layout. |
| `apps/mobile/app/index.tsx` | Expo Router entry route that renders the universal library screen. |
| `apps/mobile/app/capture/[id].tsx` | Dynamic Expo Router route for capture details. |
| `apps/mobile/ios/SavedVideoShareExtension/ShareViewController.swift` | Thin iOS Share Extension boundary; extracts shared text/URL and forwards it to the app transport. |

## Tests

| Path | Purpose |
| --- | --- |
| `tests/api.test.ts` | API capture creation and user-isolation integration coverage. |
| `tests/api-client.test.ts` | Platform-neutral client retry transport, Firebase token injection, and structured API error coverage. |
| `tests/metadata-worker.test.ts` | Worker success and failure transition coverage. |
| `tests/mobile-library-actions.test.ts` | Save-button action coverage for trimmed URL submission and empty-input behavior. |

The in-memory repositories in these tests are intentional test doubles. They avoid coupling behavior tests to the local JSON file while implementing the same `KnowledgeRepository` contract.

## Configuration and documentation

| Path | Purpose |
| --- | --- |
| `package.json` | Root npm workspace, Node 24 engine constraint, shared commands, and Expo-compatible hoisted React peer versions. |
| `package-lock.json` | Reproducible npm dependency graph for all workspaces. |
| `.firebaserc` | Binds Firebase CLI/MCP operations to the Saved Video Intelligence project. |
| `firebase.json` | Configures the Firestore database location, rules/index files, and Auth providers. |
| `firestore.rules` | Owner-scoped Firestore rules for captures and processing jobs. |
| `firestore.indexes.json` | Composite indexes for user-owned capture/job timelines. |
| `.nvmrc` | Selects Node 24 for local version managers. |
| `.env.example` | Documented local API environment variables; no secrets. |
| `.gitignore` | Excludes dependencies, generated output, local data, and native build products. |
| `tsconfig.base.json` | Shared TypeScript compiler settings. |
| `tsconfig.json` | Root API/package/worker/test build scope. Mobile uses its own Expo config. |
| `apps/mobile/package.json` | Expo scripts and universal-client dependencies. |
| `apps/mobile/app.json` | Expo Router, web output, and iOS app identity configuration. |
| `apps/mobile/tsconfig.json` | Expo TypeScript settings. |
| `apps/mobile/expo-env.d.ts` | Expo-generated environment type reference. |
| `apps/*/README.md`, `apps/mobile/ios/*/README.md` | Local guidance at each platform boundary. |
| `AGENTS.md` | Durable instructions for coding agents: architecture, constraints, and workflow. |
| `README.md` | Human-facing setup, runtime commands, API example, and docs map. |
| `IMPLEMENTATION_GUIDE.md` | Product and implementation brief, including universal-client decisions. |
| `docs/ARCHITECTURE.md` | Deeper explanation of runtime flow, ownership, and security boundaries. |
| `docs/PROCESSING_PIPELINE.md` | Firebase/Google Cloud deployment boundary and processing-stage design. |
| `docs/FIRESTORE_RULES_DATA_MODEL.md` | Firestore collections, queries, ownership boundaries, and rule assumptions. |
| `infra/cloud-run/README.md` | Cloud Run image and service deployment boundary. |

## Cleanup rules

- `node_modules/` and `apps/mobile/node_modules/` are installed dependencies, not source. Keep them when validating the app; regenerate them with `npm install` when needed.
- `dist/` is disposable TypeScript build output. It is ignored and can be recreated with `npm run build`.
- `data/` is local development state and is intentionally ignored. Do not commit captures or job records.
- `firebase.json`, `firestore.rules`, and `firestore.indexes.json` are deployable backend configuration; review security rules before any deployment.
- `.DS_Store` files, editor caches, and native build folders have no product purpose and should be removed when encountered.
- Do not add a second web application or a second API client. The Expo app is the shared iOS/web client, and `packages/api-client` is its transport boundary.

## Change checklist

1. Put new behavior in the narrowest owning layer.
2. Add or update a test at the boundary being changed.
3. Add a concise public JSDoc comment when exporting a new type, class, function, or module.
4. Update `README.md`, `AGENTS.md`, or this inventory when a command, boundary, or durable constraint changes.
5. Run `npm test`; run `npm run build` when the TypeScript build scope changes.
