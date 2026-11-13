# Plate — iOS AI Calorie & Macro Tracker

A sleek React Native (Expo SDK 58) iOS & Web app for tracking daily calories, macros, weight, steps, and water from meal photos + ingredient notes, powered directly by **Google Antigravity**, **Claude**, or **GPT**.

## Project Structure

- `src/` — Expo Router screens (`src/app/`), Plate UI components (`src/components/`), state context (`src/context/`), storage (`expo-sqlite` + `localStorage`), and direct AI vision services (`src/services/`).
- `assets/` — App icons and bundled meal catalog photography (`assets/foods/`).
- `backend/` — FastAPI companion server (`backend/server.py`) for local `google-antigravity` SDK inference and official OpenAI **Sign in with ChatGPT** (`auth.openai.com`) OAuth 2.0 + PKCE callbacks.
- `design-prototype/` — Standalone static HTML/CSS/JS UI reference prototype for **Plate**.
- `scripts/` — Synchronized SemVer & native build bump automation (`scripts/bump-version.mjs`).

## Features

- **One-Time Setup Screen**: Set your daily calorie target, macro split (`Balanced`, `High Protein`, `Low Carb`), and authorize your preferred AI provider.
- **Home Dashboard**:
  - 7-day `MTWTFSS` progress ring strip with previous-week navigation to inspect or log any past day.
  - 2-page summary carousel: tappable `Calories left` / `Calories eaten` hero ring + `Protein`, `Carbs`, `Fats` rings on Page 1; `Steps`, `Calories burned`, and `Water` glass tracker on Page 2.
  - Live AI meal analysis shimmer card (`Uploading photo…` -> `Separating ingredients…` -> `Breaking down macros…` -> `Final checks…`).
- **Full-Screen Scanner & Nutrition Detail**:
  - Snap a photo with the iPhone camera or upload from your photo library.
  - Optionally add **exact gram weights** or **ingredients** (`e.g. 180g salmon, 1 tbsp olive oil`).
  - Adjust servings (`0.5` steps), inspect health score (`1–10`) & detected ingredients, add items, or tap **Fix results** to refine with AI.
- **Progress Analytics**: Current weight logger, day streak tracker, `1M / 3M / 6M` cubic Bezier weight goal chart, weekly stacked macro bar chart, and BMI spectrum card.
- **Direct Official AI Website SSO & Authorization** (no OpenRouter):
  - **GPT (OpenAI)**: Official **Sign in with ChatGPT** OAuth 2.0 + PKCE (`auth.openai.com`) or `platform.openai.com/api-keys`.
  - **Antigravity (Google)**: Local `google-antigravity` SDK companion server + Google AI Studio (`aistudio.google.com/apikey`) & Google OAuth PKCE.
  - **Claude (Anthropic)**: Official Anthropic Console (`console.anthropic.com/settings/keys`) with 1-tap clipboard paste into **iOS Keychain** (`expo-secure-store`).

---

## Quick Start

### 1. Start the Companion Backend (Antigravity SDK + ChatGPT OAuth Loopback)

```powershell
npm run backend
```

Launches the FastAPI server on `http://0.0.0.0:8787` (`http://127.0.0.1:8787/api/oauth/openai/callback` for ChatGPT OAuth SSO).

### 2. Run the App

```powershell
npm start      # Scan QR code in iPhone Camera to open in Expo Go
npm run web    # Preview in browser at http://localhost:8081
```

---

## Building an iOS `.ipa` (from Windows)

Because Apple requires macOS + Xcode to compile iOS binaries, **Plate** includes two cloud `.ipa` pipelines so you can produce an installable `.ipa` directly from Windows:

### Option 1 — Signed `.ipa` via Expo EAS Cloud Build (Recommended with Apple Developer Account)

Produces an Apple-signed **Ad Hoc `.ipa`** (`preview` profile) with a direct QR-code install link for your iPhone, or an **App Store / TestFlight `.ipa`** (`production` profile):

```powershell
npm run eas:login       # Sign in to your Expo account (one-time)
npm run eas:init        # Link repo to your Expo project (one-time)
npm run eas:device      # Register your iPhone UDID for Ad Hoc install (one-time)
npm run build:ipa       # Cloud-builds a signed Release Ad Hoc .ipa (preview profile)
npm run build:ipa:prod  # Cloud-builds a signed App Store / TestFlight .ipa (production profile)
```

### Option 2 — Unsigned `.ipa` via GitHub Actions macOS Xcode Runner (Free / Sideloading)

[.github/workflows/build-ios-ipa.yml](.github/workflows/build-ios-ipa.yml) compiles `Plate` on GitHub's `macos-latest` Xcode runner (`expo prebuild` -> `pod install` -> `xcodebuild Release iphoneos` with embedded `main.jsbundle`) and packages `Plate-v<version>-build<build>.ipa`:

1. Push to `main` (or open **Actions -> Build iOS IPA -> Run workflow** on GitHub).
2. Download the **`Plate-iOS-IPA`** artifact (`Plate-v1.1.0-build2.ipa`) from the completed workflow run (or from **GitHub Releases** when pushing a `v*` tag).
3. Install onto your iPhone using **AltStore**, **SideStore**, **Sideloadly**, or **Feather** with a free Apple ID (no `$99/yr` Apple Developer subscription required).

---

## Versioning & Releases

Plate uses **Semantic Versioning** (`MAJOR.MINOR.PATCH`) synchronized across [package.json](package.json), [app.json](app.json) (`version`, `ios.buildNumber`, `android.versionCode`, `runtimeVersion` policy `appVersion`), [eas.json](eas.json), [src/constants/version.ts](src/constants/version.ts), [backend/server.py](backend/server.py), and [CHANGELOG.md](CHANGELOG.md):

```powershell
npm run version:status  # print current SemVer + iOS/Android build numbers
npm run version:patch   # e.g. 1.1.0 -> 1.1.1 (+1 native build number & changelog entry)
npm run version:minor   # e.g. 1.1.0 -> 1.2.0 (+1 native build number & changelog entry)
npm run version:major   # e.g. 1.1.0 -> 2.0.0 (+1 native build number & changelog entry)
npm run version:build   # increments iOS buildNumber & Android versionCode only
```
