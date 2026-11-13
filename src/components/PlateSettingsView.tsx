import * as Clipboard from 'expo-clipboard';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import React, { useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { formatNum } from '../constants/plateCatalog';
import { getAppVersionMetadata } from '../constants/version';
import { useCalorieTracker } from '../context/CalorieContext';
import {
  disconnectChatGPTOAuth,
  disconnectGoogleOAuth,
  isProviderConfigured,
  openProviderWebsite,
  PROVIDER_AUTH_PORTALS,
  signInWithChatGPTOAuth,
  signInWithGoogleOAuth,
} from '../services/ai';
import { cardShadow, colors, plateColors } from '../theme/colors';
import { AIProviderId, UserGoals } from '../types/models';
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
    resetDemoData,
    clearAllLogs,
    showToast,
  } = useCalorieTracker();

  const isDesktopStage = useIsDesktopStage();
  const [oauthBusy, setOauthBusy] = useState(false);
  const [showCompanionEdit, setShowCompanionEdit] = useState(false);
  const [companionUrlDraft, setCompanionUrlDraft] = useState<string | null>(
    null
  );

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

  const chatgptConnected = Boolean(companionStatus?.chatgptOAuth?.connected);
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
    await openProviderWebsite(PROVIDER_AUTH_PORTALS[provider]);
    showToast('Opened official portal — copy key & tap Paste');
  };

  const handlePasteKey = async (target: AIProviderId) => {
    try {
      const clip = (await Clipboard.getStringAsync()).trim();
      if (!clip) {
        showToast('Clipboard is empty');
        return;
      }
      if (target === 'antigravity') {
        await updateAuth({ geminiApiKey: clip, activeProvider: 'antigravity' });
        showToast('Google AI key saved');
      } else if (target === 'claude') {
        await updateAuth({ claudeApiKey: clip, activeProvider: 'claude' });
        showToast('Claude key saved');
      } else {
        await updateAuth({ openaiApiKey: clip, activeProvider: 'gpt' });
        showToast('OpenAI key saved');
      }
    } catch {
      showToast('Paste into the key field directly');
    }
  };

  const handleChatGPTSignIn = async () => {
    setOauthBusy(true);
    try {
      await signInWithChatGPTOAuth(auth.companionUrl, auth.companionToken);
      const st = await refreshCompanionStatus(
        auth.companionUrl,
        auth.companionToken
      );
      await updateAuth({ activeProvider: 'gpt' });
      showToast(
        st?.chatgptOAuth?.email
          ? `Connected (${st.chatgptOAuth.email})`
          : 'ChatGPT SSO connected'
      );
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Sign-in cancelled');
    } finally {
      setOauthBusy(false);
    }
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
    minVal: number = 0
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

      <Text style={styles.srowVal}>{`${formatNum(goals[field])}${unit}`}</Text>

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
    <ScrollView
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
            {`${profile.heightCm} cm · ${profile.weightKg.toFixed(1)} kg · goal ${
              profile.goalWeightKg
            } kg`}
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
          '',
          50,
          plateColors.ink,
          false,
          800
        )}
        {renderGoalRow(
          'proteinGrams',
          'Protein',
          'g',
          5,
          plateColors.protein,
          false,
          10
        )}
        {renderGoalRow(
          'carbsGrams',
          'Carbs',
          'g',
          5,
          plateColors.carbs,
          false,
          10
        )}
        {renderGoalRow(
          'fatGrams',
          'Fats',
          'g',
          5,
          plateColors.fat,
          false,
          10
        )}
        {renderGoalRow('dailySteps', 'Steps', '', 500, undefined, false, 1000)}
        {renderGoalRow(
          'waterGlasses',
          'Water',
          ' gl',
          1,
          undefined,
          true,
          1
        )}
      </View>

      {/* AI Vision & Official Website SSO */}
      <View style={styles.aiGroupHead}>
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
                  {`✓ ChatGPT SSO (${
                    companionStatus?.chatgptOAuth?.email || 'Connected'
                  })`}
                </Text>
                <Pressable
                  onPress={async () => {
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
              <Pressable
                onPress={handleChatGPTSignIn}
                disabled={oauthBusy}
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
          onPress={() => setShowCompanionEdit((v) => !v)}
          style={styles.companionRow}
        >
          <Text style={styles.companionLabel}>
            {`Companion: ${auth.companionUrl}`}
          </Text>
          <Text style={styles.companionEditLink}>
            {showCompanionEdit ? 'Done' : 'Change'}
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
      </View>

      {/* Preferences */}
      <Text style={styles.groupLabel}>Preferences</Text>
      <View style={[styles.groupCard, cardShadow]}>
        {renderSwitchRow('addBurned', 'Add burned calories to budget')}
        {renderSwitchRow('rollover', 'Roll over unused calories')}
        {renderSwitchRow('reminders', 'Meal reminders', true)}
      </View>

      {/* Setup & Data Actions */}
      <View style={[styles.groupCard, cardShadow]}>
        <Pressable
          onPress={() => router.push('/onboarding')}
          style={styles.actionRow}
        >
          <Text style={styles.actionRowText}>Open Initial Setup</Text>
        </Pressable>
        <Pressable onPress={resetDemoData} style={styles.actionRow}>
          <Text style={styles.actionRowText}>Reset demo data</Text>
        </Pressable>
        <Pressable
          onPress={clearAllLogs}
          style={[styles.actionRow, { borderBottomWidth: 0 }]}
        >
          <Text style={styles.dangerText}>Clear all logged meals</Text>
        </Pressable>
      </View>

      <Text style={styles.footerText}>
        {`Plate · ${versionMeta.fullBadge} · ${versionMeta.sdkLabel}`}
      </Text>
    </ScrollView>
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
  footerText: {
    textAlign: 'center',
    fontSize: 12,
    color: plateColors.faint,
    marginTop: 2,
  },
});
