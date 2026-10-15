# WearWise phone app

The participant app (React Native + Expo SDK 57, Android and iOS). It's a research prototype,
not a medical device.

- **Set up and run it:** the root [README](../../README.md), sections 3–9.
- **How it works:** [docs/mobile-app.md](../../docs/mobile-app.md): structure, Bluetooth,
  local storage, sync, configuration.
- **Release builds:** [docs/deployment.md](../../docs/deployment.md#mobile-app-release-builds).

```bash
npm run typecheck      # tsc --noEmit
npm test               # Jest (also runs packages/sensor-protocol)
npx expo run:android   # development build on an emulator or USB phone (Expo Go is not supported)
npx expo run:ios       # macOS only
npx expo start -c      # bundler only, after the first build
```

The backend comes from `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_ANON_KEY`
(`.env.example`). `npm run backend:local` in the repository root points development builds
at a local Supabase.
