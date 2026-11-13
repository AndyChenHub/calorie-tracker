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
  catalogFoodToItems,
  computeHealthScoreFromMacros,
  DEFAULT_PLATE_GOALS,
  DEFAULT_PREFERENCES,
  DEFAULT_USER_PROFILE,
  findCatalogFood,
  FOOD_IMAGES,
  generateDemoSeedData,
} from '../constants/plateCatalog';
import {
  analyzeMealWithAI,
  checkCompanionStatus,
  isProviderConfigured,
} from '../services/ai';
import { assetToBase64, persistMealPhotoUri } from '../services/photos';
import {
  computeDailySummaries,
  DEFAULT_GOALS,
  deleteMealById,
  getDefaultAuthConfig,
  loadAllMeals,
  loadAuthConfig,
  loadGoals,
  loadHasSeededDemo,
  loadOnboardingCompleted,
  loadPreferences,
  loadStepsByDate,
  loadUserProfile,
  loadWaterByDate,
  replaceAllMeals,
  saveAuthConfig,
  saveGoals,
  saveHasSeededDemo,
  saveOnboardingCompleted,
  savePreferences,
  saveStepsByDate,
  saveUserProfile,
  saveWaterByDate,
  upsertMeal,
} from '../services/storage';
import {
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

export interface StartMealAnalysisParams {
  photoUri?: string | null;
  imageBase64?: string;
  mimeType?: string;
  presetFoodId?: string;
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
  showToast: (msg: string) => void;
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
  resetDemoData: () => Promise<void>;
  clearAllLogs: () => Promise<void>;
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
  const [companionStatus, setCompanionStatus] =
    useState<CompanionStatusResponse | null>(null);
  const [isCheckingCompanion, setIsCheckingCompanion] = useState(false);

  const showToast = useCallback((msg: string) => {
    setToastMessage(msg);
    if (toastTimerRef.current) {
      clearTimeout(toastTimerRef.current);
    }
    toastTimerRef.current = setTimeout(() => {
      setToastMessage(null);
    }, 2400);
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
        ]);

        let initialMeals = loadedMeals;
        let initialWater = loadedWater;
        let initialSteps = loadedSteps;

        if (!seededBefore && loadedMeals.length === 0) {
          const seeded = generateDemoSeedData();
          initialMeals = seeded.meals;
          initialWater = seeded.waterByDate;
          initialSteps = seeded.stepsByDate;
          await Promise.all([
            replaceAllMeals(initialMeals),
            saveWaterByDate(initialWater),
            saveStepsByDate(initialSteps),
            saveHasSeededDemo(true),
          ]);
        }

        if (!mounted) return;
        setMeals(initialMeals);
        setGoals(loadedGoals);
        setAuth(loadedAuth);
        setHasCompletedOnboarding(onboarded);
        setProfile(loadedProfile);
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

    return () => {
      mounted = false;
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

  const updateProfile = useCallback(
    async (patch: Partial<UserProfile>) => {
      const merged = { ...profile, ...patch };
      setProfile(merged);
      await saveUserProfile(merged);
    },
    [profile]
  );

  const updatePreferences = useCallback(
    async (patch: Partial<AppPreferences>) => {
      const merged = { ...preferences, ...patch };
      setPreferences(merged);
      await savePreferences(merged);
    },
    [preferences]
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

  const updateAuth = useCallback(
    async (patch: Partial<ProviderAuthConfig>) => {
      const merged = { ...auth, ...patch };
      setAuth(merged);
      await saveAuthConfig(merged);
    },
    [auth]
  );

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
        presetFoodId: params.presetFoodId,
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

      const providerState = isProviderConfigured(
        auth.activeProvider,
        auth,
        companionStatus
      );
      const presetFood = findCatalogFood(params.presetFoodId);

      try {
        if (providerState.ready) {
          let b64 = params.imageBase64;
          let mime = params.mimeType || 'image/jpeg';

          if (!b64 && params.presetFoodId && FOOD_IMAGES[params.presetFoodId]) {
            const encoded = await assetToBase64(FOOD_IMAGES[params.presetFoodId]);
            if (encoded) {
              b64 = encoded.base64;
              mime = encoded.mimeType;
            }
          }

          const aiResult = await analyzeMealWithAI({
            provider: auth.activeProvider,
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
            presetFoodId: savedPhotoUri ? undefined : params.presetFoodId,
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
          return;
        }

        // Fallback when scanning a built-in catalog dish before AI is authorized
        if (presetFood && !params.photoUri) {
          const remainingWait = Math.max(400, 2400 - (Date.now() - startedAt));
          await new Promise((r) => setTimeout(r, remainingWait));
          clearInterval(progressTimer);

          const finalEntry: MealEntry = {
            id: entryId,
            dateKey: targetDateKey,
            createdAt: now.toISOString(),
            mealType,
            title: presetFood.name,
            presetFoodId: presetFood.id,
            userNotes: params.userNotes?.trim() || undefined,
            aiProvider: 'manual',
            aiSummary: params.userNotes?.trim()
              ? `Catalog estimate · Note: ${params.userNotes.trim()}`
              : 'Plate catalog nutrition profile (connect AI in Settings for live custom photo vision).',
            confidence: 'high',
            entryType: 'food',
            servings: 1,
            healthScore: presetFood.health,
            status: 'done',
            calories: presetFood.kcal,
            protein: presetFood.p,
            carbs: presetFood.c,
            fat: presetFood.f,
            items: catalogFoodToItems(presetFood),
          };

          await upsertMeal(finalEntry);
          setMeals((prev) =>
            prev.map((m) => (m.id === entryId ? finalEntry : m))
          );
          showToast('Meal analyzed');
          setTimeout(() => setDetailEntryId(entryId), 550);
          return;
        }

        // Custom photo uploaded while AI provider is not authorized yet
        clearInterval(progressTimer);
        setMeals((prev) => prev.filter((m) => m.id !== entryId));
        showToast(`Connect ${auth.activeProvider.toUpperCase()} in Settings first`);
        setActiveTab('settings');
      } catch (err) {
        clearInterval(progressTimer);
        // If scanning a preset dish failed due to transient network error, fall back gracefully or surface message
        setMeals((prev) => prev.filter((m) => m.id !== entryId));
        const msg = err instanceof Error ? err.message : 'Analysis failed';
        showToast(msg.length > 48 ? `${msg.slice(0, 48)}…` : msg);
      }
    },
    [auth, companionStatus, selectedDateKey, showToast]
  );

  const refineMealEntry = useCallback(
    async (entryId: string, instruction: string): Promise<boolean> => {
      const target = meals.find((m) => m.id === entryId);
      if (!target || !instruction.trim()) return false;

      const providerState = isProviderConfigured(
        auth.activeProvider,
        auth,
        companionStatus
      );

      if (!providerState.ready) {
        showToast('Authorize an AI provider in Settings to refine with AI');
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
        if (target.photoUri && target.photoUri.startsWith('data:')) {
          const comma = target.photoUri.indexOf(',');
          b64 = comma >= 0 ? target.photoUri.slice(comma + 1) : undefined;
        } else if (target.presetFoodId && FOOD_IMAGES[target.presetFoodId]) {
          const encoded = await assetToBase64(FOOD_IMAGES[target.presetFoodId]);
          if (encoded) {
            b64 = encoded.base64;
            mime = encoded.mimeType;
          }
        }

        const aiResult = await analyzeMealWithAI({
          provider: auth.activeProvider,
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
        showToast(msg.length > 46 ? `${msg.slice(0, 46)}…` : msg);
        return false;
      }
    },
    [auth, companionStatus, meals, saveMealEntry, showToast]
  );

  const resetDemoData = useCallback(async () => {
    const seeded = generateDemoSeedData();
    const today = toLocalDateKey();
    await Promise.all([
      replaceAllMeals(seeded.meals),
      saveGoals(DEFAULT_PLATE_GOALS),
      saveUserProfile(DEFAULT_USER_PROFILE),
      savePreferences(DEFAULT_PREFERENCES),
      saveWaterByDate(seeded.waterByDate),
      saveStepsByDate(seeded.stepsByDate),
      saveHasSeededDemo(true),
    ]);
    setMeals(seeded.meals);
    setGoals(DEFAULT_PLATE_GOALS);
    setProfile(DEFAULT_USER_PROFILE);
    setPreferences(DEFAULT_PREFERENCES);
    setWaterByDate(seeded.waterByDate);
    setStepsByDate(seeded.stepsByDate);
    setSelectedDateKey(today);
    showToast('Demo data reset');
  }, [showToast]);

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
    showToast('All logs cleared');
  }, [showToast]);

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
      showToast,
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
      resetDemoData,
      clearAllLogs,
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
      showToast,
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
      resetDemoData,
      clearAllLogs,
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
