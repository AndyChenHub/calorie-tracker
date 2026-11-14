import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  computeHealthScoreFromMacros,
  DEFAULT_PREFERENCES,
  DEFAULT_USER_PROFILE,
} from '../constants/plateCatalog';
import {
  analyzeMealWithAI,
  checkCompanionStatus,
  ensureAIDiagnosticLogsLoaded,
  isProviderConfigured,
  resolveReadyProvider,
  subscribeChatGPTSessionRefresh,
} from '../services/ai';
import { assetToBase64, persistMealPhotoUri } from '../services/photos';
import {
  computeDailySummaries,
  createPortableBackupJson,
  DEFAULT_GOALS,
  deleteMealById,
  ensureSettingsMirrored,
  getDefaultAuthConfig,
  hasStoredUserConfiguration,
  loadAllMeals,
  loadAuthConfig,
  loadGoals,
  loadHasPurgedLegacyDemoSeed,
  loadHasSeededDemo,
  loadOnboardingCompleted,
  loadPreferences,
  loadStepsByDate,
  loadUserProfile,
  loadWaterByDate,
  replaceAllMeals,
  restorePortableBackupJson,
  saveAuthConfig,
  saveGoals,
  saveHasPurgedLegacyDemoSeed,
  saveHasSeededDemo,
  saveOnboardingCompleted,
  savePreferences,
  saveStepsByDate,
  saveUserProfile,
  saveWaterByDate,
  upsertMeal,
} from '../services/storage';
import {
  AIErrorReport,
  AppPreferences,
  CompanionStatusResponse,
  DailySummary,
  MealEntry,
  MealType,
  ProviderAuthConfig,
  UserGoals,
  UserProfile,
} from '../types/models';
import { inferMealTypeByHour, toLocalDateKey } from '../utils/date';

export type PlateTabId = 'home' | 'progress' | 'settings';
export type ToastTone = 'ok' | 'error';

export interface StartMealAnalysisParams {
  photoUri?: string | null;
  imageBase64?: string;
  mimeType?: string;
  userNotes?: string;
  mealType?: MealType;
}

interface CalorieContextValue {
  isReady: boolean;
  hasCompletedOnboarding: boolean;
  completeOnboarding: () => Promise<void>;
  resetOnboarding: () => Promise<void>;
  activeTab: PlateTabId;
  setActiveTab: (tab: PlateTabId) => void;
  scannerOpen: boolean;
  setScannerOpen: (open: boolean) => void;
  detailEntryId: string | null;
  setDetailEntryId: (id: string | null) => void;
  toastMessage: string | null;
  toastTone: ToastTone;
  showToast: (msg: string, tone?: ToastTone) => void;
  lastAIError: AIErrorReport | null;
  clearLastAIError: () => void;
  aiLogsExpandSignal: number;
  openAILogsInSettings: () => void;
  selectedDateKey: string;
  setSelectedDateKey: (dateKey: string) => void;
  meals: MealEntry[];
  mealsForSelectedDate: MealEntry[];
  dailySummaries: Record<string, DailySummary>;
  selectedDaySummary: DailySummary;
  todaySummary: DailySummary;
  streakCount: number;
  goals: UserGoals;
  updateGoals: (nextGoals: UserGoals) => Promise<void>;
  profile: UserProfile;
  updateProfile: (patch: Partial<UserProfile>) => Promise<void>;
  preferences: AppPreferences;
  updatePreferences: (patch: Partial<AppPreferences>) => Promise<void>;
  waterByDate: Record<string, number>;
  setWaterForDate: (dateKey: string, glasses: number) => Promise<void>;
  stepsByDate: Record<string, number>;
  setStepsForDate: (dateKey: string, steps: number) => Promise<void>;
  auth: ProviderAuthConfig;
  updateAuth: (patch: Partial<ProviderAuthConfig>) => Promise<void>;
  companionStatus: CompanionStatusResponse | null;
  isCheckingCompanion: boolean;
  refreshCompanionStatus: (
    overrideUrl?: string,
    overrideToken?: string
  ) => Promise<CompanionStatusResponse | null>;
  saveMealEntry: (entry: MealEntry) => Promise<void>;
  removeMealEntry: (id: string) => Promise<void>;
  startMealAnalysisJob: (params: StartMealAnalysisParams) => Promise<void>;
  refineMealEntry: (entryId: string, instruction: string) => Promise<boolean>;
  clearAllLogs: () => Promise<void>;
  exportBackupJson: () => Promise<string>;
  importBackupJson: (rawJson: string) => Promise<void>;
}

const CalorieContext = createContext<CalorieContextValue | null>(null);

function emptySummary(dateKey: string): DailySummary {
  return {
    dateKey,
    calories: 0,
    protein: 0,
    carbs: 0,
    fat: 0,
    burnedCalories: 0,
    mealCount: 0,
  };
}

export function CalorieProvider({ children }: { children: React.ReactNode }) {
  const [isReady, setIsReady] = useState(false);
  const [hasCompletedOnboarding, setHasCompletedOnboarding] = useState(false);
  const [activeTab, setActiveTab] = useState<PlateTabId>('home');
  const [scannerOpen, setScannerOpen] = useState(false);
  const [detailEntryId, setDetailEntryId] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [toastTone, setToastTone] = useState<ToastTone>('ok');
  const [lastAIError, setLastAIError] = useState<AIErrorReport | null>(null);
  const [aiLogsExpandSignal, setAiLogsExpandSignal] = useState(0);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [selectedDateKey, setSelectedDateKey] = useState<string>(() =>
    toLocalDateKey()
  );
  const [meals, setMeals] = useState<MealEntry[]>([]);
  const [goals, setGoals] = useState<UserGoals>(DEFAULT_GOALS);
  const [profile, setProfile] = useState<UserProfile>(DEFAULT_USER_PROFILE);
  const [preferences, setPreferences] =
    useState<AppPreferences>(DEFAULT_PREFERENCES);
  const [waterByDate, setWaterByDate] = useState<Record<string, number>>({});
  const [stepsByDate, setStepsByDate] = useState<Record<string, number>>({});
  const [auth, setAuth] = useState<ProviderAuthConfig>(() =>
    getDefaultAuthConfig()
  );
  const profileRef = useRef<UserProfile>(profile);
  const preferencesRef = useRef<AppPreferences>(preferences);
  const authRef = useRef<ProviderAuthConfig>(auth);

  useEffect(() => {
    profileRef.current = profile;
    preferencesRef.current = preferences;
    authRef.current = auth;
  }, [profile, preferences, auth]);
  const [companionStatus, setCompanionStatus] =
    useState<CompanionStatusResponse | null>(null);
  const [isCheckingCompanion, setIsCheckingCompanion] = useState(false);

  const showToast = useCallback((msg: string, tone: ToastTone = 'ok') => {
    setToastTone(tone);
    setToastMessage(msg);
    if (toastTimerRef.current) {
      clearTimeout(toastTimerRef.current);
    }
    toastTimerRef.current = setTimeout(
      () => {
        setToastMessage(null);
      },
      tone === 'error' ? 4200 : 2500
    );
  }, []);

  const clearLastAIError = useCallback(() => {
    setLastAIError(null);
  }, []);

  const openAILogsInSettings = useCallback(() => {
    setLastAIError(null);
    setDetailEntryId(null);
    setScannerOpen(false);
    setActiveTab('settings');
    setAiLogsExpandSignal((n) => n + 1);
  }, []);

  const refreshCompanionStatus = useCallback(
    async (overrideUrl?: string, overrideToken?: string) => {
      const targetUrl = (overrideUrl ?? auth.companionUrl).trim();
      const targetToken = overrideToken ?? auth.companionToken;
      if (!targetUrl) {
        setCompanionStatus(null);
        return null;
      }

      setIsCheckingCompanion(true);
      try {
        const status = await checkCompanionStatus(targetUrl, targetToken);
        setCompanionStatus(status);
        return status;
      } catch {
        setCompanionStatus(null);
        return null;
      } finally {
        setIsCheckingCompanion(false);
      }
    },
    [auth.companionToken, auth.companionUrl]
  );

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const [
          loadedMeals,
          loadedGoals,
          loadedAuth,
          onboarded,
          loadedProfile,
          loadedPrefs,
          loadedWater,
          loadedSteps,
          seededBefore,
          purgedLegacyDemo,
          hasExistingConfig,
        ] = await Promise.all([
          loadAllMeals(),
          loadGoals(),
          loadAuthConfig(),
          loadOnboardingCompleted(),
          loadUserProfile(),
          loadPreferences(),
          loadWaterByDate(),
          loadStepsByDate(),
          loadHasSeededDemo(),
          loadHasPurgedLegacyDemoSeed(),
          hasStoredUserConfiguration(),
        ]);

        let initialMeals = loadedMeals;
        let initialWater = loadedWater;
        let initialSteps = loadedSteps;
        let initialProfile = loadedProfile;

        // Clean up legacy hardcoded 84.6 -> 78.4 kg demo profile gap if no real weight history exists
        if (
          initialProfile.startWeightKg === 84.6 &&
          (!initialProfile.weightHistory ||
            initialProfile.weightHistory.length === 0)
        ) {
          if (
            initialProfile.weightKg === 78.4 &&
            initialProfile.goalWeightKg === 72 &&
            initialProfile.name === 'Alex Morgan'
          ) {
            initialProfile = { ...DEFAULT_USER_PROFILE };
          } else {
            initialProfile = {
              ...initialProfile,
              startWeightKg: initialProfile.weightKg,
            };
          }
          await saveUserProfile(initialProfile);
        }

        // Never seed sample meals/images on startup, and purge legacy auto-seeded demo data once on upgrade
        if (!purgedLegacyDemo) {
          const withoutPresetSamples = loadedMeals.filter(
            (m) => !(Boolean(m.presetFoodId) && !m.photoUri)
          );
          const hasRealUserMeals = withoutPresetSamples.some(
            (m) => m.entryType !== 'exercise' && Boolean(m.photoUri)
          );

          if (seededBefore && !hasRealUserMeals) {
            initialMeals = [];
            initialWater = {};
            initialSteps = {};
            await Promise.all([
              replaceAllMeals([]),
              saveWaterByDate({}),
              saveStepsByDate({}),
              saveHasPurgedLegacyDemoSeed(true),
            ]);
          } else if (withoutPresetSamples.length !== loadedMeals.length) {
            initialMeals = withoutPresetSamples;
            await Promise.all([
              replaceAllMeals(initialMeals),
              saveHasPurgedLegacyDemoSeed(true),
            ]);
          } else {
            await saveHasPurgedLegacyDemoSeed(true);
          }
        }

        // Preserve user setup across app updates: never force existing users back into onboarding
        const effectiveOnboarded =
          onboarded || hasExistingConfig || initialMeals.length > 0;
        if (effectiveOnboarded && !onboarded) {
          await saveOnboardingCompleted(true);
        }

        // Back up pre-existing SQLite settings into Documents + iOS Keychain mirrors
        void ensureSettingsMirrored();
        void ensureAIDiagnosticLogsLoaded();

        if (!mounted) return;
        profileRef.current = initialProfile;
        preferencesRef.current = loadedPrefs;
        authRef.current = loadedAuth;
        setMeals(initialMeals);
        setGoals(loadedGoals);
        setAuth(loadedAuth);
        setHasCompletedOnboarding(effectiveOnboarded);
        setProfile(initialProfile);
        setPreferences(loadedPrefs);
        setWaterByDate(initialWater);
        setStepsByDate(initialSteps);
        setIsReady(true);

        if (loadedAuth.companionUrl.trim()) {
          checkCompanionStatus(loadedAuth.companionUrl, loadedAuth.companionToken)
            .then((st) => {
              if (mounted) setCompanionStatus(st);
            })
            .catch(() => {
              if (mounted) setCompanionStatus(null);
            });
        }
      } catch {
        if (mounted) setIsReady(true);
      }
    })();

    const unsubSessionRefresh = subscribeChatGPTSessionRefresh((nextSession) => {
      if (!mounted) return;
      const merged = { ...authRef.current, chatgptOAuth: nextSession };
      authRef.current = merged;
      setAuth(merged);
    });

    return () => {
      mounted = false;
      unsubSessionRefresh();
      if (toastTimerRef.current) {
        clearTimeout(toastTimerRef.current);
      }
    };
  }, []);

  const dailySummaries = useMemo(() => computeDailySummaries(meals), [meals]);

  const selectedDaySummary = useMemo(
    () => dailySummaries[selectedDateKey] ?? emptySummary(selectedDateKey),
    [dailySummaries, selectedDateKey]
  );

  const todayKey = toLocalDateKey();
  const todaySummary = useMemo(
    () => dailySummaries[todayKey] ?? emptySummary(todayKey),
    [dailySummaries, todayKey]
  );

  const streakCount = useMemo(() => {
    const foodDates = new Set<string>();
    for (const m of meals) {
      if (m.entryType !== 'exercise' && m.status !== 'pending') {
        foodDates.add(m.dateKey);
      }
    }
    let count = 0;
    const cursor = new Date();
    if (!foodDates.has(toLocalDateKey(cursor))) {
      cursor.setDate(cursor.getDate() - 1);
    }
    while (foodDates.has(toLocalDateKey(cursor))) {
      count += 1;
      cursor.setDate(cursor.getDate() - 1);
    }
    return count;
  }, [meals]);

  const mealsForSelectedDate = useMemo(
    () =>
      meals
        .filter((m) => m.dateKey === selectedDateKey)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [meals, selectedDateKey]
  );

  const completeOnboarding = useCallback(async () => {
    setHasCompletedOnboarding(true);
    await saveOnboardingCompleted(true);
  }, []);

  const resetOnboarding = useCallback(async () => {
    setHasCompletedOnboarding(false);
    await saveOnboardingCompleted(false);
  }, []);

  const updateGoals = useCallback(async (nextGoals: UserGoals) => {
    setGoals(nextGoals);
    await saveGoals(nextGoals);
  }, []);

  const updateProfile = useCallback(async (patch: Partial<UserProfile>) => {
    const merged = { ...profileRef.current, ...patch };
    profileRef.current = merged;
    setProfile(merged);
    await saveUserProfile(merged);
  }, []);

  const updatePreferences = useCallback(
    async (patch: Partial<AppPreferences>) => {
      const merged = { ...preferencesRef.current, ...patch };
      preferencesRef.current = merged;
      setPreferences(merged);
      await savePreferences(merged);
    },
    []
  );

  const setWaterForDate = useCallback(
    async (dateKey: string, glasses: number) => {
      const clamped = Math.max(0, Math.min(20, Math.round(glasses)));
      const next = { ...waterByDate, [dateKey]: clamped };
      setWaterByDate(next);
      await saveWaterByDate(next);
    },
    [waterByDate]
  );

  const setStepsForDate = useCallback(
    async (dateKey: string, steps: number) => {
      const clamped = Math.max(0, Math.round(steps));
      const next = { ...stepsByDate, [dateKey]: clamped };
      setStepsByDate(next);
      await saveStepsByDate(next);
    },
    [stepsByDate]
  );

  const updateAuth = useCallback(async (patch: Partial<ProviderAuthConfig>) => {
    const merged = { ...authRef.current, ...patch };
    authRef.current = merged;
    setAuth(merged);
    await saveAuthConfig(merged);
  }, []);

  const exportBackupJson = useCallback(async () => {
    return createPortableBackupJson();
  }, []);

  const importBackupJson = useCallback(async (rawJson: string) => {
    const restored = await restorePortableBackupJson(rawJson);
    profileRef.current = restored.profile;
    preferencesRef.current = restored.preferences;
    authRef.current = restored.auth;
    setGoals(restored.goals);
    setProfile(restored.profile);
    setPreferences(restored.preferences);
    setAuth(restored.auth);
    setWaterByDate(restored.waterByDate);
    setStepsByDate(restored.stepsByDate);
    setMeals(restored.meals);
    setHasCompletedOnboarding(true);
  }, []);

  const saveMealEntry = useCallback(async (entry: MealEntry) => {
    await upsertMeal(entry);
    setMeals((prev) => {
      const idx = prev.findIndex((m) => m.id === entry.id);
      if (idx >= 0) {
        const copy = [...prev];
        copy[idx] = entry;
        return copy;
      }
      return [entry, ...prev];
    });
  }, []);

  const removeMealEntry = useCallback(async (id: string) => {
    await deleteMealById(id);
    setMeals((prev) => prev.filter((m) => m.id !== id));
  }, []);

  const startMealAnalysisJob = useCallback(
    async (params: StartMealAnalysisParams) => {
      let b64 = params.imageBase64;
      let mime = params.mimeType || 'image/jpeg';

      if (!b64 && params.photoUri) {
        const encoded = await assetToBase64({ uri: params.photoUri });
        if (encoded) {
          b64 = encoded.base64;
          mime = encoded.mimeType;
        }
      }

      if (!b64 && !params.userNotes?.trim()) {
        showToast('Snap a photo of your meal first');
        return;
      }

      const effectiveProvider = resolveReadyProvider(
        auth.activeProvider,
        auth,
        companionStatus
      );
      const providerState = isProviderConfigured(
        effectiveProvider,
        auth,
        companionStatus
      );
      if (!providerState.ready) {
        showToast('Sign in to an AI provider in Settings first');
        setActiveTab('settings');
        return;
      }

      const now = new Date();
      const targetDateKey = selectedDateKey || toLocalDateKey(now);
      const entryId = `scan_${now.getTime()}_${Math.random().toString(36).slice(2, 8)}`;
      const mealType = params.mealType ?? inferMealTypeByHour(now);

      setActiveTab('home');

      const pendingEntry: MealEntry = {
        id: entryId,
        dateKey: targetDateKey,
        createdAt: now.toISOString(),
        mealType,
        title: 'Analyzing meal…',
        photoUri: params.photoUri ?? null,
        userNotes: params.userNotes?.trim() || undefined,
        entryType: 'food',
        servings: 1,
        status: 'pending',
        progress: 4,
        calories: 0,
        protein: 0,
        carbs: 0,
        fat: 0,
        items: [],
      };

      setMeals((prev) => [pendingEntry, ...prev]);

      const startedAt = Date.now();
      const progressTimer = setInterval(() => {
        const elapsed = Date.now() - startedAt;
        const ratio = Math.min(1, elapsed / 3800);
        const eased = Math.round(92 * (1 - Math.pow(1 - ratio, 2.1)));
        setMeals((prev) =>
          prev.map((m) =>
            m.id === entryId && m.status === 'pending'
              ? { ...m, progress: Math.max(m.progress ?? 0, eased) }
              : m
          )
        );
      }, 120);

      try {
        const aiResult = await analyzeMealWithAI({
          provider: effectiveProvider,
          auth,
          imageBase64: b64,
          mimeType: mime,
          userNotes: params.userNotes,
          mealType,
        });

        const savedPhotoUri = params.photoUri
          ? await persistMealPhotoUri(params.photoUri, b64, mime)
          : null;

        clearInterval(progressTimer);

        const finalEntry: MealEntry = {
          id: entryId,
          dateKey: targetDateKey,
          createdAt: now.toISOString(),
          mealType,
          title: aiResult.title,
          photoUri: savedPhotoUri,
          userNotes: params.userNotes?.trim() || undefined,
          aiProvider: aiResult.providerUsed,
          aiSummary: aiResult.summary,
          confidence: aiResult.confidence,
          entryType: 'food',
          servings: 1,
          healthScore:
            aiResult.healthScore ??
            computeHealthScoreFromMacros(
              aiResult.calories,
              aiResult.protein,
              aiResult.carbs,
              aiResult.fat
            ),
          status: 'done',
          calories: aiResult.calories,
          protein: aiResult.protein,
          carbs: aiResult.carbs,
          fat: aiResult.fat,
          items: aiResult.items,
        };

        await upsertMeal(finalEntry);
        setMeals((prev) =>
          prev.map((m) => (m.id === entryId ? finalEntry : m))
        );
        showToast('Meal analyzed');
        setTimeout(() => setDetailEntryId(entryId), 550);
      } catch (err) {
        clearInterval(progressTimer);
        setMeals((prev) => prev.filter((m) => m.id !== entryId));
        const msg = err instanceof Error ? err.message : 'Analysis failed';
        setLastAIError({
          title: 'AI Meal Scan Failed',
          message: msg,
          provider: effectiveProvider,
          timestamp: new Date().toISOString(),
        });
        showToast('AI scan failed — see error details', 'error');
      }
    },
    [auth, companionStatus, selectedDateKey, showToast]
  );

  const refineMealEntry = useCallback(
    async (entryId: string, instruction: string): Promise<boolean> => {
      const target = meals.find((m) => m.id === entryId);
      if (!target || !instruction.trim()) return false;

      const effectiveProvider = resolveReadyProvider(
        auth.activeProvider,
        auth,
        companionStatus
      );
      const providerState = isProviderConfigured(
        effectiveProvider,
        auth,
        companionStatus
      );

      if (!providerState.ready) {
        showToast('Sign in to an AI provider in Settings to refine with AI');
        return false;
      }

      const combinedNotes = [
        `Current meal: ${target.title} (${target.calories} kcal, P ${target.protein}g, C ${target.carbs}g, F ${target.fat}g).`,
        `Existing items: ${target.items.map((i) => `${i.name} (${i.calories} kcal)`).join(', ')}.`,
        target.userNotes ? `Original notes: ${target.userNotes}` : '',
        `User correction / fix request: ${instruction.trim()}`,
      ]
        .filter(Boolean)
        .join('\n');

      try {
        let b64: string | undefined;
        let mime = 'image/jpeg';
        if (target.photoUri) {
          const encoded = await assetToBase64({ uri: target.photoUri });
          if (encoded) {
            b64 = encoded.base64;
            mime = encoded.mimeType;
          }
        }

        const aiResult = await analyzeMealWithAI({
          provider: effectiveProvider,
          auth,
          imageBase64: b64,
          mimeType: mime,
          userNotes: combinedNotes,
          mealType: target.mealType,
        });

        const updated: MealEntry = {
          ...target,
          title: aiResult.title,
          userNotes: instruction.trim(),
          aiProvider: aiResult.providerUsed,
          aiSummary: aiResult.summary,
          confidence: aiResult.confidence,
          calories: aiResult.calories,
          protein: aiResult.protein,
          carbs: aiResult.carbs,
          fat: aiResult.fat,
          healthScore:
            aiResult.healthScore ??
            computeHealthScoreFromMacros(
              aiResult.calories,
              aiResult.protein,
              aiResult.carbs,
              aiResult.fat
            ),
          items: aiResult.items,
        };

        await saveMealEntry(updated);
        showToast('Nutrition updated with AI');
        return true;
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Update failed';
        setLastAIError({
          title: 'AI Refinement Failed',
          message: msg,
          provider: effectiveProvider,
          timestamp: new Date().toISOString(),
        });
        showToast('AI update failed — see error details', 'error');
        return false;
      }
    },
    [auth, companionStatus, meals, saveMealEntry, showToast]
  );

  const clearAllLogs = useCallback(async () => {
    await Promise.all([
      replaceAllMeals([]),
      saveWaterByDate({}),
      saveStepsByDate({}),
      saveHasSeededDemo(true),
    ]);
    setMeals([]);
    setWaterByDate({});
    setStepsByDate({});
    setDetailEntryId(null);
  }, []);

  const value = useMemo<CalorieContextValue>(
    () => ({
      isReady,
      hasCompletedOnboarding,
      completeOnboarding,
      resetOnboarding,
      activeTab,
      setActiveTab,
      scannerOpen,
      setScannerOpen,
      detailEntryId,
      setDetailEntryId,
      toastMessage,
      toastTone,
      showToast,
      lastAIError,
      clearLastAIError,
      aiLogsExpandSignal,
      openAILogsInSettings,
      selectedDateKey,
      setSelectedDateKey,
      meals,
      mealsForSelectedDate,
      dailySummaries,
      selectedDaySummary,
      todaySummary,
      streakCount,
      goals,
      updateGoals,
      profile,
      updateProfile,
      preferences,
      updatePreferences,
      waterByDate,
      setWaterForDate,
      stepsByDate,
      setStepsForDate,
      auth,
      updateAuth,
      companionStatus,
      isCheckingCompanion,
      refreshCompanionStatus,
      saveMealEntry,
      removeMealEntry,
      startMealAnalysisJob,
      refineMealEntry,
      clearAllLogs,
      exportBackupJson,
      importBackupJson,
    }),
    [
      isReady,
      hasCompletedOnboarding,
      completeOnboarding,
      resetOnboarding,
      activeTab,
      scannerOpen,
      detailEntryId,
      toastMessage,
      toastTone,
      showToast,
      lastAIError,
      clearLastAIError,
      aiLogsExpandSignal,
      openAILogsInSettings,
      selectedDateKey,
      meals,
      mealsForSelectedDate,
      dailySummaries,
      selectedDaySummary,
      todaySummary,
      streakCount,
      goals,
      updateGoals,
      profile,
      updateProfile,
      preferences,
      updatePreferences,
      waterByDate,
      setWaterForDate,
      stepsByDate,
      setStepsForDate,
      auth,
      updateAuth,
      companionStatus,
      isCheckingCompanion,
      refreshCompanionStatus,
      saveMealEntry,
      removeMealEntry,
      startMealAnalysisJob,
      refineMealEntry,
      clearAllLogs,
      exportBackupJson,
      importBackupJson,
    ]
  );

  return (
    <CalorieContext.Provider value={value}>{children}</CalorieContext.Provider>
  );
}

export function useCalorieTracker(): CalorieContextValue {
  const ctx = useContext(CalorieContext);
  if (!ctx) {
    throw new Error('useCalorieTracker must be used within a CalorieProvider');
  }
  return ctx;
}
