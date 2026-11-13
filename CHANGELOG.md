# Changelog

All notable changes to **CalorieLens** are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
