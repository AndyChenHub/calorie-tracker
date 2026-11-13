# Changelog

All notable changes to **CalorieLens** are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
