# Universal client

`apps/mobile` is the shared React Native/Expo client. It targets:

- iOS as the primary native app.
- Web through Expo Router and React Native Web.

## Commands

Use Node.js 24 and npm 11 for the workspace.

From the repository root:

```sh
npm run dev:mobile
npm run web
```

The root scripts enter `apps/mobile` before invoking Expo. If troubleshooting Expo directly, run the equivalent command from this directory: `expo start --web --clear`.

The current workspace uses Expo SDK 57, React Native 0.86.3, and React 19.2.3. If those versions change, run `npx expo install --fix` from this directory and then reinstall from the repository root with Node 24/npm 11.

Set `EXPO_PUBLIC_API_URL` to a deployed HTTPS API or a LAN-reachable development address when testing on a physical phone. `127.0.0.1` is appropriate for the web browser and usually the iOS simulator, but not for a physical device.

The current screens implement the capture/Inbox loop, capture detail history, retry handling, repository review, and manual transcript fallback. A manual transcript is submitted through the API and resumes the pipeline at repository discovery. The client uses `@svi/api-client`, preserves source links, and deliberately contains no Note Chat discussion action. Both screens construct the client through `src/api.ts`; the factory currently defaults to the local development identity and accepts a Firebase ID-token provider when sign-in is added.

The API and metadata worker are separate processes during local development. Start both before testing capture processing:

```sh
npm run dev
npm run dev:metadata-worker
```

## Native Share Extension boundary

The iOS Share Extension is not rendered by React Native. It will be a native Swift target under `ios/SavedVideoShareExtension`, using an App Group only for short-lived handoff state. It should extract a URL or text containing a URL, submit a small authenticated capture request, show success, and close. It must not save, download, or retain video files, and must not run AI work.
