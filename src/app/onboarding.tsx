import * as Clipboard from 'expo-clipboard';
import { router } from 'expo-router';
import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import {
  PhoneStageFrame,
  PlateLogoMark,
  useIsDesktopStage,
} from '../components/PhoneStageFrame';
import { PlateIcon } from '../components/PlatePrimitives';
import { getAppVersionMetadata } from '../constants/version';
import { useCalorieTracker } from '../context/CalorieContext';
import {
  cancelPendingChatGPTSignIn,
  completeOnDeviceChatGPTCallback,
  disconnectChatGPTOAuth,
  disconnectGoogleOAuth,
  isProviderConfigured,
  looksLikeOAuthCallbackInput,
  openProviderWebsite,
  PROVIDER_AUTH_PORTALS,
  signInWithGoogleOAuth,
  startChatGPTDeviceCodeSignIn,
  startChatGPTSignIn,
} from '../services/ai';
import { cardShadow, colors, plateColors } from '../theme/colors';
import { AIProviderId } from '../types/models';
import { toLocalDateKey } from '../utils/date';

const CALORIE_PRESETS = [1800, 2000, 2250, 2500, 2800];

type MacroSplitId = 'balanced' | 'high_protein' | 'low_carb';

const MACRO_SPLITS: Record<
  MacroSplitId,
  { label: string; p: number; c: number; f: number }
> = {
  balanced: { label: 'Balanced', p: 0.3, c: 0.4, f: 0.3 },
  high_protein: { label: 'High Protein', p: 0.35, c: 0.35, f: 0.3 },
  low_carb: { label: 'Low Carb', p: 0.35, c: 0.25, f: 0.4 },
};

export default function OnboardingScreen() {
  const isDesktopStage = useIsDesktopStage();
  const scrollRef = useRef<React.ComponentRef<typeof ScrollView> | null>(null);
  const {
    hasCompletedOnboarding,
    goals,
    updateGoals,
    profile,
    updateProfile,
    preferences,
    updatePreferences,
    auth,
    updateAuth,
    companionStatus,
    isCheckingCompanion,
    refreshCompanionStatus,
    completeOnboarding,
  } = useCalorieTracker();

  const initialName =
    profile.name &&
    profile.name !== 'You' &&
    profile.name !== 'Alex Morgan'
      ? profile.name
      : '';

  const [nameInput, setNameInput] = useState(initialName);
  const [heightInput, setHeightInput] = useState(
    String(profile.heightCm || 175)
  );
  const [startWeightInput, setStartWeightInput] = useState(
    String(profile.startWeightKg || profile.weightKg || 75)
  );
  const [goalWeightInput, setGoalWeightInput] = useState(
    String(profile.goalWeightKg || 70)
  );
  const [startWeightEdited, setStartWeightEdited] = useState(false);

  const [calorieInput, setCalorieInput] = useState(
    String(goals.dailyCalories || 2250)
  );
  const [macroSplit, setMacroSplit] = useState<MacroSplitId>('balanced');
  const [customMacrosEdited, setCustomMacrosEdited] = useState(
    hasCompletedOnboarding
  );
  const [proteinInput, setProteinInput] = useState(
    String(
      hasCompletedOnboarding
        ? goals.proteinGrams
        : Math.round(((goals.dailyCalories || 2250) * 0.3) / 4)
    )
  );
  const [carbsInput, setCarbsInput] = useState(
    String(
      hasCompletedOnboarding
        ? goals.carbsGrams
        : Math.round(((goals.dailyCalories || 2250) * 0.4) / 4)
    )
  );
  const [fatInput, setFatInput] = useState(
    String(
      hasCompletedOnboarding
        ? goals.fatGrams
        : Math.round(((goals.dailyCalories || 2250) * 0.3) / 9)
    )
  );

  const [stepsInput, setStepsInput] = useState(
    String(goals.dailySteps || 10000)
  );
  const [waterInput, setWaterInput] = useState(
    String(goals.waterGlasses || 8)
  );

  const [addBurnedPref, setAddBurnedPref] = useState(preferences.addBurned);
  const [rolloverPref, setRolloverPref] = useState(preferences.rollover);
  const [remindersPref, setRemindersPref] = useState(preferences.reminders);

  const [setupError, setSetupError] = useState<string | null>(null);
  const [selectedProvider, setSelectedProvider] = useState<AIProviderId>(
    auth.activeProvider
  );

  const [claudeKeyDraft, setClaudeKeyDraft] = useState<string | null>(null);
  const [openaiKeyDraft, setOpenaiKeyDraft] = useState<string | null>(null);
  const [geminiKeyDraft, setGeminiKeyDraft] = useState<string | null>(null);

  const claudeKey = claudeKeyDraft ?? auth.claudeApiKey;
  const openaiKey = openaiKeyDraft ?? auth.openaiApiKey;
  const geminiKey = geminiKeyDraft ?? auth.geminiApiKey;

  const [oauthBusy, setOauthBusy] = useState(false);
  const [awaitingGptCallback, setAwaitingGptCallback] = useState(false);
  const [callbackUrlDraft, setCallbackUrlDraft] = useState('');
  const [deviceCodeBusy, setDeviceCodeBusy] = useState(false);
  const [deviceCodeInfo, setDeviceCodeInfo] = useState<{
    userCode: string;
    verificationUrl: string;
  } | null>(null);
  const deviceCodeAbortRef = useRef<AbortController | null>(null);
  const [saving, setSaving] = useState(false);
  const [statusMsg, setStatusMsg] = useState<{
    ok: boolean;
    text: string;
  } | null>(null);

  useEffect(() => {
    return () => {
      deviceCodeAbortRef.current?.abort();
    };
  }, []);

  const parsedCalories = Math.max(
    800,
    Math.min(10000, parseInt(calorieInput, 10) || 2250)
  );
  const parsedProtein = Math.max(
    10,
    Math.min(600, parseInt(proteinInput, 10) || 160)
  );
  const parsedCarbs = Math.max(
    10,
    Math.min(900, parseInt(carbsInput, 10) || 220)
  );
  const parsedFat = Math.max(10, Math.min(400, parseInt(fatInput, 10) || 70));

  const parsedHeightCm = Math.max(
    120,
    Math.min(240, Math.round(parseFloat(heightInput.replace(',', '.')) || 175))
  );
  const parsedStepsGoal = Math.max(
    1000,
    Math.min(50000, parseInt(stepsInput, 10) || 10000)
  );
  const parsedWaterGlasses = Math.max(
    1,
    Math.min(20, parseInt(waterInput, 10) || 8)
  );

  const syncMacrosFromCaloriesAndSplit = (
    kcal: number,
    splitId: MacroSplitId
  ) => {
    const sp = MACRO_SPLITS[splitId];
    setCustomMacrosEdited(false);
    setProteinInput(String(Math.round((kcal * sp.p) / 4)));
    setCarbsInput(String(Math.round((kcal * sp.c) / 4)));
    setFatInput(String(Math.round((kcal * sp.f) / 9)));
  };

  const handleCalorieChange = (raw: string) => {
    setCalorieInput(raw);
    const num = Math.max(800, Math.min(10000, parseInt(raw, 10) || 2250));
    syncMacrosFromCaloriesAndSplit(num, macroSplit);
  };

  const stepCalories = (delta: number) => {
    const next = Math.max(1000, Math.min(6000, parsedCalories + delta));
    setCalorieInput(String(next));
    syncMacrosFromCaloriesAndSplit(next, macroSplit);
  };

  const stepHeight = (delta: number) => {
    const next = Math.max(120, Math.min(240, parsedHeightCm + delta));
    setHeightInput(String(next));
  };

  const stepStepsGoal = (delta: number) => {
    const next = Math.max(1000, Math.min(50000, parsedStepsGoal + delta));
    setStepsInput(String(next));
  };

  const stepWaterGoal = (delta: number) => {
    const next = Math.max(1, Math.min(20, parsedWaterGlasses + delta));
    setWaterInput(String(next));
  };

  const parsedStartWeight = Math.max(
    30,
    Math.min(
      300,
      Math.round(
        (parseFloat(startWeightInput.replace(',', '.')) ||
          profile.startWeightKg ||
          75) * 10
      ) / 10
    )
  );
  const parsedGoalWeight = Math.max(
    30,
    Math.min(
      300,
      Math.round(
        (parseFloat(goalWeightInput.replace(',', '.')) ||
          profile.goalWeightKg ||
          70) * 10
      ) / 10
    )
  );
  const weightGoalDelta = Number(
    (parsedGoalWeight - parsedStartWeight).toFixed(1)
  );
  const previewBmi = Number(
    (parsedStartWeight / Math.pow(parsedHeightCm / 100, 2)).toFixed(1)
  );

  const stepStartWeight = (delta: number) => {
    const next = Math.max(
      30,
      Math.min(300, Math.round((parsedStartWeight + delta) * 10) / 10)
    );
    setStartWeightEdited(true);
    setStartWeightInput(String(next));
  };

  const stepGoalWeight = (delta: number) => {
    const next = Math.max(
      30,
      Math.min(300, Math.round((parsedGoalWeight + delta) * 10) / 10)
    );
    setGoalWeightInput(String(next));
  };

  const handleChatGPTSignIn = async () => {
    setStatusMsg(null);
    setOauthBusy(true);
    try {
      const res = await startChatGPTSignIn(auth);
      if (res.mode === 'on_device_connected') {
        await updateAuth({
          activeProvider: 'gpt',
          chatgptOAuth: res.session,
        });
        setAwaitingGptCallback(false);
        setCallbackUrlDraft('');
        setStatusMsg({
          ok: true,
          text: res.session.email
            ? `Connected to ChatGPT (${res.session.email})`
            : 'Connected via OpenAI ChatGPT SSO!',
        });
      } else if (res.mode === 'companion_connected') {
        const st = await refreshCompanionStatus(
          auth.companionUrl,
          auth.companionToken
        );
        await updateAuth({ activeProvider: 'gpt' });
        setAwaitingGptCallback(false);
        const email = st?.chatgptOAuth?.email;
        setStatusMsg({
          ok: true,
          text: email
            ? `Connected to ChatGPT (${email})`
            : 'Connected via OpenAI ChatGPT SSO!',
        });
      } else {
        setAwaitingGptCallback(true);
        setStatusMsg({
          ok: true,
          text: 'Approve in your browser, copy the 127.0.0.1 redirect URL & tap Complete below.',
        });
      }
    } catch (err) {
      setStatusMsg({
        ok: false,
        text: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setOauthBusy(false);
    }
  };

  const handleCompleteGptCallback = async () => {
    setStatusMsg(null);
    setOauthBusy(true);
    try {
      const candidate =
        callbackUrlDraft.trim() || (await Clipboard.getStringAsync()).trim();
      const session = await completeOnDeviceChatGPTCallback(candidate, auth);
      await updateAuth({
        activeProvider: 'gpt',
        chatgptOAuth: session,
      });
      setAwaitingGptCallback(false);
      setCallbackUrlDraft('');
      setStatusMsg({
        ok: true,
        text: session.email
          ? `Connected to ChatGPT (${session.email})`
          : 'Connected via OpenAI ChatGPT SSO!',
      });
    } catch (err) {
      setStatusMsg({
        ok: false,
        text: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setOauthBusy(false);
    }
  };

  const handleCancelGptCallback = async () => {
    await cancelPendingChatGPTSignIn();
    setAwaitingGptCallback(false);
    setCallbackUrlDraft('');
  };

  const handleDeviceCodeSignIn = async () => {
    deviceCodeAbortRef.current?.abort();
    const controller = new AbortController();
    deviceCodeAbortRef.current = controller;
    setStatusMsg(null);
    setDeviceCodeBusy(true);
    setDeviceCodeInfo(null);
    try {
      const res = await startChatGPTDeviceCodeSignIn(
        auth,
        (info) => {
          setDeviceCodeInfo(info);
          setStatusMsg({
            ok: true,
            text: `Code ${info.userCode} copied — paste it in your browser window.`,
          });
        },
        controller.signal
      );
      if (res.apiKeyIssued) {
        setOpenaiKeyDraft(res.apiKeyIssued);
      }
      await updateAuth({
        activeProvider: 'gpt',
        chatgptOAuth: res.session,
        ...(res.apiKeyIssued ? { openaiApiKey: res.apiKeyIssued } : {}),
      });
      setDeviceCodeInfo(null);
      setAwaitingGptCallback(false);
      setStatusMsg({
        ok: true,
        text: res.session.email
          ? `Connected to ChatGPT (${res.session.email})`
          : 'Connected via OpenAI ChatGPT SSO!',
      });
    } catch (err) {
      if (!controller.signal.aborted) {
        setStatusMsg({
          ok: false,
          text: err instanceof Error ? err.message : String(err),
        });
      }
    } finally {
      setDeviceCodeBusy(false);
      setDeviceCodeInfo(null);
    }
  };

  const handleCancelDeviceCode = () => {
    deviceCodeAbortRef.current?.abort();
    setDeviceCodeBusy(false);
    setDeviceCodeInfo(null);
  };

  const handleGoogleSignIn = async () => {
    setStatusMsg(null);
    setOauthBusy(true);
    try {
      await signInWithGoogleOAuth(auth.companionUrl, auth.companionToken);
      const st = await refreshCompanionStatus(
        auth.companionUrl,
        auth.companionToken
      );
      await updateAuth({ activeProvider: 'antigravity' });
      setStatusMsg({
        ok: true,
        text: st?.googleOAuth?.email
          ? `Connected to Google (${st.googleOAuth.email})`
          : 'Connected via Google SSO!',
      });
    } catch (err) {
      setStatusMsg({
        ok: false,
        text: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setOauthBusy(false);
    }
  };

  const handleOpenOfficialSite = async (provider: AIProviderId) => {
    setStatusMsg(null);
    await openProviderWebsite(PROVIDER_AUTH_PORTALS[provider]);
    const labelMap: Record<AIProviderId, string> = {
      antigravity:
        'Opened Google AI Studio — sign in with Google, copy key & tap Paste.',
      claude:
        'Opened Anthropic Console — sign in to Claude, copy key & tap Paste.',
      gpt: 'Opened OpenAI Platform — sign in, copy key & tap Paste.',
    };
    setStatusMsg({ ok: true, text: labelMap[provider] });
  };

  const handlePasteKey = async (target: AIProviderId) => {
    try {
      const clip = (await Clipboard.getStringAsync()).trim();
      if (!clip) {
        setStatusMsg({
          ok: false,
          text: 'Clipboard is empty — authorize & copy a key on the website first.',
        });
        return;
      }
      if (target === 'antigravity') {
        setGeminiKeyDraft(clip);
        await updateAuth({ geminiApiKey: clip, activeProvider: 'antigravity' });
        setStatusMsg({ ok: true, text: 'Google AI key pasted & saved!' });
      } else if (target === 'claude') {
        setClaudeKeyDraft(clip);
        await updateAuth({ claudeApiKey: clip, activeProvider: 'claude' });
        setStatusMsg({ ok: true, text: 'Anthropic Claude key pasted & saved!' });
      } else if (looksLikeOAuthCallbackInput(clip)) {
        const session = await completeOnDeviceChatGPTCallback(clip, auth);
        await updateAuth({
          activeProvider: 'gpt',
          chatgptOAuth: session,
        });
        setAwaitingGptCallback(false);
        setCallbackUrlDraft('');
        setStatusMsg({
          ok: true,
          text: session.email
            ? `Connected to ChatGPT (${session.email})`
            : 'Connected via OpenAI ChatGPT SSO!',
        });
      } else {
        setOpenaiKeyDraft(clip);
        await updateAuth({ openaiApiKey: clip, activeProvider: 'gpt' });
        setStatusMsg({ ok: true, text: 'OpenAI key pasted & saved!' });
      }
    } catch (err) {
      setStatusMsg({
        ok: false,
        text:
          err instanceof Error
            ? err.message
            : 'Paste directly into the key input below.',
      });
    }
  };

  const handleCloseSetup = () => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace('/');
    }
  };

  const handleFinishSetup = async () => {
    const trimmedName = nameInput.trim();
    if (!trimmedName) {
      setSetupError('Please enter your name to finish setting up Plate.');
      scrollRef.current?.scrollTo({ y: 0, animated: true });
      return;
    }

    setSetupError(null);
    setSaving(true);
    try {
      const todayKey = toLocalDateKey();
      const resetCurrentToStart =
        !hasCompletedOnboarding ||
        startWeightEdited ||
        (profile.weightHistory ?? []).length === 0;

      await updateProfile({
        name: trimmedName,
        heightCm: parsedHeightCm,
        startWeightKg: parsedStartWeight,
        goalWeightKg: parsedGoalWeight,
        weightKg: resetCurrentToStart ? parsedStartWeight : profile.weightKg,
        weightHistory: resetCurrentToStart
          ? [{ dateKey: todayKey, weightKg: parsedStartWeight }]
          : profile.weightHistory ?? [],
      });

      await updateGoals({
        dailyCalories: parsedCalories,
        proteinGrams: parsedProtein,
        carbsGrams: parsedCarbs,
        fatGrams: parsedFat,
        dailySteps: parsedStepsGoal,
        waterGlasses: parsedWaterGlasses,
      });

      await updatePreferences({
        addBurned: addBurnedPref,
        rollover: rolloverPref,
        reminders: remindersPref,
      });

      await updateAuth({
        activeProvider: selectedProvider,
        claudeApiKey: claudeKey.trim(),
        openaiApiKey: openaiKey.trim(),
        geminiApiKey: geminiKey.trim(),
      });
      await completeOnboarding();
      router.replace('/');
    } finally {
      setSaving(false);
    }
  };

  const providerConfigState = isProviderConfigured(
    selectedProvider,
    {
      ...auth,
      activeProvider: selectedProvider,
      claudeApiKey: claudeKey.trim(),
      openaiApiKey: openaiKey.trim(),
      geminiApiKey: geminiKey.trim(),
    },
    companionStatus
  );

  const onDeviceChatGPT = Boolean(
    auth.chatgptOAuth?.connected &&
      (auth.chatgptOAuth.accessToken || auth.chatgptOAuth.refreshToken)
  );
  const chatgptConnected =
    onDeviceChatGPT || Boolean(companionStatus?.chatgptOAuth?.connected);
  const chatgptEmail =
    auth.chatgptOAuth?.email || companionStatus?.chatgptOAuth?.email;
  const googleOAuthConfigured = Boolean(
    companionStatus?.googleOAuth?.configured
  );
  const googleConnected = Boolean(companionStatus?.googleOAuth?.connected);
  const versionMeta = getAppVersionMetadata();

  return (
    <PhoneStageFrame>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={[
          styles.frame,
          { paddingTop: isDesktopStage ? 58 : 12 },
        ]}
      >
        <ScrollView
          ref={scrollRef}
          contentContainerStyle={styles.scrollBody}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {/* Brand Header */}
          <View style={styles.headerRow}>
            <View style={styles.brandGroup}>
              <PlateLogoMark size={30} />
              <View>
                <Text style={styles.brandTitle}>Plate</Text>
                <Text style={styles.brandSub}>
                  {`Initial Setup · ${versionMeta.shortBadge}`}
                </Text>
              </View>
            </View>

            {hasCompletedOnboarding ? (
              <Pressable onPress={handleCloseSetup} style={styles.skipPill}>
                <Text style={styles.skipPillText}>Close</Text>
              </Pressable>
            ) : null}
          </View>

          <Text style={styles.headline}>
            Set up your profile, daily targets & AI camera scanner.
          </Text>

          {setupError ? (
            <View style={styles.errorBanner}>
              <Text style={styles.errorBannerText}>{setupError}</Text>
            </View>
          ) : null}

          {/* Card 1: Your Profile (Name, Height, Starting Weight, Goal Weight) */}
          <View style={[styles.card, cardShadow]}>
            <View style={styles.cardTopRow}>
              <Text style={styles.cardTitle}>Your profile</Text>
              <Text style={styles.weightSummaryPill}>
                {`BMI ${previewBmi} · ${
                  Math.abs(weightGoalDelta) < 0.05
                    ? 'Maintain'
                    : weightGoalDelta < 0
                      ? `Target −${Math.abs(weightGoalDelta).toFixed(1)} kg`
                      : `Target +${weightGoalDelta.toFixed(1)} kg`
                }`}
              </Text>
            </View>

            {/* Name + Height Row */}
            <View style={styles.weightSetupRow}>
              <View style={[styles.weightSetupCol, { flex: 1.25 }]}>
                <Text style={styles.weightFieldLabel}>Your name</Text>
                <TextInput
                  value={nameInput}
                  onChangeText={(v) => {
                    if (setupError) setSetupError(null);
                    setNameInput(v);
                  }}
                  placeholder="Enter your name"
                  placeholderTextColor={plateColors.faint}
                  autoCapitalize="words"
                  returnKeyType="done"
                  style={[
                    styles.profileNameInput,
                    setupError && !nameInput.trim()
                      ? styles.profileNameInputError
                      : null,
                  ]}
                />
              </View>

              <View style={[styles.weightSetupCol, { flex: 1 }]}>
                <Text style={styles.weightFieldLabel}>Height</Text>
                <View style={styles.weightInputBox}>
                  <Pressable
                    onPress={() => stepHeight(-1)}
                    hitSlop={6}
                    style={styles.weightMiniStepBtn}
                  >
                    <PlateIcon name="minus" size={14} color={plateColors.ink} />
                  </Pressable>
                  <View style={styles.weightNumberWrap}>
                    <TextInput
                      value={heightInput}
                      onChangeText={setHeightInput}
                      keyboardType="numeric"
                      maxLength={3}
                      style={styles.weightInputText}
                    />
                    <Text style={styles.weightInputUnit}>cm</Text>
                  </View>
                  <Pressable
                    onPress={() => stepHeight(1)}
                    hitSlop={6}
                    style={styles.weightMiniStepBtn}
                  >
                    <PlateIcon name="plus" size={14} color={plateColors.ink} />
                  </Pressable>
                </View>
              </View>
            </View>

            {/* Starting Weight + Goal Weight Row */}
            <View style={styles.weightSetupRow}>
              <View style={styles.weightSetupCol}>
                <Text style={styles.weightFieldLabel}>Starting weight</Text>
                <View style={styles.weightInputBox}>
                  <Pressable
                    onPress={() => stepStartWeight(-0.5)}
                    hitSlop={6}
                    style={styles.weightMiniStepBtn}
                  >
                    <PlateIcon name="minus" size={14} color={plateColors.ink} />
                  </Pressable>
                  <View style={styles.weightNumberWrap}>
                    <TextInput
                      value={startWeightInput}
                      onChangeText={(v) => {
                        setStartWeightEdited(true);
                        setStartWeightInput(v);
                      }}
                      keyboardType="decimal-pad"
                      maxLength={5}
                      style={styles.weightInputText}
                    />
                    <Text style={styles.weightInputUnit}>kg</Text>
                  </View>
                  <Pressable
                    onPress={() => stepStartWeight(0.5)}
                    hitSlop={6}
                    style={styles.weightMiniStepBtn}
                  >
                    <PlateIcon name="plus" size={14} color={plateColors.ink} />
                  </Pressable>
                </View>
              </View>

              <View style={styles.weightSetupCol}>
                <Text style={styles.weightFieldLabel}>Goal weight</Text>
                <View style={styles.weightInputBox}>
                  <Pressable
                    onPress={() => stepGoalWeight(-0.5)}
                    hitSlop={6}
                    style={styles.weightMiniStepBtn}
                  >
                    <PlateIcon name="minus" size={14} color={plateColors.ink} />
                  </Pressable>
                  <View style={styles.weightNumberWrap}>
                    <TextInput
                      value={goalWeightInput}
                      onChangeText={setGoalWeightInput}
                      keyboardType="decimal-pad"
                      maxLength={5}
                      style={styles.weightInputText}
                    />
                    <Text style={styles.weightInputUnit}>kg</Text>
                  </View>
                  <Pressable
                    onPress={() => stepGoalWeight(0.5)}
                    hitSlop={6}
                    style={styles.weightMiniStepBtn}
                  >
                    <PlateIcon name="plus" size={14} color={plateColors.ink} />
                  </Pressable>
                </View>
              </View>
            </View>
          </View>

          {/* Card 2: Daily Calorie & Macro Targets */}
          <View style={[styles.card, cardShadow]}>
            <View style={styles.cardTopRow}>
              <Text style={styles.cardTitle}>Daily calories & macros</Text>
              <Text style={styles.macroSummary}>
                <Text style={{ color: plateColors.protein }}>
                  {`${parsedProtein}P`}
                </Text>
                {' · '}
                <Text style={{ color: plateColors.carbs }}>
                  {`${parsedCarbs}C`}
                </Text>
                {' · '}
                <Text style={{ color: plateColors.fat }}>
                  {`${parsedFat}F`}
                </Text>
              </Text>
            </View>

            <View style={styles.stepperRow}>
              <Pressable
                onPress={() => stepCalories(-50)}
                style={styles.roundChipBtn}
              >
                <PlateIcon name="minus" size={18} color={plateColors.ink} />
              </Pressable>

              <View style={styles.calorieInputCenter}>
                <TextInput
                  value={calorieInput}
                  onChangeText={handleCalorieChange}
                  keyboardType="numeric"
                  maxLength={5}
                  style={styles.calorieBigInput}
                />
                <Text style={styles.calorieUnit}>kcal / day</Text>
              </View>

              <Pressable
                onPress={() => stepCalories(50)}
                style={[styles.roundChipBtn, styles.roundDarkBtn]}
              >
                <PlateIcon name="plus" size={18} color="#FFFFFF" />
              </Pressable>
            </View>

            <View style={styles.presetsRow}>
              {CALORIE_PRESETS.map((val) => {
                const active = parsedCalories === val;
                return (
                  <Pressable
                    key={val}
                    onPress={() => {
                      setCalorieInput(String(val));
                      syncMacrosFromCaloriesAndSplit(val, macroSplit);
                    }}
                    style={[
                      styles.presetChip,
                      active ? styles.presetChipActive : null,
                    ]}
                  >
                    <Text
                      style={[
                        styles.presetChipText,
                        active ? styles.presetChipTextActive : null,
                      ]}
                    >
                      {val}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            <View style={styles.segmentedBar}>
              {(Object.keys(MACRO_SPLITS) as MacroSplitId[]).map((id) => {
                const active = !customMacrosEdited && macroSplit === id;
                return (
                  <Pressable
                    key={id}
                    onPress={() => {
                      setMacroSplit(id);
                      syncMacrosFromCaloriesAndSplit(parsedCalories, id);
                    }}
                    style={[
                      styles.segItem,
                      active ? styles.segItemActive : null,
                    ]}
                  >
                    <Text
                      style={[
                        styles.segText,
                        active ? styles.segTextActive : null,
                      ]}
                    >
                      {MACRO_SPLITS[id].label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            {/* Editable Protein / Carbs / Fats Grams */}
            <View style={styles.macroInputsRow}>
              <View style={styles.macroInputCol}>
                <Text
                  style={[styles.weightFieldLabel, { color: plateColors.protein }]}
                >
                  Protein (g)
                </Text>
                <TextInput
                  value={proteinInput}
                  onChangeText={(v) => {
                    setCustomMacrosEdited(true);
                    setProteinInput(v);
                  }}
                  keyboardType="numeric"
                  maxLength={4}
                  style={styles.macroSmallInput}
                />
              </View>
              <View style={styles.macroInputCol}>
                <Text
                  style={[styles.weightFieldLabel, { color: plateColors.carbs }]}
                >
                  Carbs (g)
                </Text>
                <TextInput
                  value={carbsInput}
                  onChangeText={(v) => {
                    setCustomMacrosEdited(true);
                    setCarbsInput(v);
                  }}
                  keyboardType="numeric"
                  maxLength={4}
                  style={styles.macroSmallInput}
                />
              </View>
              <View style={styles.macroInputCol}>
                <Text
                  style={[styles.weightFieldLabel, { color: plateColors.fat }]}
                >
                  Fats (g)
                </Text>
                <TextInput
                  value={fatInput}
                  onChangeText={(v) => {
                    setCustomMacrosEdited(true);
                    setFatInput(v);
                  }}
                  keyboardType="numeric"
                  maxLength={4}
                  style={styles.macroSmallInput}
                />
              </View>
            </View>
          </View>

          {/* Card 3: Activity, Hydration & Preferences */}
          <View style={[styles.card, cardShadow]}>
            <Text style={styles.cardTitle}>Activity, water & budget</Text>

            <View style={styles.weightSetupRow}>
              <View style={styles.weightSetupCol}>
                <Text style={styles.weightFieldLabel}>Daily steps goal</Text>
                <View style={styles.weightInputBox}>
                  <Pressable
                    onPress={() => stepStepsGoal(-500)}
                    hitSlop={6}
                    style={styles.weightMiniStepBtn}
                  >
                    <PlateIcon name="minus" size={14} color={plateColors.ink} />
                  </Pressable>
                  <View style={styles.weightNumberWrap}>
                    <TextInput
                      value={stepsInput}
                      onChangeText={setStepsInput}
                      keyboardType="numeric"
                      maxLength={6}
                      style={[styles.weightInputText, { fontSize: 16 }]}
                    />
                  </View>
                  <Pressable
                    onPress={() => stepStepsGoal(500)}
                    hitSlop={6}
                    style={styles.weightMiniStepBtn}
                  >
                    <PlateIcon name="plus" size={14} color={plateColors.ink} />
                  </Pressable>
                </View>
              </View>

              <View style={styles.weightSetupCol}>
                <Text style={styles.weightFieldLabel}>Daily water goal</Text>
                <View style={styles.weightInputBox}>
                  <Pressable
                    onPress={() => stepWaterGoal(-1)}
                    hitSlop={6}
                    style={styles.weightMiniStepBtn}
                  >
                    <PlateIcon name="minus" size={14} color={plateColors.ink} />
                  </Pressable>
                  <View style={styles.weightNumberWrap}>
                    <TextInput
                      value={waterInput}
                      onChangeText={setWaterInput}
                      keyboardType="numeric"
                      maxLength={2}
                      style={styles.weightInputText}
                    />
                    <Text style={styles.weightInputUnit}>gl</Text>
                  </View>
                  <Pressable
                    onPress={() => stepWaterGoal(1)}
                    hitSlop={6}
                    style={styles.weightMiniStepBtn}
                  >
                    <PlateIcon name="plus" size={14} color={plateColors.ink} />
                  </Pressable>
                </View>
              </View>
            </View>

            <View style={styles.prefToggleList}>
              {[
                {
                  label: 'Add burned calories to daily budget',
                  val: addBurnedPref,
                  toggle: () => setAddBurnedPref((v) => !v),
                },
                {
                  label: 'Roll over unused calories',
                  val: rolloverPref,
                  toggle: () => setRolloverPref((v) => !v),
                },
                {
                  label: 'Meal logging reminders',
                  val: remindersPref,
                  toggle: () => setRemindersPref((v) => !v),
                },
              ].map((item, idx) => (
                <Pressable
                  key={item.label}
                  onPress={item.toggle}
                  style={[
                    styles.prefToggleRow,
                    idx === 2 ? { borderBottomWidth: 0, paddingBottom: 0 } : null,
                  ]}
                >
                  <Text style={styles.prefToggleLabel}>{item.label}</Text>
                  <View
                    style={[
                      styles.miniSwitchTrack,
                      item.val ? styles.miniSwitchTrackOn : null,
                    ]}
                  >
                    <View
                      style={[
                        styles.miniSwitchThumb,
                        item.val ? styles.miniSwitchThumbOn : null,
                      ]}
                    />
                  </View>
                </Pressable>
              ))}
            </View>
          </View>

          {/* Card 4: Official AI Provider SSO */}
          <View style={[styles.card, cardShadow]}>
            <View style={styles.cardTopRow}>
              <Text style={styles.cardTitle}>Authorize AI provider</Text>
              <View style={styles.authBadge}>
                <View
                  style={[
                    styles.authDot,
                    {
                      backgroundColor: providerConfigState.ready
                        ? plateColors.ok
                        : plateColors.faint,
                    },
                  ]}
                />
                <Text style={styles.authBadgeText}>
                  {providerConfigState.ready ? 'Authorized' : 'Optional'}
                </Text>
              </View>
            </View>

            <View style={styles.segmentedBar}>
              {(['antigravity', 'claude', 'gpt'] as AIProviderId[]).map((id) => {
                const active = selectedProvider === id;
                return (
                  <Pressable
                    key={id}
                    onPress={() => {
                      setSelectedProvider(id);
                      setStatusMsg(null);
                    }}
                    style={[
                      styles.segItem,
                      active ? styles.segItemActive : null,
                    ]}
                  >
                    <Text
                      style={[
                        styles.segText,
                        active ? styles.segTextActive : null,
                      ]}
                    >
                      {colors.providers[id].label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            {statusMsg ? (
              <View
                style={[
                  styles.msgBanner,
                  {
                    backgroundColor: statusMsg.ok ? '#E8FAF0' : '#FFE9E7',
                  },
                ]}
              >
                <Text
                  style={[
                    styles.msgBannerText,
                    { color: statusMsg.ok ? '#1E9E5A' : plateColors.danger },
                  ]}
                  numberOfLines={2}
                >
                  {statusMsg.text}
                </Text>
              </View>
            ) : null}

            {selectedProvider === 'antigravity' ? (
              <View style={styles.authControls}>
                {googleConnected ? (
                  <View style={styles.connectedRow}>
                    <Text style={styles.connectedText} numberOfLines={1}>
                      {`✓ Google SSO (${
                        companionStatus?.googleOAuth?.email || 'Connected'
                      })`}
                    </Text>
                    <Pressable
                      onPress={async () => {
                        await disconnectGoogleOAuth(
                          auth.companionUrl,
                          auth.companionToken
                        );
                        await refreshCompanionStatus();
                      }}
                    >
                      <Text style={styles.signOutText}>Sign out</Text>
                    </Pressable>
                  </View>
                ) : googleOAuthConfigured ? (
                  <Pressable
                    onPress={handleGoogleSignIn}
                    disabled={oauthBusy}
                    style={styles.ssoBtn}
                  >
                    {oauthBusy ? (
                      <ActivityIndicator size="small" color="#FFFFFF" />
                    ) : (
                      <PlateIcon name="sparkle" size={16} color="#FFFFFF" />
                    )}
                    <Text style={styles.ssoBtnText}>
                      Sign in with Google SSO (accounts.google.com)
                    </Text>
                  </Pressable>
                ) : (
                  <Pressable
                    onPress={() => handleOpenOfficialSite('antigravity')}
                    style={styles.ssoBtn}
                  >
                    <PlateIcon name="sparkle" size={16} color="#FFFFFF" />
                    <Text style={styles.ssoBtnText}>
                      Authorize on Google AI Studio ↗
                    </Text>
                  </Pressable>
                )}

                <View style={styles.inputRow}>
                  <TextInput
                    value={geminiKey}
                    onChangeText={setGeminiKeyDraft}
                    secureTextEntry
                    autoCapitalize="none"
                    autoCorrect={false}
                    placeholder="Paste Google AI key (AIzaSy...)"
                    placeholderTextColor={plateColors.faint}
                    style={styles.input}
                  />
                  <Pressable
                    onPress={() => handlePasteKey('antigravity')}
                    style={styles.miniBtn}
                  >
                    <Text style={styles.miniBtnText}>Paste</Text>
                  </Pressable>
                  <Pressable
                    onPress={() => refreshCompanionStatus()}
                    disabled={isCheckingCompanion}
                    style={styles.miniBtn}
                  >
                    <Text style={styles.miniBtnText}>
                      {isCheckingCompanion
                        ? '…'
                        : companionStatus?.ok
                          ? 'SDK ✓'
                          : 'Check'}
                    </Text>
                  </Pressable>
                </View>
              </View>
            ) : null}

            {selectedProvider === 'claude' ? (
              <View style={styles.authControls}>
                <Pressable
                  onPress={() => handleOpenOfficialSite('claude')}
                  style={styles.ssoBtn}
                >
                  <PlateIcon name="sparkle" size={16} color="#FFFFFF" />
                  <Text style={styles.ssoBtnText}>
                    Authorize on Anthropic Console ↗
                  </Text>
                </Pressable>

                <View style={styles.inputRow}>
                  <TextInput
                    value={claudeKey}
                    onChangeText={setClaudeKeyDraft}
                    secureTextEntry
                    autoCapitalize="none"
                    autoCorrect={false}
                    placeholder="Paste Claude key (sk-ant-...)"
                    placeholderTextColor={plateColors.faint}
                    style={styles.input}
                  />
                  <Pressable
                    onPress={() => handlePasteKey('claude')}
                    style={styles.miniBtn}
                  >
                    <Text style={styles.miniBtnText}>Paste</Text>
                  </Pressable>
                </View>
              </View>
            ) : null}

            {selectedProvider === 'gpt' ? (
              <View style={styles.authControls}>
                {chatgptConnected ? (
                  <View style={styles.connectedRow}>
                    <Text style={styles.connectedText} numberOfLines={1}>
                      {`✓ ChatGPT SSO (${chatgptEmail || 'Connected'})`}
                    </Text>
                    <Pressable
                      onPress={async () => {
                        const clearedSession = auth.chatgptOAuth
                          ? {
                              ...auth.chatgptOAuth,
                              connected: false,
                              accessToken: '',
                              refreshToken: '',
                              expiresAt: 0,
                            }
                          : undefined;
                        await updateAuth({ chatgptOAuth: clearedSession });
                        await disconnectChatGPTOAuth(
                          auth.companionUrl,
                          auth.companionToken
                        );
                        await refreshCompanionStatus();
                      }}
                    >
                      <Text style={styles.signOutText}>Sign out</Text>
                    </Pressable>
                  </View>
                ) : (
                  <>
                    <Pressable
                      onPress={handleChatGPTSignIn}
                      disabled={oauthBusy || deviceCodeBusy}
                      style={styles.ssoBtn}
                    >
                      {oauthBusy ? (
                        <ActivityIndicator size="small" color="#FFFFFF" />
                      ) : (
                        <PlateIcon name="sparkle" size={16} color="#FFFFFF" />
                      )}
                      <Text style={styles.ssoBtnText}>
                        Sign in with ChatGPT (auth.openai.com)
                      </Text>
                    </Pressable>

                    {awaitingGptCallback ? (
                      <View style={styles.callbackBox}>
                        <Text style={styles.callbackHint}>
                          After approving on OpenAI, copy the 127.0.0.1 redirect
                          URL from your browser bar and tap Complete:
                        </Text>
                        <TextInput
                          value={callbackUrlDraft}
                          onChangeText={setCallbackUrlDraft}
                          autoCapitalize="none"
                          autoCorrect={false}
                          placeholder="Or paste http://127.0.0.1:1455/auth/callback?..."
                          placeholderTextColor={plateColors.faint}
                          style={styles.callbackInput}
                        />
                        <View style={styles.callbackActions}>
                          <Pressable
                            onPress={handleCompleteGptCallback}
                            disabled={oauthBusy}
                            style={styles.callbackPrimaryBtn}
                          >
                            <Text style={styles.callbackPrimaryBtnText}>
                              Complete Sign-In from Clipboard
                            </Text>
                          </Pressable>
                          <Pressable
                            onPress={handleCancelGptCallback}
                            style={styles.miniBtn}
                          >
                            <Text style={styles.miniBtnText}>Cancel</Text>
                          </Pressable>
                        </View>
                      </View>
                    ) : null}

                    {deviceCodeBusy ? (
                      <View style={styles.callbackBox}>
                        <View style={styles.deviceCodeHeader}>
                          <ActivityIndicator
                            size="small"
                            color={plateColors.ink}
                          />
                          <Text style={styles.deviceCodeTitle}>
                            {deviceCodeInfo
                              ? `Code: ${deviceCodeInfo.userCode}`
                              : 'Requesting sign-in code…'}
                          </Text>
                          {deviceCodeInfo ? (
                            <Pressable
                              onPress={async () => {
                                await Clipboard.setStringAsync(
                                  deviceCodeInfo.userCode
                                );
                                setStatusMsg({
                                  ok: true,
                                  text: `Copied code ${deviceCodeInfo.userCode}`,
                                });
                              }}
                              style={styles.miniBtn}
                            >
                              <Text style={styles.miniBtnText}>Copy</Text>
                            </Pressable>
                          ) : null}
                          <Pressable
                            onPress={handleCancelDeviceCode}
                            style={styles.miniBtn}
                          >
                            <Text style={styles.miniBtnText}>Cancel</Text>
                          </Pressable>
                        </View>
                        <Text style={styles.callbackHint}>
                          Paste this code on auth.openai.com/codex/device —
                          Plate finishes connecting automatically.
                        </Text>
                      </View>
                    ) : (
                      <Pressable
                        onPress={handleDeviceCodeSignIn}
                        disabled={oauthBusy}
                        style={styles.secondaryAuthBtn}
                      >
                        <Text style={styles.secondaryAuthBtnText}>
                          Sign in with 8-digit code (no URL copy)
                        </Text>
                      </Pressable>
                    )}
                  </>
                )}

                <View style={styles.inputRow}>
                  <TextInput
                    value={openaiKey}
                    onChangeText={setOpenaiKeyDraft}
                    secureTextEntry
                    autoCapitalize="none"
                    autoCorrect={false}
                    placeholder="Or OpenAI key (sk-proj-...)"
                    placeholderTextColor={plateColors.faint}
                    style={styles.input}
                  />
                  <Pressable
                    onPress={() => handlePasteKey('gpt')}
                    style={styles.miniBtn}
                  >
                    <Text style={styles.miniBtnText}>Paste</Text>
                  </Pressable>
                  <Pressable
                    onPress={() => handleOpenOfficialSite('gpt')}
                    style={styles.miniBtn}
                  >
                    <Text style={styles.miniBtnText}>Keys ↗</Text>
                  </Pressable>
                </View>
              </View>
            ) : null}
          </View>
        </ScrollView>

        {/* Pinned Primary Action */}
        <View style={styles.footer}>
          <Pressable
            onPress={handleFinishSetup}
            disabled={saving}
            style={({ pressed }) => [
              styles.startBtn,
              pressed ? { transform: [{ scale: 0.98 }] } : null,
            ]}
          >
            <Text style={styles.startBtnText}>
              {saving ? 'Saving…' : 'Continue to Plate'}
            </Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </PhoneStageFrame>
  );
}

const styles = StyleSheet.create({
  frame: {
    flex: 1,
    backgroundColor: plateColors.bg,
    paddingHorizontal: 20,
    paddingBottom: 18,
  },
  scrollBody: {
    gap: 12,
    paddingBottom: 12,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  brandGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  brandTitle: {
    fontSize: 23,
    fontWeight: '700',
    color: plateColors.ink,
    letterSpacing: -0.8,
  },
  brandSub: {
    fontSize: 11.5,
    fontWeight: '600',
    color: plateColors.muted,
  },
  skipPill: {
    backgroundColor: plateColors.card,
    paddingHorizontal: 13,
    paddingVertical: 7,
    borderRadius: 99,
  },
  skipPillText: {
    fontSize: 13,
    fontWeight: '600',
    color: plateColors.ink2,
  },
  headline: {
    fontSize: 15,
    fontWeight: '500',
    color: plateColors.ink2,
    marginBottom: 2,
  },
  errorBanner: {
    backgroundColor: '#FFE9E7',
    borderRadius: 14,
    paddingHorizontal: 13,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: 'rgba(229,72,77,0.28)',
  },
  errorBannerText: {
    fontSize: 13,
    fontWeight: '600',
    color: plateColors.danger,
  },
  profileNameInput: {
    height: 46,
    borderRadius: 14,
    backgroundColor: plateColors.chip,
    paddingHorizontal: 13,
    fontSize: 15.5,
    fontWeight: '600',
    color: plateColors.ink,
  },
  profileNameInputError: {
    borderWidth: 1.5,
    borderColor: plateColors.danger,
    backgroundColor: '#FFF5F5',
  },
  macroInputsRow: {
    flexDirection: 'row',
    gap: 8,
  },
  macroInputCol: {
    flex: 1,
    gap: 5,
  },
  macroSmallInput: {
    height: 40,
    borderRadius: 12,
    backgroundColor: plateColors.chip,
    textAlign: 'center',
    fontSize: 15,
    fontWeight: '700',
    color: plateColors.ink,
    fontVariant: ['tabular-nums'],
  },
  prefToggleList: {
    borderTopWidth: 1,
    borderTopColor: plateColors.line,
    paddingTop: 4,
  },
  prefToggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: plateColors.line,
  },
  prefToggleLabel: {
    flex: 1,
    fontSize: 13.5,
    fontWeight: '500',
    color: plateColors.ink,
    paddingRight: 10,
  },
  miniSwitchTrack: {
    width: 44,
    height: 26,
    borderRadius: 13,
    backgroundColor: '#E2E2E6',
    padding: 2.5,
    justifyContent: 'center',
  },
  miniSwitchTrackOn: {
    backgroundColor: plateColors.ink,
  },
  miniSwitchThumb: {
    width: 21,
    height: 21,
    borderRadius: 10.5,
    backgroundColor: '#FFFFFF',
  },
  miniSwitchThumbOn: {
    transform: [{ translateX: 18 }],
  },
  card: {
    backgroundColor: plateColors.card,
    borderRadius: 26,
    padding: 16,
    gap: 12,
  },
  cardTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: plateColors.ink,
    letterSpacing: -0.3,
  },
  macroSummary: {
    fontSize: 12.5,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  stepperRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 6,
  },
  roundChipBtn: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: plateColors.chip,
    alignItems: 'center',
    justifyContent: 'center',
  },
  roundDarkBtn: {
    backgroundColor: plateColors.ink,
  },
  calorieInputCenter: {
    alignItems: 'center',
  },
  calorieBigInput: {
    fontSize: 38,
    fontWeight: '700',
    color: plateColors.ink,
    textAlign: 'center',
    letterSpacing: -1.3,
    fontVariant: ['tabular-nums'],
    paddingVertical: 0,
    minWidth: 120,
  },
  calorieUnit: {
    fontSize: 12.5,
    fontWeight: '500',
    color: plateColors.muted,
    marginTop: -2,
  },
  presetsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 6,
  },
  presetChip: {
    flex: 1,
    height: 32,
    borderRadius: 10,
    backgroundColor: plateColors.chip,
    alignItems: 'center',
    justifyContent: 'center',
  },
  presetChipActive: {
    backgroundColor: plateColors.ink,
  },
  presetChipText: {
    fontSize: 12.5,
    fontWeight: '600',
    color: plateColors.ink2,
    fontVariant: ['tabular-nums'],
  },
  presetChipTextActive: {
    color: '#FFFFFF',
  },
  segmentedBar: {
    flexDirection: 'row',
    backgroundColor: plateColors.chip,
    borderRadius: 12,
    padding: 3,
  },
  segItem: {
    flex: 1,
    height: 31,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  segItemActive: {
    backgroundColor: '#FFFFFF',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 3,
    elevation: 1,
  },
  segText: {
    fontSize: 12.5,
    fontWeight: '600',
    color: plateColors.muted,
  },
  segTextActive: {
    color: plateColors.ink,
  },
  weightSummaryPill: {
    fontSize: 12,
    fontWeight: '600',
    color: plateColors.ok,
    fontVariant: ['tabular-nums'],
  },
  weightSetupRow: {
    flexDirection: 'row',
    gap: 10,
  },
  weightSetupCol: {
    flex: 1,
    gap: 6,
  },
  weightFieldLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: plateColors.muted,
  },
  weightInputBox: {
    height: 46,
    borderRadius: 14,
    backgroundColor: plateColors.chip,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 6,
  },
  weightMiniStepBtn: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  weightNumberWrap: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'center',
    gap: 2,
  },
  weightInputText: {
    fontSize: 18,
    fontWeight: '700',
    color: plateColors.ink,
    textAlign: 'center',
    fontVariant: ['tabular-nums'],
    paddingVertical: 0,
    minWidth: 42,
  },
  weightInputUnit: {
    fontSize: 12,
    fontWeight: '600',
    color: plateColors.muted,
  },
  authBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  authDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  authBadgeText: {
    fontSize: 12,
    fontWeight: '600',
    color: plateColors.muted,
  },
  msgBanner: {
    paddingHorizontal: 11,
    paddingVertical: 8,
    borderRadius: 11,
  },
  msgBannerText: {
    fontSize: 12,
    fontWeight: '600',
  },
  authControls: {
    gap: 9,
  },
  ssoBtn: {
    height: 44,
    borderRadius: 14,
    backgroundColor: plateColors.ink,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: 14,
  },
  ssoBtnText: {
    color: '#FFFFFF',
    fontSize: 13.5,
    fontWeight: '600',
  },
  secondaryAuthBtn: {
    height: 36,
    borderRadius: 11,
    backgroundColor: plateColors.chip,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  secondaryAuthBtnText: {
    fontSize: 12.5,
    fontWeight: '600',
    color: plateColors.ink2,
  },
  callbackBox: {
    backgroundColor: plateColors.bg,
    borderRadius: 14,
    padding: 10,
    gap: 8,
    borderWidth: 1,
    borderColor: plateColors.line,
  },
  callbackHint: {
    fontSize: 11.5,
    lineHeight: 15.5,
    color: plateColors.muted,
  },
  callbackInput: {
    height: 36,
    borderRadius: 10,
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 10,
    fontSize: 12.5,
    color: plateColors.ink,
    borderWidth: 1,
    borderColor: plateColors.line,
  },
  callbackActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  callbackPrimaryBtn: {
    flex: 1,
    height: 38,
    borderRadius: 10,
    backgroundColor: plateColors.ink,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 10,
  },
  callbackPrimaryBtnText: {
    color: '#FFFFFF',
    fontSize: 12.5,
    fontWeight: '600',
  },
  deviceCodeHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  deviceCodeTitle: {
    flex: 1,
    fontSize: 13.5,
    fontWeight: '700',
    color: plateColors.ink,
    fontVariant: ['tabular-nums'],
  },
  connectedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#E8FAF0',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
  },
  connectedText: {
    flex: 1,
    fontSize: 13,
    fontWeight: '600',
    color: '#1E9E5A',
  },
  signOutText: {
    fontSize: 12.5,
    fontWeight: '700',
    color: plateColors.danger,
    marginLeft: 8,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  input: {
    flex: 1,
    height: 40,
    borderRadius: 12,
    backgroundColor: plateColors.chip,
    paddingHorizontal: 12,
    fontSize: 13,
    color: plateColors.ink,
  },
  miniBtn: {
    height: 40,
    paddingHorizontal: 11,
    borderRadius: 12,
    backgroundColor: plateColors.chip,
    alignItems: 'center',
    justifyContent: 'center',
  },
  miniBtnText: {
    fontSize: 12.5,
    fontWeight: '600',
    color: plateColors.ink,
  },
  footer: {
    paddingTop: 8,
  },
  startBtn: {
    height: 54,
    borderRadius: 99,
    backgroundColor: plateColors.ink,
    alignItems: 'center',
    justifyContent: 'center',
  },
  startBtnText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
});
