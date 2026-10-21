# Firestore rules data model audit

This audit documents the Standard `(default)` Firestore database in project
`saved-video-intelligence` (`us-east1`) for the prototype rules in
[`firestore.rules`](../firestore.rules).

## Collections and ownership

All documents are user-owned through a required `userId` field. The API and
workers use Firebase Admin credentials, while direct client reads are limited
to the authenticated owner.

| Collection | Document ID | Purpose | Client access |
| --- | --- | --- | --- |
| `captures` | `capture.id` | Original source, durable status, metadata, and failures | Owner read only; backend writes through Admin SDK |
| `jobs` | `job.id` | Queued/running/completed stage history | Owner read only; backend writes through Admin SDK |
| `transcripts` | `captureId` | One transcript and auditable provider attempts per capture | Owner read only; backend writes through Admin SDK |
| `githubRepositoryDiscoveries` | `captureId` | Backend-derived repository candidates, evidence, confidence, search errors, and user review decision | Owner read only; backend writes through Admin SDK |

The original URL remains on `captures` even when processing fails. Discovery
records contain candidate provenance and are not treated as authoritative until
the user confirms a match.

## Queries found in the codebase

- `captures`: `where("userId", "==", userId)`, `orderBy("createdAt", "desc")`, `limit(100)`.
- `jobs` list: `where("userId", "==", userId)`, optional `where("captureId", "==", captureId)`, `orderBy("createdAt", "desc")`, `limit(100)`.
- `jobs` worker claim: `where("status", "==", "queued")`, `where("stage", "==", stage)`, `orderBy("createdAt", "asc")`, `limit(1)`.
- `transcripts` and `githubRepositoryDiscoveries`: document reads by ID; no collection query.

The composite indexes for the capture and job list queries, including the
worker claim query, are in [`firestore.indexes.json`](../firestore.indexes.json).

## Rule assumptions

- `request.auth.uid` is the only accepted owner identity.
- The client cannot read another user's document by guessing an ID.
- The client cannot forge workflow state, provenance, transcript attempts, or
  derived knowledge by writing directly to Firestore.
- Discovery results are server-derived and cannot be fabricated by a client.
- Rules are a second boundary; the API and workers still enforce ownership and
  must keep Admin credentials off the device.

These are prototype rules and should be exercised with the Firestore emulator
or the Firebase Rules Playground before broad release.
