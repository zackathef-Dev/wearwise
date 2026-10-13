# Android development setup

What this machine runs and how it got there, so the setup is reproducible on a
teammate's Windows machine. Everything below was installed 26 Aug 2026.

## Installed toolchain

| Tool | Version | Where | How |
|---|---|---|---|
| JDK (Temurin) | 17.0.20.1 | `C:\Program Files\Eclipse Adoptium\jdk-17.0.20.101-hotspot` | `winget install EclipseAdoptium.Temurin.17.JDK` |
| Android cmdline-tools | 13114758 | `C:\Android\Sdk\cmdline-tools\latest` | Google zip, extracted |
| Android SDK Platform | 36 | `C:\Android\Sdk\platforms\android-36` | `sdkmanager "platforms;android-36"` |
| Build-Tools | 36.0.0 | `C:\Android\Sdk\build-tools\36.0.0` | `sdkmanager "build-tools;36.0.0"` |
| platform-tools (`adb`) | 37.0.1 | `C:\Android\Sdk\platform-tools` | `sdkmanager "platform-tools"` |

User environment variables (persisted): `JAVA_HOME`, `ANDROID_HOME`, and PATH
additions for `java`, `adb`, `sdkmanager`. **Restart your terminal after install**
— an existing shell will not see them.

SDK licenses are accepted via hash files in `C:\Android\Sdk\licenses\` (the same
mechanism CI images use), so `sdkmanager` and Gradle run non-interactively. The NDK
is not pre-installed: Gradle's `com.android.application` plugin fetches the exact
version React Native pins on the first native build.

## Day-to-day

```bash
# from the repo root
npm install                        # workspace: apps/* + packages/*

cd apps/mobile
npm run typecheck                  # tsc --noEmit, strict
npx expo lint

# regenerate design tokens after editing design-system/tokens/*.css
node ../../packages/design-tokens/scripts/generate.mjs

# native project + debug APK
npx expo prebuild --platform android --no-install
cd android && ./gradlew assembleDebug
# -> android/app/build/outputs/apk/debug/app-debug.apk

# on a phone with USB debugging enabled
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

For iterative work use the dev client instead of reinstalling APKs:
`npx expo run:android` once, then `npx expo start` for JS-only changes.

## Physical device (required for BLE from Milestone 4)

1. Settings → About phone → tap **Build number** 7× to unlock Developer options.
2. Developer options → **USB debugging** on.
3. Plug in; accept the RSA fingerprint prompt; `adb devices` should list it.

Emulators do not have Bluetooth — BLE work is physical-device-only, per the test
matrix.

## iOS from this machine

There is no macOS here, so no local iOS builds. Use EAS:

```bash
npx eas build --platform ios --profile development
```

This needs an Expo account login and, for device installs, an Apple Developer
membership. Physical iPhone testing remains a manual step regardless.
