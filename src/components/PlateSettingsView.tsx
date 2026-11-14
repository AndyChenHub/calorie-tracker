import * as Clipboard from 'expo-clipboard';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Keyboard,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import {
  estimateStepMeters,
  formatHeightMetric,
  formatMetersMetric,
  formatNum,
  formatWaterLiters,
} from '../constants/plateCatalog';
import { getAppVersionMetadata } from '../constants/version';
import { useCalorieTracker } from '../context/CalorieContext';
import {
  cancelPendingChatGPTSignIn,
  clearAIDiagnosticLogs,
  completeOnDeviceChatGPTCallback,
  detectApiKeyProvider,
  disconnectChatGPTOAuth,
  disconnectGoogleOAuth,
  formatAIDiagnosticLogsText,
  getAIDiagnosticLogs,
  isProviderConfigured,
  looksLikeOAuthCallbackInput,
  openProviderPortalForKey,
  signInWithGoogleOAuth,
  startChatGPTDeviceCodeSignIn,
  startChatGPTSignIn,
  subscribeAIDiagnosticLogs,
  verifyAIConnection,
} from '../services/ai';
import { cardShadow, colors, plateColors } from '../theme/colors';
import {
  AIConnectionTestResult,
  AIDiagnosticLogEntry,
  AIProviderId,
  UserGoals,
} from '../types/models';
import { useKeyboardState } from '../utils/useKeyboardState';
import { useIsDesktopStage } from './PhoneStageFrame';
import { PlateIcon } from './PlatePrimitives';

interface PlateSettingsViewProps {
  onOpenProfileSheet: () => void;
}

export function PlateSettingsView({
  onOpenProfileSheet,
}: PlateSettingsViewProps) {
  const {
    profile,
    goals,
    updateGoals,
    preferences,
    updatePreferences,
    auth,
    updateAuth,
    companionStatus,
    isCheckingCompanion,
    refreshCompanionStatus,
    clearAllLogs,
    exportBackupJson,
    showToast,
    aiLogsExpandSignal,
  } = useCalorieTracker();

  const isDesktopStage = useIsDesktopStage();
  const keyboard = useKeyboardState();
  const scrollRef = useRef<React.ComponentRef<typeof ScrollView> | null>(null);
  const aiSectionYRef = useRef<number>(0);
  const [oauthBusy, setOauthBusy] = useState(false);
  const [awaitingGptCallback, setAwaitingGptCallback] = useState(false);
  const [callbackUrlDraft, setCallbackUrlDraft] = useState('');
  const [deviceCodeBusy, setDeviceCodeBusy] = useState(false);
  const [deviceCodeInfo, setDeviceCodeInfo] = useState<{
    userCode: string;
    verificationUrl: string;
  } | null>(null);
  const deviceCodeAbortRef = useRef<AbortController | null>(null);
  const [showCompanionEdit, setShowCompanionEdit] = useState(false);
  const [companionUrlDraft, setCompanionUrlDraft] = useState<string | null>(
    null
  );
  const [testingAi, setTestingAi] = useState(false);
  const [testResult, setTestResult] = useState<AIConnectionTestResult | null>(
    null
  );
  const [aiLogs, setAiLogs] = useState<AIDiagnosticLogEntry[]>(() =>
    getAIDiagnosticLogs()
  );
  const [logsOpen, setLogsOpen] = useState<boolean>(
    () => aiLogsExpandSignal > 0
  );
  const [clearTapCount, setClearTapCount] = useState(0);
  const [clearedPopupOpen, setClearedPopupOpen] = useState(false);
  const clearTapTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const unsub = subscribeAIDiagnosticLogs(setAiLogs);
    return () => {
      unsub();
      deviceCodeAbortRef.current?.abort();
      if (clearTapTimerRef.current) {
        clearTimeout(clearTapTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (aiLogsExpandSignal > 0) {
      const timer = setTimeout(() => {
        setLogsOpen(true);
        scrollRef.current?.scrollTo({
          y: Math.max(0, aiSectionYRef.current - 12),
          animated: true,
        });
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [aiLogsExpandSignal]);

  const handleClearMealsPress = async () => {
    if (clearTapTimerRef.current) {
      clearTimeout(clearTapTimerRef.current);
    }
    const next = clearTapCount + 1;
    if (next >= 5) {
      setClearTapCount(0);
      await clearAllLogs();
      setClearedPopupOpen(true);
      return;
    }
    setClearTapCount(next);
    clearTapTimerRef.current = setTimeout(() => {
      setClearTapCount(0);
    }, 4000);
  };

  const initials = profile.name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase() || '')
    .join('');

  const versionMeta = getAppVersionMetadata();
  const activeProvider = auth.activeProvider;
  const providerStatus = isProviderConfigured(
    activeProvider,
    auth,
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

  const stepGoal = (
    field: keyof UserGoals,
    delta: number,
    minVal: number = 0
  ) => {
    const nextVal = Math.max(minVal, (goals[field] || 0) + delta);
    updateGoals({ ...goals, [field]: nextVal });
  };

  const handleOpenOfficialSite = async (provider: AIProviderId) => {
    const capturedKey = await openProviderPortalForKey(provider);
    if (capturedKey) {
      if (provider === 'antigravity') {
        await updateAuth({
          geminiApiKey: capturedKey,
          activeProvider: 'antigravity',
        });
        showToast('Google AI key connected automatically!');
      } else if (provider === 'claude') {
        await updateAuth({
          claudeApiKey: capturedKey,
          activeProvider: 'claude',
        });
        showToast('Claude key connected automatically!');
      } else {
        await updateAuth({
          openaiApiKey: capturedKey,
          activeProvider: 'gpt',
        });
        showToast('OpenAI key connected automatically!');
      }
      return;
    }
    if (Platform.OS === 'web') {
      showToast('Opened official portal — copy key & tap Paste');
    }
  };

  const handlePasteKey = async (target: AIProviderId) => {
    try {
      const clip = (await Clipboard.getStringAsync()).trim();
      if (!clip) {
        showToast('Clipboard is empty');
        return;
      }
      if (looksLikeOAuthCallbackInput(clip)) {
        const session = await completeOnDeviceChatGPTCallback(clip, auth);
        await updateAuth({
          activeProvider: 'gpt',
          chatgptOAuth: session,
        });
        setAwaitingGptCallback(false);
        setCallbackUrlDraft('');
        showToast(
          session.email
            ? `Connected (${session.email})`
            : 'ChatGPT SSO connected'
        );
        return;
      }
      const detected = detectApiKeyProvider(clip) || target;
      if (detected === 'antigravity') {
        await updateAuth({ geminiApiKey: clip, activeProvider: 'antigravity' });
        showToast('Google AI key saved');
      } else if (detected === 'claude') {
        await updateAuth({ claudeApiKey: clip, activeProvider: 'claude' });
        showToast('Claude key saved');
      } else {
        await updateAuth({ openaiApiKey: clip, activeProvider: 'gpt' });
        showToast('OpenAI key saved');
      }
    } catch (err) {
      showToast(
        err instanceof Error ? err.message : 'Paste into the key field directly'
      );
    }
  };

  const handleTestAi = async () => {
    Keyboard.dismiss();
    setTestingAi(true);
    setTestResult(null);
    try {
      const res = await verifyAIConnection(
        auth,
        activeProvider,
        companionStatus
      );
      setTestResult(res);
      if (res.ok) {
        showToast(`✓ AI responded (${res.latencyMs} ms)`);
      } else {
        setLogsOpen(true);
        showToast('AI test failed — see error details below', 'error');
      }
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : 'AI connection test failed';
      setTestResult({
        ok: false,
        provider: activeProvider,
        authMethod: providerStatus.methodLabel || 'Not connected',
        latencyMs: 0,
        errorMessage: msg,
        timestamp: new Date().toISOString(),
      });
      setLogsOpen(true);
      showToast('AI test failed — see error details below', 'error');
    } finally {
      setTestingAi(false);
    }
  };

  const handleChatGPTSignIn = async () => {
    setOauthBusy(true);
    try {
      const res = await startChatGPTSignIn(auth, 'codex');
      if (res.mode === 'on_device_connected') {
        await updateAuth({
          activeProvider: 'gpt',
          chatgptOAuth: res.session,
          ...(!res.session.accessToken && res.apiKeyIssued
            ? { openaiApiKey: res.apiKeyIssued }
            : {}),
        });
        setAwaitingGptCallback(false);
        setCallbackUrlDraft('');
        showToast(
          res.session.email
            ? `Connected (${res.session.email})`
            : 'ChatGPT SSO connected'
        );
      } else if (res.mode === 'companion_connected') {
        const st = await refreshCompanionStatus(
          auth.companionUrl,
          auth.companionToken
        );
        await updateAuth({ activeProvider: 'gpt' });
        setAwaitingGptCallback(false);
        showToast(
          st?.chatgptOAuth?.email
            ? `Connected (${st.chatgptOAuth.email})`
            : 'ChatGPT SSO connected'
        );
      } else {
        setAwaitingGptCallback(true);
        showToast('Approve in browser, copy localhost URL & tap Complete');
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Sign-in cancelled');
    } finally {
      setOauthBusy(false);
    }
  };

  const handleCompleteGptCallback = async () => {
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
      showToast(
        session.email
          ? `Connected (${session.email})`
          : 'ChatGPT SSO connected'
      );
    } catch (err) {
      showToast(
        err instanceof Error ? err.message : 'Could not complete sign-in'
      );
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
    setDeviceCodeBusy(true);
    setDeviceCodeInfo(null);
    try {
      const res = await startChatGPTDeviceCodeSignIn(
        auth,
        (info) => {
          setDeviceCodeInfo(info);
          showToast(`Code ${info.userCode} copied — paste in browser`);
        },
        controller.signal
      );
      await updateAuth({
        activeProvider: 'gpt',
        chatgptOAuth: res.session,
        ...(!res.session.accessToken && res.apiKeyIssued
          ? { openaiApiKey: res.apiKeyIssued }
          : {}),
      });
      setDeviceCodeInfo(null);
      setAwaitingGptCallback(false);
      showToast(
        res.session.email
          ? `Connected (${res.session.email})`
          : 'ChatGPT SSO connected'
      );
    } catch (err) {
      if (!controller.signal.aborted) {
        showToast(err instanceof Error ? err.message : 'Code sign-in failed');
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
    setOauthBusy(true);
    try {
      await signInWithGoogleOAuth(auth.companionUrl, auth.companionToken);
      await refreshCompanionStatus(auth.companionUrl, auth.companionToken);
      await updateAuth({ activeProvider: 'antigravity' });
      showToast('Google SSO connected');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Sign-in cancelled');
    } finally {
      setOauthBusy(false);
    }
  };

  const renderGoalRow = (
    field: keyof UserGoals,
    label: string,
    unit: string,
    step: number,
    dotColor?: string,
    isLast?: boolean,
    minVal: number = 0,
    formattedValue?: string
  ) => (
    <View
      key={field}
      style={[styles.srow, isLast ? { borderBottomWidth: 0 } : null]}
    >
      <View style={styles.srowLabelWrap}>
        {dotColor ? (
          <View style={[styles.colorDot, { backgroundColor: dotColor }]} />
        ) : null}
        <Text style={styles.srowLabel}>{label}</Text>
      </View>

      <Text style={styles.srowVal}>
        {formattedValue ?? `${formatNum(goals[field])}${unit}`}
      </Text>

      <View style={styles.miniStepWrap}>
        <Pressable
          onPress={() => stepGoal(field, -step, minVal)}
          style={({ pressed }) => [
            styles.miniStepBtn,
            pressed ? { opacity: 0.7 } : null,
          ]}
        >
          <PlateIcon name="minus" size={14} color={plateColors.ink} />
        </Pressable>
        <Pressable
          onPress={() => stepGoal(field, step, minVal)}
          style={({ pressed }) => [
            styles.miniStepBtn,
            pressed ? { opacity: 0.7 } : null,
          ]}
        >
          <PlateIcon name="plus" size={14} color={plateColors.ink} />
        </Pressable>
      </View>
    </View>
  );

  const renderSwitchRow = (
    key: 'addBurned' | 'rollover' | 'reminders',
    label: string,
    isLast?: boolean
  ) => {
    const isOn = preferences[key];
    return (
      <Pressable
        key={key}
        onPress={() => updatePreferences({ [key]: !isOn })}
        style={[styles.srow, isLast ? { borderBottomWidth: 0 } : null]}
      >
        <Text style={[styles.srowLabel, { flex: 1 }]}>{label}</Text>
        <View style={[styles.switchTrack, isOn ? styles.switchTrackOn : null]}>
          <View
            style={[styles.switchThumb, isOn ? styles.switchThumbOn : null]}
          />
        </View>
      </Pressable>
    );
  };

  return (
    <View style={styles.screen}>
      <ScrollView
        ref={scrollRef}
        style={styles.screen}
        contentContainerStyle={[
          styles.content,
          { paddingTop: isDesktopStage ? 58 : 10 },
        ]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
      <Text style={styles.pageTitle}>Settings</Text>

      {/* Profile Card */}
      <Pressable
        onPress={onOpenProfileSheet}
        style={({ pressed }) => [
          styles.profileCard,
          cardShadow,
          pressed ? { transform: [{ scale: 0.99 }] } : null,
        ]}
      >
        <LinearGradient
          colors={['#1B1B1F', '#4A4A52']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.avatar}
        >
          <Text style={styles.avatarText}>{initials || 'U'}</Text>
        </LinearGradient>

        <View style={{ flex: 1 }}>
          <Text style={styles.profileName}>{profile.name}</Text>
          <Text style={styles.profileSub}>
            {`${formatHeightMetric(profile.heightCm)} · ${profile.weightKg.toFixed(
              1
            )} kg · goal ${profile.goalWeightKg} kg`}
          </Text>
        </View>

        <View style={styles.editBadge}>
          <Text style={styles.editBadgeText}>Edit</Text>
        </View>
      </Pressable>

      {/* Daily Goals */}
      <Text style={styles.groupLabel}>Daily goals</Text>
      <View style={[styles.groupCard, cardShadow]}>
        {renderGoalRow(
          'dailyCalories',
          'Calories',
          ' kcal',
          50,
          plateColors.ink,
          false,
          800
        )}
        {renderGoalRow(
          'proteinGrams',
          'Protein',
          ' g',
          5,
          plateColors.protein,
          false,
          10
        )}
        {renderGoalRow(
          'carbsGrams',
          'Carbs',
          ' g',
          5,
          plateColors.carbs,
          false,
          10
        )}
        {renderGoalRow(
          'fatGrams',
          'Fats',
          ' g',
          5,
          plateColors.fat,
          false,
          10
        )}
        {renderGoalRow(
          'dailySteps',
          'Steps',
          '',
          500,
          undefined,
          false,
          1000,
          `${formatNum(goals.dailySteps)} (${formatMetersMetric(
            estimateStepMeters(goals.dailySteps, profile.heightCm)
          )})`
        )}
        {renderGoalRow(
          'waterGlasses',
          'Water',
          '',
          1,
          undefined,
          true,
          1,
          formatWaterLiters(goals.waterGlasses)
        )}
      </View>

      {/* AI Vision & Official Website SSO */}
      <View
        onLayout={(e) => {
          aiSectionYRef.current = e.nativeEvent.layout.y;
        }}
        style={styles.aiGroupHead}
      >
        <Text style={styles.groupLabel}>AI Vision & Official SSO</Text>
        <View style={styles.statusChip}>
          <View
            style={[
              styles.statusDot,
              {
                backgroundColor: providerStatus.ready
                  ? plateColors.ok
                  : plateColors.faint,
              },
            ]}
          />
          <Text style={styles.statusChipText}>
            {providerStatus.ready ? providerStatus.methodLabel : 'Connect'}
          </Text>
        </View>
      </View>

      <View style={[styles.aiCard, cardShadow]}>
        <View style={styles.providerTabs}>
          {(['antigravity', 'claude', 'gpt'] as AIProviderId[]).map((id) => {
            const meta = colors.providers[id];
            const active = activeProvider === id;
            return (
              <Pressable
                key={id}
                onPress={() => updateAuth({ activeProvider: id })}
                style={[
                  styles.providerTab,
                  active ? styles.providerTabActive : null,
                ]}
              >
                <Text
                  style={[
                    styles.providerTabText,
                    active ? { color: plateColors.ink, fontWeight: '700' } : null,
                  ]}
                >
                  {meta.label}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {activeProvider === 'antigravity' ? (
          <View style={styles.authPane}>
            {googleConnected ? (
              <View style={styles.connectedBanner}>
                <Text style={styles.connectedBannerText} numberOfLines={1}>
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
                    showToast('Disconnected Google SSO');
                  }}
                >
                  <Text style={styles.signOutLink}>Sign out</Text>
                </Pressable>
              </View>
            ) : googleOAuthConfigured ? (
              <Pressable
                onPress={handleGoogleSignIn}
                disabled={oauthBusy}
                style={styles.ssoPrimaryBtn}
              >
                {oauthBusy ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : null}
                <Text style={styles.ssoPrimaryBtnText}>
                  Sign in with Google SSO (accounts.google.com)
                </Text>
              </Pressable>
            ) : (
              <Pressable
                onPress={() => handleOpenOfficialSite('antigravity')}
                style={styles.ssoPrimaryBtn}
              >
                <PlateIcon name="sparkle" size={16} color="#FFFFFF" />
                <Text style={styles.ssoPrimaryBtnText}>
                  Authorize on Google AI Studio ↗
                </Text>
              </Pressable>
            )}

            <View style={styles.keyInputRow}>
              <TextInput
                value={auth.geminiApiKey}
                onChangeText={(v) => updateAuth({ geminiApiKey: v })}
                secureTextEntry
                autoCapitalize="none"
                autoCorrect={false}
                placeholder="Google AI key (AIzaSy...)"
                placeholderTextColor={plateColors.faint}
                style={styles.keyInput}
              />
              <Pressable
                onPress={() => handlePasteKey('antigravity')}
                style={styles.inlineBtn}
              >
                <Text style={styles.inlineBtnText}>Paste</Text>
              </Pressable>
              <Pressable
                onPress={async () => {
                  const st = await refreshCompanionStatus();
                  showToast(
                    st?.ok ? 'Antigravity SDK online' : 'Companion offline'
                  );
                }}
                disabled={isCheckingCompanion}
                style={styles.inlineBtn}
              >
                <Text style={styles.inlineBtnText}>
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

        {activeProvider === 'claude' ? (
          <View style={styles.authPane}>
            <Pressable
              onPress={() => handleOpenOfficialSite('claude')}
              style={styles.ssoPrimaryBtn}
            >
              <PlateIcon name="sparkle" size={16} color="#FFFFFF" />
              <Text style={styles.ssoPrimaryBtnText}>
                Authorize on Anthropic Console ↗
              </Text>
            </Pressable>

            <View style={styles.keyInputRow}>
              <TextInput
                value={auth.claudeApiKey}
                onChangeText={(v) => updateAuth({ claudeApiKey: v })}
                secureTextEntry
                autoCapitalize="none"
                autoCorrect={false}
                placeholder="Anthropic key (sk-ant-...)"
                placeholderTextColor={plateColors.faint}
                style={styles.keyInput}
              />
              <Pressable
                onPress={() => handlePasteKey('claude')}
                style={styles.inlineBtn}
              >
                <Text style={styles.inlineBtnText}>Paste</Text>
              </Pressable>
            </View>
          </View>
        ) : null}

        {activeProvider === 'gpt' ? (
          <View style={styles.authPane}>
            {chatgptConnected ? (
              <View style={styles.connectedBanner}>
                <Text style={styles.connectedBannerText} numberOfLines={1}>
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
                    showToast('Disconnected ChatGPT SSO');
                  }}
                >
                  <Text style={styles.signOutLink}>Sign out</Text>
                </Pressable>
              </View>
            ) : (
              <>
                <Pressable
                  onPress={handleChatGPTSignIn}
                  disabled={oauthBusy || deviceCodeBusy}
                  style={styles.ssoPrimaryBtn}
                >
                  {oauthBusy ? (
                    <ActivityIndicator size="small" color="#FFFFFF" />
                  ) : (
                    <PlateIcon name="sparkle" size={16} color="#FFFFFF" />
                  )}
                  <Text style={styles.ssoPrimaryBtnText}>
                    Sign in with ChatGPT (auth.openai.com)
                  </Text>
                </Pressable>

                {awaitingGptCallback ? (
                  <View style={styles.callbackBox}>
                    <Text style={styles.callbackHint}>
                      After approving on OpenAI, copy the 127.0.0.1 redirect URL
                      from your browser bar and tap Complete:
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
                        style={styles.inlineBtn}
                      >
                        <Text style={styles.inlineBtnText}>Cancel</Text>
                      </Pressable>
                    </View>
                  </View>
                ) : null}

                {deviceCodeBusy ? (
                  <View style={styles.callbackBox}>
                    <View style={styles.deviceCodeHeader}>
                      <ActivityIndicator size="small" color={plateColors.ink} />
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
                            showToast('Copied sign-in code');
                          }}
                          style={styles.inlineBtn}
                        >
                          <Text style={styles.inlineBtnText}>Copy</Text>
                        </Pressable>
                      ) : null}
                      <Pressable
                        onPress={handleCancelDeviceCode}
                        style={styles.inlineBtn}
                      >
                        <Text style={styles.inlineBtnText}>Cancel</Text>
                      </Pressable>
                    </View>
                    <Text style={styles.callbackHint}>
                      Paste this code on auth.openai.com/codex/device — Plate
                      finishes connecting automatically.
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

            <View style={styles.keyInputRow}>
              <TextInput
                value={auth.openaiApiKey}
                onChangeText={(v) => updateAuth({ openaiApiKey: v })}
                secureTextEntry
                autoCapitalize="none"
                autoCorrect={false}
                placeholder="Or OpenAI key (sk-proj-...)"
                placeholderTextColor={plateColors.faint}
                style={styles.keyInput}
              />
              <Pressable
                onPress={() => handlePasteKey('gpt')}
                style={styles.inlineBtn}
              >
                <Text style={styles.inlineBtnText}>Paste</Text>
              </Pressable>
              <Pressable
                onPress={() => handleOpenOfficialSite('gpt')}
                style={styles.inlineBtn}
              >
                <Text style={styles.inlineBtnText}>Keys ↗</Text>
              </Pressable>
            </View>
          </View>
        ) : null}

        <Pressable
          onPress={() => void handleTestAi()}
          disabled={testingAi}
          style={({ pressed }) => [
            styles.verifyAiBtn,
            pressed && !testingAi ? { transform: [{ scale: 0.99 }] } : null,
          ]}
        >
          {testingAi ? (
            <ActivityIndicator size="small" color={plateColors.ink} />
          ) : (
            <PlateIcon name="sparkle" size={15} color={plateColors.ink} />
          )}
          <Text style={styles.verifyAiBtnText}>
            {testingAi
              ? 'Sending test message to AI…'
              : 'Verify AI connection (Send test message)'}
          </Text>
        </Pressable>

        {testResult ? (
          <View
            style={[
              styles.testResultCard,
              testResult.ok
                ? styles.testResultCardOk
                : styles.testResultCardErr,
            ]}
          >
            <View style={styles.testResultHeader}>
              <View style={styles.testResultBadgeRow}>
                <View
                  style={[
                    styles.testResultIconCircle,
                    {
                      backgroundColor: testResult.ok
                        ? plateColors.ok
                        : plateColors.danger,
                    },
                  ]}
                >
                  <PlateIcon
                    name={testResult.ok ? 'check' : 'x'}
                    size={12}
                    color="#FFFFFF"
                  />
                </View>
                <Text
                  style={[
                    styles.testResultTitle,
                    {
                      color: testResult.ok ? '#157A42' : '#B4232C',
                    },
                  ]}
                >
                  {testResult.ok
                    ? `AI Connected · ${testResult.latencyMs} ms`
                    : `Connection Failed${
                        testResult.httpStatus
                          ? ` (HTTP ${testResult.httpStatus})`
                          : ''
                      }`}
                </Text>
              </View>

              <Pressable
                onPress={() => setTestResult(null)}
                hitSlop={8}
                style={styles.testDismissBtn}
              >
                <PlateIcon name="x" size={13} color={plateColors.muted} />
              </Pressable>
            </View>

            <Text style={styles.testResultMeta}>
              {[
                colors.providers[testResult.provider].label,
                testResult.authMethod,
                testResult.modelUsed,
              ]
                .filter(Boolean)
                .join(' · ')}
            </Text>

            {testResult.ok ? (
              <View style={styles.testReplyBox}>
                <Text style={styles.testReplyLabel}>AI test reply:</Text>
                <Text selectable style={styles.testReplyText}>
                  {`"${testResult.replyText || 'Plate AI connection is working.'}"`}
                </Text>
              </View>
            ) : (
              <>
                {testResult.endpoint ? (
                  <Text selectable style={styles.testEndpointText}>
                    {`Endpoint: ${testResult.endpoint}`}
                  </Text>
                ) : null}
                <View style={styles.testErrorBox}>
                  <Text selectable style={styles.testErrorText}>
                    {testResult.errorMessage || 'Unknown error'}
                  </Text>
                </View>
                <View style={styles.testErrorActions}>
                  <Pressable
                    onPress={async () => {
                      const summary = [
                        `Provider: ${colors.providers[testResult.provider].label}`,
                        testResult.authMethod
                          ? `Auth: ${testResult.authMethod}`
                          : '',
                        testResult.modelUsed
                          ? `Model: ${testResult.modelUsed}`
                          : '',
                        testResult.httpStatus
                          ? `HTTP Status: ${testResult.httpStatus}`
                          : '',
                        testResult.endpoint
                          ? `Endpoint: ${testResult.endpoint}`
                          : '',
                        `Error: ${testResult.errorMessage || 'Unknown error'}`,
                      ]
                        .filter(Boolean)
                        .join('\n');
                      await Clipboard.setStringAsync(summary);
                      showToast('Error copied to clipboard');
                    }}
                    style={styles.logToolbarBtn}
                  >
                    <Text style={styles.logToolbarBtnText}>Copy Error</Text>
                  </Pressable>

                  <Pressable
                    onPress={() => setLogsOpen(true)}
                    style={styles.logToolbarBtn}
                  >
                    <Text style={styles.logToolbarBtnText}>
                      {logsOpen ? 'Logs Open Below' : 'View Full Logs'}
                    </Text>
                  </Pressable>
                </View>
              </>
            )}
          </View>
        ) : null}

        <Pressable
          onPress={() => setShowCompanionEdit((v) => !v)}
          style={styles.companionRow}
        >
          <Text style={styles.companionLabel} numberOfLines={1}>
            {companionStatus?.ok
              ? `Desktop companion: ${auth.companionUrl} (online)`
              : 'On-device direct mode (no server needed)'}
          </Text>
          <Text style={styles.companionEditLink}>
            {showCompanionEdit ? 'Done' : 'Advanced'}
          </Text>
        </Pressable>

        {showCompanionEdit ? (
          <View style={[styles.keyInputRow, { marginTop: 8 }]}>
            <TextInput
              value={companionUrlDraft ?? auth.companionUrl}
              onChangeText={setCompanionUrlDraft}
              autoCapitalize="none"
              autoCorrect={false}
              placeholder="http://localhost:8787"
              placeholderTextColor={plateColors.faint}
              style={styles.keyInput}
            />
            <Pressable
              onPress={async () => {
                const nextUrl = (companionUrlDraft ?? auth.companionUrl).trim();
                await updateAuth({ companionUrl: nextUrl });
                const st = await refreshCompanionStatus(nextUrl);
                setShowCompanionEdit(false);
                showToast(
                  st?.ok ? 'Companion server connected' : 'Saved Companion URL'
                );
              }}
              style={styles.inlineBtn}
            >
              <Text style={styles.inlineBtnText}>Save</Text>
            </Pressable>
          </View>
        ) : null}

        {/* AI Diagnostic Logs Accordion */}
        <Pressable
          onPress={() => setLogsOpen((v) => !v)}
          style={styles.logsToggleRow}
        >
          <View style={styles.logsToggleLeft}>
            <Text style={styles.logsToggleTitle}>
              {`AI Diagnostic Logs (${aiLogs.length})`}
            </Text>
            {aiLogs.some((l) => l.level === 'error') ? (
              <View style={styles.logsErrDot} />
            ) : null}
          </View>
          <Text style={styles.companionEditLink}>
            {logsOpen ? 'Hide' : 'Show'}
          </Text>
        </Pressable>

        {logsOpen ? (
          <View style={styles.logsPanel}>
            <View style={styles.logsToolbar}>
              <Text style={styles.logsHintText}>
                Newest first · tokens auto-redacted
              </Text>
              <View style={{ flexDirection: 'row', gap: 6 }}>
                <Pressable
                  onPress={async () => {
                    await Clipboard.setStringAsync(
                      formatAIDiagnosticLogsText()
                    );
                    showToast('AI diagnostic logs copied');
                  }}
                  style={styles.logToolbarBtn}
                >
                  <Text style={styles.logToolbarBtnText}>Copy Logs</Text>
                </Pressable>
                {aiLogs.length > 0 ? (
                  <Pressable
                    onPress={async () => {
                      await clearAIDiagnosticLogs();
                      showToast('AI logs cleared');
                    }}
                    style={styles.logToolbarBtn}
                  >
                    <Text
                      style={[
                        styles.logToolbarBtnText,
                        { color: plateColors.danger },
                      ]}
                    >
                      Clear
                    </Text>
                  </Pressable>
                ) : null}
              </View>
            </View>

            {aiLogs.length === 0 ? (
              <Text style={styles.logsEmptyText}>
                No AI requests logged yet. Tap &ldquo;Verify AI connection&rdquo;
                above or scan a meal to record request &amp; error details.
              </Text>
            ) : (
              <ScrollView
                style={styles.logsScrollBox}
                nestedScrollEnabled
                showsVerticalScrollIndicator
              >
                {[...aiLogs].reverse().map((entry) => {
                  const timeStr = new Date(entry.timestamp).toLocaleTimeString(
                    [],
                    {
                      hour12: false,
                      hour: '2-digit',
                      minute: '2-digit',
                      second: '2-digit',
                    }
                  );
                  const levelColor =
                    entry.level === 'error'
                      ? '#FF6B6B'
                      : entry.level === 'warn'
                        ? '#F5B041'
                        : entry.level === 'ok'
                          ? '#4CD97B'
                          : '#8EB8FF';
                  return (
                    <View key={entry.id} style={styles.logItem}>
                      <Text selectable style={styles.logItemHead}>
                        <Text style={{ color: '#8E8E98' }}>{`[${timeStr}] `}</Text>
                        <Text style={{ color: levelColor, fontWeight: '700' }}>
                          {`${entry.level.toUpperCase()} `}
                        </Text>
                        <Text style={{ color: '#C8C8D2' }}>
                          {`[${entry.scope}] `}
                        </Text>
                        {entry.message}
                      </Text>
                      {entry.detail ? (
                        <Text selectable style={styles.logItemDetail}>
                          {entry.detail}
                        </Text>
                      ) : null}
                    </View>
                  );
                })}
              </ScrollView>
            )}
          </View>
        ) : null}
      </View>

      {/* Preferences */}
      <Text style={styles.groupLabel}>Preferences</Text>
      <View style={[styles.groupCard, cardShadow]}>
        {renderSwitchRow('addBurned', 'Add burned calories to budget')}
        {renderSwitchRow('rollover', 'Roll over unused calories')}
        {renderSwitchRow('reminders', 'Meal reminders', true)}
      </View>

      {/* Setup & Data Actions */}
      <Text style={styles.groupLabel}>Backup & data</Text>
      <View style={[styles.groupCard, cardShadow]}>
        <Pressable
          onPress={async () => {
            try {
              const json = await exportBackupJson();
              await Clipboard.setStringAsync(json);
              if (Platform.OS !== 'web') {
                await Share.share({
                  title: 'Plate Settings & Data Backup',
                  message: json,
                }).catch(() => {});
              }
              showToast('Backup copied (and ready to save)');
            } catch {
              showToast('Could not export backup');
            }
          }}
          style={styles.actionRow}
        >
          <Text style={styles.actionRowText}>
            Export settings & data backup
          </Text>
        </Pressable>
        <Pressable
          onPress={() => router.push('/onboarding')}
          style={styles.actionRow}
        >
          <Text style={styles.actionRowText}>Open Initial Setup</Text>
        </Pressable>
        <Pressable
          onPress={() => void handleClearMealsPress()}
          style={({ pressed }) => [
            styles.actionRow,
            { borderBottomWidth: 0, gap: 4 },
            pressed ? { opacity: 0.72 } : null,
          ]}
        >
          <Text style={styles.dangerText}>
            {clearTapCount > 0
              ? `Clear all logged meals (${clearTapCount}/5)`
              : 'Clear all logged meals'}
          </Text>
          <Text
            style={[
              styles.clearHintText,
              clearTapCount > 0 ? styles.clearHintTextActive : null,
            ]}
          >
            {clearTapCount === 0
              ? 'Click 5 times to clear all logged meals'
              : `Click ${5 - clearTapCount} more ${
                  5 - clearTapCount === 1 ? 'time' : 'times'
                } to confirm`}
          </Text>
        </Pressable>
      </View>

      <Text style={styles.footerText}>
        {`Plate · ${versionMeta.fullBadge} · ${versionMeta.sdkLabel}`}
      </Text>

      <Modal
        visible={clearedPopupOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setClearedPopupOpen(false)}
      >
        <View style={styles.popupBackdrop}>
          <View style={[styles.popupCard, cardShadow]}>
            <View style={styles.popupBadge}>
              <PlateIcon name="check" size={22} color="#FFFFFF" />
            </View>
            <Text style={styles.popupTitle}>All Meals Cleared</Text>
            <Text style={styles.popupBody}>
              All logged meals, water, and daily steps have been cleared. Your
              profile, goals, and AI settings remain saved.
            </Text>
            <Pressable
              onPress={() => setClearedPopupOpen(false)}
              style={({ pressed }) => [
                styles.popupBtn,
                pressed ? { transform: [{ scale: 0.98 }] } : null,
              ]}
            >
              <Text style={styles.popupBtnText}>OK</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
      </ScrollView>

      {keyboard.visible ? (
        <Pressable
          onPress={() => Keyboard.dismiss()}
          style={[
            styles.floatingKeyboardDone,
            { top: isDesktopStage ? 56 : 12 },
          ]}
        >
          <PlateIcon name="check" size={14} color="#FFFFFF" />
          <Text style={styles.floatingKeyboardDoneText}>Done</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  content: {
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 132,
  },
  pageTitle: {
    fontSize: 30,
    fontWeight: '700',
    color: plateColors.ink,
    letterSpacing: -1.1,
    marginTop: 4,
    marginBottom: 18,
  },
  profileCard: {
    backgroundColor: plateColors.card,
    borderRadius: 26,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    marginBottom: 20,
  },
  avatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    color: '#FFFFFF',
    fontSize: 20,
    fontWeight: '700',
  },
  profileName: {
    fontSize: 18,
    fontWeight: '700',
    color: plateColors.ink,
    letterSpacing: -0.4,
  },
  profileSub: {
    fontSize: 13,
    color: plateColors.muted,
    marginTop: 2,
  },
  editBadge: {
    backgroundColor: plateColors.chip,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 10,
  },
  editBadgeText: {
    fontSize: 12.5,
    fontWeight: '600',
    color: plateColors.ink2,
  },
  groupLabel: {
    fontSize: 12.5,
    fontWeight: '600',
    color: plateColors.muted,
    textTransform: 'uppercase',
    letterSpacing: 0.7,
    marginLeft: 4,
    marginBottom: 8,
  },
  groupCard: {
    backgroundColor: plateColors.card,
    borderRadius: 26,
    paddingHorizontal: 16,
    paddingVertical: 4,
    marginBottom: 20,
  },
  srow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 13,
    borderBottomWidth: 1,
    borderBottomColor: plateColors.line,
  },
  srowLabelWrap: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  colorDot: {
    width: 10,
    height: 10,
    borderRadius: 4,
  },
  srowLabel: {
    fontSize: 15,
    fontWeight: '500',
    color: plateColors.ink,
  },
  srowVal: {
    fontSize: 15,
    fontWeight: '700',
    color: plateColors.ink,
    minWidth: 70,
    textAlign: 'right',
    fontVariant: ['tabular-nums'],
  },
  miniStepWrap: {
    flexDirection: 'row',
    gap: 6,
  },
  miniStepBtn: {
    width: 30,
    height: 30,
    borderRadius: 10,
    backgroundColor: plateColors.chip,
    alignItems: 'center',
    justifyContent: 'center',
  },
  aiGroupHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingRight: 4,
  },
  statusChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginBottom: 8,
  },
  statusDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  statusChipText: {
    fontSize: 12,
    fontWeight: '600',
    color: plateColors.ink2,
  },
  aiCard: {
    backgroundColor: plateColors.card,
    borderRadius: 26,
    padding: 16,
    marginBottom: 20,
  },
  providerTabs: {
    flexDirection: 'row',
    backgroundColor: plateColors.chip,
    borderRadius: 12,
    padding: 3,
    marginBottom: 12,
  },
  providerTab: {
    flex: 1,
    height: 32,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  providerTabActive: {
    backgroundColor: '#FFFFFF',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 3,
    elevation: 1,
  },
  providerTabText: {
    fontSize: 13,
    fontWeight: '600',
    color: plateColors.muted,
  },
  authPane: {
    gap: 10,
  },
  ssoPrimaryBtn: {
    height: 44,
    borderRadius: 14,
    backgroundColor: plateColors.ink,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: 14,
  },
  ssoPrimaryBtnText: {
    color: '#FFFFFF',
    fontSize: 13.5,
    fontWeight: '600',
  },
  secondaryAuthBtn: {
    height: 38,
    borderRadius: 12,
    backgroundColor: plateColors.chip,
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  secondaryAuthBtnText: {
    fontSize: 12.5,
    fontWeight: '600',
    color: plateColors.ink2,
  },
  verifyAiBtn: {
    marginTop: 12,
    height: 44,
    borderRadius: 14,
    backgroundColor: plateColors.chip,
    borderWidth: 1,
    borderColor: plateColors.line,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: 14,
  },
  verifyAiBtnText: {
    fontSize: 13.5,
    fontWeight: '700',
    color: plateColors.ink,
  },
  testResultCard: {
    marginTop: 10,
    borderRadius: 16,
    padding: 12,
    gap: 7,
    borderWidth: 1,
  },
  testResultCardOk: {
    backgroundColor: '#EEFBF3',
    borderColor: 'rgba(30,158,90,0.28)',
  },
  testResultCardErr: {
    backgroundColor: '#FFF2F3',
    borderColor: 'rgba(229,72,77,0.32)',
  },
  testResultHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  testResultBadgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    flex: 1,
  },
  testResultIconCircle: {
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  testResultTitle: {
    fontSize: 13.5,
    fontWeight: '700',
    flex: 1,
  },
  testDismissBtn: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  testResultMeta: {
    fontSize: 12,
    fontWeight: '600',
    color: plateColors.ink2,
  },
  testReplyBox: {
    backgroundColor: '#FFFFFF',
    borderRadius: 11,
    paddingHorizontal: 11,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: 'rgba(30,158,90,0.18)',
    gap: 2,
  },
  testReplyLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: plateColors.muted,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  testReplyText: {
    fontSize: 13,
    fontWeight: '600',
    color: plateColors.ink,
    lineHeight: 18,
  },
  testEndpointText: {
    fontSize: 11.5,
    color: plateColors.muted,
  },
  testErrorBox: {
    backgroundColor: '#18181D',
    borderRadius: 11,
    paddingHorizontal: 11,
    paddingVertical: 9,
  },
  testErrorText: {
    color: '#FFE2E5',
    fontSize: 12,
    lineHeight: 17,
    fontFamily: Platform.select({
      ios: 'Menlo',
      android: 'monospace',
      default: 'monospace',
    }),
  },
  testErrorActions: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 2,
  },
  logsToggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: plateColors.line,
  },
  logsToggleLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  logsToggleTitle: {
    fontSize: 12.5,
    fontWeight: '600',
    color: plateColors.ink2,
  },
  logsErrDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: plateColors.danger,
  },
  logsPanel: {
    marginTop: 8,
    gap: 8,
  },
  logsToolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  logsHintText: {
    fontSize: 11.5,
    color: plateColors.muted,
    flex: 1,
  },
  logToolbarBtn: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 9,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: plateColors.line,
  },
  logToolbarBtnText: {
    fontSize: 12,
    fontWeight: '600',
    color: plateColors.ink,
  },
  logsEmptyText: {
    fontSize: 12,
    lineHeight: 17,
    color: plateColors.muted,
    paddingVertical: 8,
  },
  logsScrollBox: {
    maxHeight: 260,
    backgroundColor: '#141418',
    borderRadius: 14,
    paddingHorizontal: 11,
    paddingVertical: 9,
  },
  logItem: {
    paddingVertical: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(255,255,255,0.1)',
    gap: 3,
  },
  logItemHead: {
    color: '#F2F2F7',
    fontSize: 11.5,
    lineHeight: 16,
    fontFamily: Platform.select({
      ios: 'Menlo',
      android: 'monospace',
      default: 'monospace',
    }),
  },
  logItemDetail: {
    color: '#B8B8C4',
    fontSize: 11,
    lineHeight: 15,
    fontFamily: Platform.select({
      ios: 'Menlo',
      android: 'monospace',
      default: 'monospace',
    }),
  },
  floatingKeyboardDone: {
    position: 'absolute',
    right: 18,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: plateColors.ink,
    paddingHorizontal: 13,
    paddingVertical: 8,
    borderRadius: 99,
    zIndex: 40,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.25,
    shadowRadius: 12,
    elevation: 6,
  },
  floatingKeyboardDoneText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },
  callbackBox: {
    backgroundColor: plateColors.bg,
    borderRadius: 14,
    padding: 11,
    gap: 8,
    borderWidth: 1,
    borderColor: plateColors.line,
  },
  callbackHint: {
    fontSize: 12,
    lineHeight: 16,
    color: plateColors.muted,
  },
  callbackInput: {
    height: 38,
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
    fontSize: 14,
    fontWeight: '700',
    color: plateColors.ink,
    fontVariant: ['tabular-nums'],
  },
  connectedBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#E8FAF0',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
  },
  connectedBannerText: {
    flex: 1,
    fontSize: 13,
    fontWeight: '600',
    color: '#1E9E5A',
  },
  signOutLink: {
    fontSize: 12.5,
    fontWeight: '700',
    color: plateColors.danger,
    marginLeft: 10,
  },
  keyInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  keyInput: {
    flex: 1,
    height: 40,
    borderRadius: 12,
    backgroundColor: plateColors.chip,
    paddingHorizontal: 12,
    fontSize: 13.5,
    color: plateColors.ink,
  },
  inlineBtn: {
    height: 40,
    paddingHorizontal: 11,
    borderRadius: 12,
    backgroundColor: plateColors.chip,
    alignItems: 'center',
    justifyContent: 'center',
  },
  inlineBtnText: {
    fontSize: 12.5,
    fontWeight: '600',
    color: plateColors.ink,
  },
  companionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 12,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: plateColors.line,
  },
  companionLabel: {
    fontSize: 12,
    color: plateColors.muted,
    flex: 1,
  },
  companionEditLink: {
    fontSize: 12,
    fontWeight: '600',
    color: plateColors.ink2,
  },
  switchTrack: {
    width: 50,
    height: 30,
    borderRadius: 15,
    backgroundColor: '#E2E2E6',
    padding: 3,
    justifyContent: 'center',
  },
  switchTrackOn: {
    backgroundColor: plateColors.ink,
  },
  switchThumb: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#FFFFFF',
  },
  switchThumbOn: {
    transform: [{ translateX: 20 }],
  },
  actionRow: {
    paddingVertical: 15,
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: plateColors.line,
  },
  actionRowText: {
    fontSize: 15,
    fontWeight: '600',
    color: plateColors.ink,
  },
  dangerText: {
    fontSize: 15,
    fontWeight: '600',
    color: plateColors.danger,
  },
  clearHintText: {
    fontSize: 12,
    fontWeight: '500',
    color: plateColors.muted,
  },
  clearHintTextActive: {
    color: plateColors.danger,
    fontWeight: '600',
  },
  popupBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.46)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 28,
  },
  popupCard: {
    width: '100%',
    maxWidth: 320,
    backgroundColor: plateColors.card,
    borderRadius: 28,
    paddingVertical: 24,
    paddingHorizontal: 22,
    alignItems: 'center',
    gap: 10,
  },
  popupBadge: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: plateColors.ok,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 2,
  },
  popupTitle: {
    fontSize: 19,
    fontWeight: '700',
    color: plateColors.ink,
    letterSpacing: -0.4,
    textAlign: 'center',
  },
  popupBody: {
    fontSize: 13.5,
    lineHeight: 19,
    color: plateColors.muted,
    textAlign: 'center',
    marginBottom: 6,
  },
  popupBtn: {
    width: '100%',
    height: 48,
    borderRadius: 99,
    backgroundColor: plateColors.ink,
    alignItems: 'center',
    justifyContent: 'center',
  },
  popupBtnText: {
    color: '#FFFFFF',
    fontSize: 15.5,
    fontWeight: '600',
  },
  footerText: {
    textAlign: 'center',
    fontSize: 12,
    color: plateColors.faint,
    marginTop: 2,
  },
});
