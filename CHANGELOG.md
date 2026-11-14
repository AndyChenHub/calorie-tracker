# Changelog

All notable changes to **CalorieLens** are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.1.6] - 2026-11-14 (Build 8)

### Added
- **Metric Water Logging (`PlateHomeView.tsx`, `PlateOverlays.tsx`, `CalorieContext.tsx`)**: Added an always-visible Home Hydration bar with 1-tap `-250 mL` / `+250 mL` buttons, **Log water** in the `+` Quick Actions menu, and a dedicated **Water Sheet** with `+250 mL`, `+330 mL`, `+500 mL`, `+750 mL`, and `+1 L` presets plus custom `mL` stepper/input and daily reset.
- **Barcode AI Custom Portions & Natural-Language Queries (`PlateOverlays.tsx`, `barcode.ts`, `ai.ts`)**: Added an **AI Custom Portion / Additions** input inside scanned barcode cards (anchored to verified label nutrition per `100 g` / `100 mL` and manufacturer serving size so inputs like `"5 chips"` or `"half the packet + 30 g salsa"` calculate exact calories and macros with a 1-tap **Reset**), plus direct natural-language **Ask AI** queries from the Barcode scanner bar.
- **One-Time AI Accuracy Disclaimer on Initial Setup (`onboarding.tsx`, `storage.ts`)**: Added a persisted one-time **AI Nutrition & Accuracy Notice** modal (`ai_disclaimer_seen_v1`) on first visit to Initial Setup plus a compact inline disclaimer notice above **Continue to Plate**.

### Fixed
- **Background AI Refinement Indicators & Authoritative Macro Updates (`CalorieContext.tsx`, `ai.ts`, `PlateHomeView.tsx`, `PlateOverlays.tsx`)**: Made meal refinements run asynchronously in the background with live animated status banners/badges on both the Home feed and Nutrition Detail sheet, added manual/AI ingredient macro editing and recalculation on ingredient removal, and hardened `refineMealEntry` + `normalizeAnalysisPayload` so user corrections authoritatively update calories, protein, carbs, fats, and health scores.

## [1.1.5] - 2026-11-14 (Build 7)

### Security
- **Lossless EXIF / GPS / IPTC / PNG Metadata Stripping (`imagePrivacy.ts`)**: Added lossless binary sanitization across camera captures, photo library picks, and `analyzeMealWithAI` so GPS coordinates, device serial numbers, timestamps, and comments are stripped before any meal photo leaves the device.
- **Hardware-Backed Secret Isolation & Sanitized Backups (`storage.ts`, `storage.web.ts`)**: Enforced `WHEN_UNLOCKED_THIS_DEVICE_ONLY` on `SecureStore`, eliminated plaintext SQLite/JSON secret mirroring when Keychain is available, encrypted sideload-only fallback secrets with an ephemeral `Library/Caches` key (excluded from cloud backups), moved pending PKCE verifiers into `SecureStore`, isolated Web credentials in `sessionStorage`, deleted orphan `meal-photos/` files on meal removal/clear, and stripped URL credentials and sandbox `file://` container UUID paths from portable backups.
- **API Header Auth, HTTPS Enforcement & Loopback/Backend Hardening (`ai.ts`, `ExpoLoopbackOAuth`, `backend/server.py`)**: Migrated Google Gemini requests from `?key=` URL query strings to `x-goog-api-key` headers, blocked cleartext `http://` companion URLs on non-local networks, validated `postMessage` origins, added `Referrer-Policy: no-referrer` + `history.replaceState` code scrubbing on native loopback OAuth callbacks, restricted companion server CORS/binding (`127.0.0.1`, `0o600` OAuth state, `secrets.compare_digest`, masked status emails), and expanded credential/JWT/base64 redaction in diagnostic logs.

### Added
- **Live Metric Barcode Lookup (`barcode.ts`, `PlateOverlays.tsx`)**: Added privacy-preserving EAN/UPC barcode scanning (`credentials: 'omit'`, `referrerPolicy: 'no-referrer'`) with automatic live camera detection, manual digit lookup, metric `g`/`mL` portion normalization, offline staple fallbacks, and 1-tap **Add to Log**.

### Fixed
- **Keyboard-Aware Edit Profile Sheet & Auto-Save on Outside Tap**: Wrapped bottom sheets, Nutrition Detail, Scanner, and Initial Setup in `SafeArea`-offset `KeyboardAvoidingView` containers with scrollable `keyboardShouldPersistTaps="handled"` bodies and 1-tap **Done** keyboard-dismiss pills so numeric/decimal keypads never cover inputs or trap focus. Added **Current weight (`kg`)** directly inside **Edit profile** alongside **Goal weight (`kg`)**, **Starting weight (`kg`)**, **Height (`cm`)**, and **Name**, and auto-saved valid profile edits when tapping outside the popup (with an explicit **Cancel** button to discard).
- **Post-Login ChatGPT / Codex Responses API Schema, Model Discovery & Rotating OAuth Sync**: Added required `"type": "message"` on `input` items and `"detail": "auto"` on `input_image` blocks for `chatgpt.com/backend-api/codex/responses` and `api.openai.com/v1/responses`, added `/backend-api/codex/models` capability discovery (`codex_cli_rs/0.99.0` headers) without aborting fallback on model-tier `403`, added automatic `401` force-refresh retry, and synchronized rotated single-use OAuth refresh tokens back into live React context (`subscribeChatGPTSessionRefresh`).
- **Live Test-Message AI Verification & Full Diagnostic Logging**: Upgraded **Verify AI connection (Send test message)** in Settings and Initial Setup to send a real test message (`verifyAIConnection`) and display an inline result card with latency, model, auth mode, and the AI's actual reply (or full selectable HTTP/endpoint error + **Copy Error**). Added persistent redacted **AI Diagnostic Logs** (`ai_diagnostic_logs_v1`) in Settings and an untruncated **AI Error Details** modal whenever a meal scan or refinement fails.

## [1.1.4] - 2026-11-14 (Build 6)

### Changed
- **100% Metric SI Units Throughout Plate (`cm`, `m`, `km`, `L`, `mL`, `g`, `kg`)**: Standardized hydration goals and logs to liters (`L`) and milliliters (`mL`) instead of glasses, added live meter/kilometer (`m` / `km`) step and workout distances, displayed height in both `cm` and `m`, labeled weight/energy chart axes in `kg` and `kcal`, added metric gram/milliliter portions across the Food Database, and enforced strict metric-only portions (`g`, `kg`, `mL`, `L`) in AI meal analysis.

### Fixed
- **Automatic On-Device Loopback OAuth Listener (`modules/expo-loopback-oauth`)**: Added a native IPv4 (`127.0.0.1`) + IPv6 (`::1`) loopback HTTP callback server on iOS & Android so **Sign in with ChatGPT** intercepts `http://localhost:1455/auth/callback` directly inside the app, renders a clean confirmation screen, auto-dismisses Safari, and exchanges PKCE tokens without ever getting stuck on `localhost`.
- **Direct ChatGPT Subscription & Responses Streaming Inference**: Updated OpenAI OAuth inference to support both ChatGPT Codex (`chatgpt.com/backend-api/codex/responses` with `chatgpt-account-id`, `store: false`, `stream: true`, SSE parsing) and OpenAI Responses (`api.openai.com/v1/responses` with `/v1/models` plan discovery, `store: false`, `stream: true`), plus automatic clipboard key capture on Safari close (`Google AI Studio`, `Anthropic Console`, `OpenAI Platform`), sideloaded Keychain persistence fallback, smart ready-provider routing, and a 1-tap **Verify AI connection** check.

## [1.1.3] - 2026-11-13 (Build 5)

### Changed
- **Complete Initial Setup (`onboarding.tsx`)**: Expanded Initial Setup to collect everything required by Plate upfront — **Your name** (required), **Height (`cm`)** (for BMI), **Starting weight (`kg`)**, **Goal weight (`kg`)**, **Daily calories & editable Protein/Carbs/Fats (`g`)**, **Daily steps & water goals**, **Budget & reminder preferences**, and **AI provider authorization**.
- **Removed Synthetic Historical Weight Data**: Removed the generated 180-day weight curve (`buildWeightSeries` / `mulberry32`) and legacy `84.6 -> 78.4 kg` demo profile gap; `Log weight` now records real dated weigh-ins (`weightHistory`), and the Progress chart plots only your real logged weights.
- **5-Click Clear Meals Protection & Settings Streamlining**: `Clear all logged meals` now requires 5 clicks with a live countdown hint (`Click 5 times to clear all logged meals`) and displays a confirmation modal popup when cleared; removed `Restore backup from clipboard`.

## [1.1.2] - 2026-11-13 (Build 4)

### Changed
- **Live Camera Meal Scanner (`expo-camera`)**: Replaced the stock-photo preview in the Scanner with a real live rear/front camera viewfinder (`CameraView`), hardware torch/flash toggle, live barcode scanning, and instant shutter capture (`takePictureAsync`) for AI vision analysis.
- **Zero Sample Images or Demo Data on Startup**: Removed bundled `assets/foods` stock images, disabled startup demo meal/step/water seeding, and added a one-time upgrade purge (`purged_legacy_demo_seed_v1`) that strips legacy sample entries while preserving all user settings, preferences, goals, profile, AI auth, and real scanned meals.

## [1.1.1] - 2026-11-13 (Build 3)

### Changed
- **Standalone On-Device ChatGPT Sign-In**: Removed the local Companion Server hosting requirement for **Sign in with ChatGPT** (`auth.openai.com`), adding serverless on-device PKCE + 8-digit Device Code sign-in, chunked iOS Keychain token storage, automatic token refresh, and direct `/v1/responses` vision analysis.
- **Persistent Settings & Preferences Across App Updates**: Mirrored user goals, profile, preferences, AI provider config, and onboarding state across SQLite, `Documents/plate-settings-mirror.json`, and iOS Keychain (`expo-secure-store`) with self-healing startup recovery, dynamic iOS sandbox meal photo path resolution, monotonic `CFBundleVersion` `.ipa` build stamping, and 1-tap JSON backup export/restore.
- **Custom Plate Brand Icon**: Replaced default Expo icons across iOS, Android adaptive/monochrome, splash screen, web favicon, and in-app brand header.

## [1.1.0] - 2026-11-13 (Build 2)

### Changed
- **Integrated Plate UI (`design-prototype/`)**: Replaced the app frontend with the **Plate** light design system (`#F5F5F7` canvas, `#FFFFFF` `26px` rounded cards, desktop `390×844` iPhone bezel + Dynamic Island stage on Web, full-bleed `SafeAreaView` on iOS).
- **Home, Progress & Settings Tabs**: 7-day `MTWTFSS` progress ring strip with previous-week navigation, 2-page horizontal calorie/macro/steps/water carousel, live pending AI analysis shimmer card, cubic Bezier weight goal chart, stacked weekly macro bar chart, BMI spectrum card, and steppers/switches in Settings.
- **Scanner & Nutrition Detail**: Full-screen Scanner with animated scan brackets, photo upload/camera capture, optional gram/ingredient context input, and Nutrition Detail sheet with `0.5` servings stepper, health score bar, ingredient chips, and AI `Fix results` refinement.

## [1.0.0] - 2026-11-13 (Build 1)

### Added
- **One-Time Setup Flow**: Single-screen setup for daily calorie target, macro split (`Balanced`, `High Protein`, `Low Carb`), and direct AI authorization.
- **Monthly Gradient Heatmap Calendar**: Smooth green-to-red daily intake gradient cells relative to your calorie goal, matte charcoal grey for untracked days, and tap-to-inspect history for previous dates.
- **Photo + Context AI Meal Logger**: Center `+` camera/library capture with optional gram weights & ingredient notes, per-item gram scaling, and editable macro breakdowns.
- **Official Provider Website SSO & Authorization**:
  - **GPT (OpenAI)**: Official *Sign in with ChatGPT* OAuth 2.0 + PKCE (`auth.openai.com`) and `platform.openai.com` API key support.
  - **Antigravity (Google)**: Local `google-antigravity` SDK companion server + Google AI Studio (`aistudio.google.com`) & Google OAuth PKCE support.
  - **Claude (Anthropic)**: Direct console authorization on `console.anthropic.com` with 1-tap clipboard paste into iOS Keychain.
- **App & Build Versioning**: Synchronized SemVer, iOS `buildNumber`, Android `versionCode`, EAS `runtimeVersion` (`appVersion` policy), Settings version badge, and automated `npm run version:*` bump scripts.
