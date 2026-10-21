# Repository instructions

Saved Video Intelligence is an iOS-first Knowledge Library with a compatible web app. It is separate from Note Chat.

## Product rules

- Use Expo/React Native and Expo Router for the shared iOS/web client; keep the native Share Extension small and fast.
- Store source links and derived knowledge, never video files. Discard any permitted temporary media after processing.
- Run extraction, transcription, OCR, summarization, classification, and indexing in backend workers. Preserve provenance, failures, retries, and durable status.
- GitHub repository discovery is a backend stage after transcription; store ranked candidates with source evidence and require review for uncertain matches.
- MVP transcription reads bounded public caption tracks when available, then routes to manual transcript entry; future speech-to-text providers must implement the existing backend provider interface.
- MVP stage routing is `received → transcribing → discovering_repositories → needs_review`; future media/OCR/knowledge stages must not block this path.
- Use Firebase/Firestore as the authenticated durable control plane; run heavy processing in managed backend workers such as Cloud Run, dispatched by a managed queue. The device must never receive worker code, provider credentials, or provider-selection pointers.
- Keep credentials and provider integrations on the backend. Do not bypass private accounts, DRM, login barriers, or other access controls.
- MCP is authenticated, scoped, read/search-only for v1, and audited. Skills require safety review and explicit approval; never auto-install or execute them.
- Keep user data isolated by authenticated identity. The current `x-user-id` header is development-only.

## Firebase

- Active project: `saved-video-intelligence`; Firestore region: `us-east1`.
- Rules and indexes are owner-scoped. Google and email/password Authentication are enabled.
- Local JSON storage is the offline default. Use `FIRESTORE_ENABLED=true` only with server-side Firebase Admin credentials or ADC.
- The Expo client uses a persisted Firebase Auth session when public Firebase client configuration is supplied; only local API development may use the `x-user-id` fallback.
- Never put service-account material or provider keys in the client or source control.

## Runtime and workflow

- Use Node.js 24 and npm 11; `.nvmrc` is the runtime hint.
- Root commands: `npm test`, `npm run build`, `npm run dev`, `npm run dev:metadata-worker`, `npm run dev:mobile`, and `npm run web`.
- The mobile scripts enter `apps/mobile`; Expo web normally serves `http://localhost:8081`, and the API serves `http://127.0.0.1:8787`.
- Keep root React/React Native peer versions aligned with the Expo SDK. From `apps/mobile`, use `npx expo install --fix` after SDK changes.
- Use `rg` for searches and `apply_patch` for hand edits. Preserve unrelated changes, add focused tests, and update concise documentation when durable behavior changes.
- Keep shared contracts in `packages/shared-types` and transport logic in `packages/api-client`. Document intentional iOS/web differences near the affected code.
- Do not add a 3D galaxy knowledge graph to v1.

## Current cloud baseline

- Firebase/Google Cloud project: `saved-video-intelligence`; deployment region: `us-east1`.
- Provisioned queue: Cloud Tasks `svi-processing`.
- Provisioned image repository: Artifact Registry Docker repository `svi`.
- Dedicated service accounts exist for the API runtime, worker runtime, and Cloud Tasks dispatcher.
- Cloud Run API and initial private worker services are deployed, with dispatcher invocation grants configured; queue dispatch is active for the MVP stages and remains disabled for future media/OCR/knowledge stages.
- Worker transitions persist the next queued job before attempting Cloud Tasks dispatch; local mode retains the no-op queue and polling behavior.
