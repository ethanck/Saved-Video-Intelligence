# iOS Share Extension boundary

`ShareViewController.swift` is the native entry point that will be added to the iOS Share Extension target. React Native owns the main app UI; this target owns the system share-sheet lifecycle.

Required production wiring:

1. Add a Share Extension target in the generated iOS project.
2. Configure activation rules for public URLs and shared text; the product stores links, not video or image files.
3. Resolve the signed-in user through the app’s approved auth/session mechanism.
4. POST the small capture payload to `POST /v1/captures` and close quickly.
5. Use an App Group only for short-lived handoff state, never for provider secrets.

The extension must not save or download media, invoke AI providers, or bypass platform access controls. If a future backend worker temporarily fetches permitted media for processing, it must discard that temporary data after processing and retain only the source link and derived knowledge.
