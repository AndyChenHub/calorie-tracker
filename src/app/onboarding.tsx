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
  const {
    hasCompletedOnboarding,
    goals,
    updateGoals,
    auth,
    updateAuth,
    companionStatus,
    isCheckingCompanion,
    refreshCompanionStatus,
    completeOnboarding,
  } = useCalorieTracker();

  const [calorieInput, setCalorieInput] = useState(
    String(goals.dailyCalories || 2250)
  );
  const [macroSplit, setMacroSplit] = useState<MacroSplitId>('balanced');
  const [goalsEdited, setGoalsEdited] = useState(false);
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

  const parsedCalories = Math.max(800, parseInt(calorieInput, 10) || 2250);
  const split = MACRO_SPLITS[macroSplit];
  const preserveSavedMacros = hasCompletedOnboarding && !goalsEdited;
  const computedProtein = preserveSavedMacros
    ? goals.proteinGrams
    : Math.round((parsedCalories * split.p) / 4);
  const computedCarbs = preserveSavedMacros
    ? goals.carbsGrams
    : Math.round((parsedCalories * split.c) / 4);
  const computedFat = preserveSavedMacros
    ? goals.fatGrams
    : Math.round((parsedCalories * split.f) / 9);

  const stepCalories = (delta: number) => {
    const next = Math.max(1000, Math.min(6000, parsedCalories + delta));
    setGoalsEdited(true);
    setCalorieInput(String(next));
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

  const handleSkipSetup = async () => {
    setSaving(true);
    try {
      await completeOnboarding();
      router.replace('/');
    } finally {
      setSaving(false);
    }
  };

  const handleFinishSetup = async () => {
    setSaving(true);
    try {
      if (!hasCompletedOnboarding || goalsEdited) {
        await updateGoals({
          ...goals,
          dailyCalories: parsedCalories,
          proteinGrams: computedProtein,
          carbsGrams: computedCarbs,
          fatGrams: computedFat,
        });
      }
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
                  {`Setup · ${versionMeta.shortBadge}`}
                </Text>
              </View>
            </View>

            <Pressable
              onPress={handleSkipSetup}
              style={styles.skipPill}
            >
              <Text style={styles.skipPillText}>Skip</Text>
            </Pressable>
          </View>

          <Text style={styles.headline}>
            Set your daily goal & connect AI vision.
          </Text>

          {/* Card 1: Daily Calorie Target */}
          <View style={[styles.card, cardShadow]}>
            <View style={styles.cardTopRow}>
              <Text style={styles.cardTitle}>Daily calorie goal</Text>
              <Text style={styles.macroSummary}>
                <Text style={{ color: plateColors.protein }}>
                  {`${computedProtein}P`}
                </Text>
                {' · '}
                <Text style={{ color: plateColors.carbs }}>
                  {`${computedCarbs}C`}
                </Text>
                {' · '}
                <Text style={{ color: plateColors.fat }}>
                  {`${computedFat}F`}
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
                  onChangeText={(v) => {
                    setGoalsEdited(true);
                    setCalorieInput(v);
                  }}
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
                      setGoalsEdited(true);
                      setCalorieInput(String(val));
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
                const active = !preserveSavedMacros && macroSplit === id;
                return (
                  <Pressable
                    key={id}
                    onPress={() => {
                      setGoalsEdited(true);
                      setMacroSplit(id);
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
          </View>

          {/* Card 2: Official AI Provider SSO */}
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
