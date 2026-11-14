import { CameraType, CameraView, useCameraPermissions } from 'expo-camera';
import * as Clipboard from 'expo-clipboard';
import { LinearGradient } from 'expo-linear-gradient';
import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Image,
  Keyboard,
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  CATALOG_EXERCISES,
  CATALOG_FOODS,
  createExerciseMealEntry,
  createFoodMealEntry,
  estimateStepMeters,
  formatNum,
  resolveMealImageSource,
  upsertWeightLogPoint,
} from '../constants/plateCatalog';
import { PlateTabId, useCalorieTracker } from '../context/CalorieContext';
import {
  BarcodeProductResult,
  lookupFoodBarcode,
  sanitizeBarcodeDigits,
} from '../services/barcode';
import {
  capturePhotoFromCamera,
  PickedMealPhoto,
  pickPhotoFromLibrary,
} from '../services/photos';
import { cardShadow, colors, plateColors } from '../theme/colors';
import { MealEntry, MealItem } from '../types/models';
import {
  formatTimeShort,
  inferMealTypeByHour,
  toLocalDateKey,
} from '../utils/date';
import { stripImageMetadataBase64 } from '../utils/imagePrivacy';
import { useKeyboardState } from '../utils/useKeyboardState';
import { useIsDesktopStage } from './PhoneStageFrame';
import { PlateIcon, PlateIconName } from './PlatePrimitives';

function parseMetricNumber(
  raw: string,
  fallback: number,
  min: number,
  max: number,
  decimals = 1
): number {
  const cleaned = raw.trim().replace(',', '.');
  if (!cleaned) return fallback;
  const parsed = Number(cleaned);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  const clamped = Math.max(min, Math.min(max, parsed));
  const factor = Math.pow(10, decimals);
  return Math.round(clamped * factor) / factor;
}

export type ActiveSheetType =
  | 'saved'
  | 'db'
  | 'exercise'
  | 'exerciseDetail'
  | 'weight'
  | 'steps'
  | 'profile'
  | null;

interface PlateOverlaysProps {
  activeSheet: ActiveSheetType;
  selectedExercise: MealEntry | null;
  onChangeSheet: (sheet: ActiveSheetType) => void;
}

const TAB_ITEMS: { id: PlateTabId; label: string; icon: PlateIconName }[] = [
  { id: 'home', label: 'Home', icon: 'home' },
  { id: 'progress', label: 'Progress', icon: 'chart' },
  { id: 'settings', label: 'Settings', icon: 'sliders' },
];

function LibrarySheetBody({
  savedOnly,
  onClose,
}: {
  savedOnly: boolean;
  onClose: () => void;
}) {
  const { meals, selectedDateKey, saveMealEntry, setActiveTab, showToast } =
    useCalorieTracker();
  const [query, setQuery] = useState('');

  const seenTitles = new Set<string>();
  const savedMeals: MealEntry[] = [];
  if (savedOnly) {
    for (const m of meals) {
      if (m.entryType === 'exercise' || m.status === 'pending') continue;
      const key = m.title.trim().toLowerCase();
      if (!key || seenTitles.has(key)) continue;
      seenTitles.add(key);
      savedMeals.push(m);
    }
  }

  const normalizedQuery = query.trim().toLowerCase();
  const filteredSaved = savedMeals.filter((m) =>
    m.title.toLowerCase().includes(normalizedQuery)
  );
  const filteredCatalog = CATALOG_FOODS.filter((f) =>
    f.name.toLowerCase().includes(normalizedQuery)
  );

  return (
    <View>
      <Text style={styles.sheetTitle}>
        {savedOnly ? 'Saved foods' : 'Food database'}
      </Text>
      <Text style={styles.sheetSub}>
        {savedOnly
          ? 'Re-log meals you have scanned before'
          : 'Search nutrition profiles & quick-add'}
      </Text>

      <View style={styles.searchBar}>
        <PlateIcon name="search" size={18} color={plateColors.muted} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search foods"
          placeholderTextColor={plateColors.muted}
          style={styles.searchInput}
          autoCapitalize="none"
          autoCorrect={false}
        />
      </View>

      <ScrollView
        style={{ maxHeight: 360 }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {savedOnly ? (
          filteredSaved.length === 0 ? (
            <View style={styles.emptySheetBox}>
              <Text style={styles.emptySheetText}>
                {savedMeals.length === 0
                  ? 'No saved meals yet — scan a meal with your camera first.'
                  : 'No saved meals match your search.'}
              </Text>
            </View>
          ) : (
            filteredSaved.map((meal, idx) => {
              const thumbSrc = resolveMealImageSource(meal);
              return (
                <View
                  key={meal.id}
                  style={[
                    styles.libRow,
                    idx === filteredSaved.length - 1
                      ? { borderBottomWidth: 0 }
                      : null,
                  ]}
                >
                  <View style={styles.libThumbWrap}>
                    {thumbSrc ? (
                      <Image
                        source={thumbSrc}
                        style={styles.libThumb}
                        resizeMode="cover"
                      />
                    ) : (
                      <PlateIcon
                        name="flame"
                        size={20}
                        color={plateColors.ink2}
                      />
                    )}
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.libFoodName} numberOfLines={1}>
                      {meal.title}
                    </Text>
                    <Text style={styles.libFoodMeta}>
                      {`${Math.round(meal.calories)} kcal · P ${Math.round(
                        meal.protein
                      )} g · C ${Math.round(meal.carbs)} g · F ${Math.round(
                        meal.fat
                      )} g`}
                    </Text>
                  </View>
                  <Pressable
                    onPress={async () => {
                      const now = new Date();
                      const cloned: MealEntry = {
                        ...meal,
                        id: `saved_${now.getTime()}_${Math.random()
                          .toString(36)
                          .slice(2, 7)}`,
                        dateKey: selectedDateKey,
                        createdAt: now.toISOString(),
                        mealType: inferMealTypeByHour(now),
                        servings: 1,
                        status: 'done',
                      };
                      await saveMealEntry(cloned);
                      setActiveTab('home');
                      onClose();
                      showToast(`${meal.title} added`);
                    }}
                    style={({ pressed }) => [
                      styles.roundDarkBtn,
                      pressed ? { transform: [{ scale: 0.9 }] } : null,
                    ]}
                  >
                    <PlateIcon name="plus" size={18} color="#FFFFFF" />
                  </Pressable>
                </View>
              );
            })
          )
        ) : (
          filteredCatalog.map((food, idx) => (
            <View
              key={food.id}
              style={[
                styles.libRow,
                idx === filteredCatalog.length - 1
                  ? { borderBottomWidth: 0 }
                  : null,
              ]}
            >
              <View style={styles.libThumbWrap}>
                <PlateIcon name="flame" size={20} color={plateColors.ink2} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.libFoodName} numberOfLines={1}>
                  {food.name}
                </Text>
                <Text style={styles.libFoodMeta}>
                  {`${food.kcal} kcal · ${food.portionLabel} · P ${food.p} g · C ${food.c} g · F ${food.f} g`}
                </Text>
              </View>
              <Pressable
                onPress={async () => {
                  const entry = createFoodMealEntry(
                    food,
                    new Date(),
                    selectedDateKey
                  );
                  await saveMealEntry(entry);
                  setActiveTab('home');
                  onClose();
                  showToast(`${food.name} added`);
                }}
                style={({ pressed }) => [
                  styles.roundDarkBtn,
                  pressed ? { transform: [{ scale: 0.9 }] } : null,
                ]}
              >
                <PlateIcon name="plus" size={18} color="#FFFFFF" />
              </Pressable>
            </View>
          ))
        )}
      </ScrollView>
    </View>
  );
}

function ExerciseSheetBody({ onClose }: { onClose: () => void }) {
  const { selectedDateKey, saveMealEntry, setActiveTab, showToast } =
    useCalorieTracker();

  return (
    <View>
      <Text style={styles.sheetTitle}>Log exercise</Text>
      <Text style={styles.sheetSub}>
        Calories burned are added back to your budget
      </Text>

      {CATALOG_EXERCISES.map((ex) => (
        <Pressable
          key={ex.name}
          onPress={async () => {
            const entry = createExerciseMealEntry(
              ex,
              new Date(),
              selectedDateKey
            );
            await saveMealEntry(entry);
            setActiveTab('home');
            onClose();
            showToast(`${ex.name} · +${ex.kcal} kcal`);
          }}
          style={({ pressed }) => [
            styles.exOptionRow,
            pressed ? { transform: [{ scale: 0.98 }] } : null,
          ]}
        >
          <View style={styles.exOptionIcon}>
            <PlateIcon name={ex.icon} size={18} color={plateColors.ink} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.exOptionTitle}>{ex.name}</Text>
            <Text style={styles.exOptionDesc}>{ex.desc}</Text>
          </View>
          <Text style={styles.exOptionKcal}>{`+${ex.kcal}`}</Text>
        </Pressable>
      ))}
    </View>
  );
}

function WeightSheetBody({ onClose }: { onClose: () => void }) {
  const { profile, updateProfile, showToast } = useCalorieTracker();
  const [weightDraft, setWeightDraft] = useState<string>(() =>
    profile.weightKg.toFixed(1)
  );

  const currentParsed = parseMetricNumber(
    weightDraft,
    profile.weightKg,
    30,
    300,
    1
  );

  const stepBy = (delta: number) => {
    const next = Math.max(
      30,
      Math.min(300, Math.round((currentParsed + delta) * 10) / 10)
    );
    setWeightDraft(next.toFixed(1));
  };

  return (
    <View>
      <Text style={styles.sheetTitle}>Log weight</Text>
      <Text style={styles.sheetSub}>
        Tap the number to type directly, or use +/-
      </Text>

      <View style={styles.bigStepperCenter}>
        <Pressable
          onPress={() => stepBy(-0.1)}
          style={({ pressed }) => [
            styles.roundLightBtn,
            pressed ? { transform: [{ scale: 0.9 }] } : null,
          ]}
        >
          <PlateIcon name="minus" size={18} color={plateColors.ink} />
        </Pressable>

        <View style={styles.weightInputInlineWrap}>
          <TextInput
            value={weightDraft}
            onChangeText={setWeightDraft}
            keyboardType="decimal-pad"
            returnKeyType="done"
            onSubmitEditing={() => Keyboard.dismiss()}
            selectTextOnFocus
            style={styles.weightStepperInput}
          />
          <Text style={styles.weightStepperUnit}>kg</Text>
        </View>

        <Pressable
          onPress={() => stepBy(0.1)}
          style={({ pressed }) => [
            styles.roundLightBtn,
            pressed ? { transform: [{ scale: 0.9 }] } : null,
          ]}
        >
          <PlateIcon name="plus" size={18} color={plateColors.ink} />
        </Pressable>
      </View>

      <Pressable
        onPress={async () => {
          Keyboard.dismiss();
          const finalWeight = parseMetricNumber(
            weightDraft,
            profile.weightKg,
            30,
            300,
            1
          );
          const todayKey = toLocalDateKey();
          await updateProfile({
            weightKg: finalWeight,
            weightHistory: upsertWeightLogPoint(
              profile.weightHistory,
              todayKey,
              finalWeight
            ),
          });
          onClose();
          showToast(`Weight logged · ${finalWeight.toFixed(1)} kg`);
        }}
        style={styles.sheetPrimaryBtn}
      >
        <Text style={styles.sheetPrimaryBtnText}>Save weight</Text>
      </Pressable>
    </View>
  );
}

function StepsSheetBody({ onClose }: { onClose: () => void }) {
  const { selectedDateKey, stepsByDate, setStepsForDate, profile, showToast } =
    useCalorieTracker();
  const [stepsVal, setStepsVal] = useState<number>(
    stepsByDate[selectedDateKey] ?? 0
  );
  const distanceMeters = estimateStepMeters(stepsVal, profile.heightCm);
  const distanceKm = (distanceMeters / 1000).toFixed(2);
  const stepBurnKcal = Math.round(stepsVal * 0.04);

  return (
    <View>
      <Text style={styles.sheetTitle}>Daily steps</Text>
      <Text style={styles.sheetSub}>
        {`${formatNum(distanceMeters)} m (${distanceKm} km) · +${stepBurnKcal} kcal`}
      </Text>

      <View style={styles.bigStepperCenter}>
        <Pressable
          onPress={() => setStepsVal((v) => Math.max(0, v - 500))}
          style={styles.roundLightBtn}
        >
          <PlateIcon name="minus" size={18} color={plateColors.ink} />
        </Pressable>

        <Text style={[styles.weightStepperNum, { fontSize: 42 }]}>
          {formatNum(stepsVal)}
        </Text>

        <Pressable
          onPress={() => setStepsVal((v) => v + 500)}
          style={styles.roundLightBtn}
        >
          <PlateIcon name="plus" size={18} color={plateColors.ink} />
        </Pressable>
      </View>

      <View style={styles.presetChipsRow}>
        {[5000, 8000, 10000, 12500].map((preset) => (
          <Pressable
            key={preset}
            onPress={() => setStepsVal(preset)}
            style={[
              styles.presetPill,
              stepsVal === preset ? styles.presetPillActive : null,
            ]}
          >
            <Text
              style={[
                styles.presetPillText,
                stepsVal === preset ? { color: '#FFFFFF' } : null,
              ]}
            >
              {formatNum(preset)}
            </Text>
          </Pressable>
        ))}
      </View>

      <Pressable
        onPress={async () => {
          await setStepsForDate(selectedDateKey, stepsVal);
          onClose();
          showToast(
            `Steps updated · ${formatNum(stepsVal)} (${distanceKm} km)`
          );
        }}
        style={styles.sheetPrimaryBtn}
      >
        <Text style={styles.sheetPrimaryBtnText}>Save steps</Text>
      </Pressable>
    </View>
  );
}

function ProfileSheetBody({
  onClose,
  keyboardVisible,
  registerBackdropSave,
}: {
  onClose: () => void;
  keyboardVisible: boolean;
  registerBackdropSave: (fn: (() => Promise<void>) | null) => void;
}) {
  const { profile, updateProfile, showToast } = useCalorieTracker();
  const [name, setName] = useState(profile.name);
  const [heightStr, setHeightStr] = useState(String(profile.heightCm));
  const [currentWStr, setCurrentWStr] = useState(String(profile.weightKg));
  const [startWStr, setStartWStr] = useState(String(profile.startWeightKg));
  const [goalWStr, setGoalWStr] = useState(String(profile.goalWeightKg));

  const commitSave = async (silentIfUnchanged: boolean) => {
    const nextName = name.trim() || profile.name || 'You';
    const parsedHeight = parseMetricNumber(
      heightStr,
      profile.heightCm,
      120,
      240,
      0
    );
    const parsedCurrent = parseMetricNumber(
      currentWStr,
      profile.weightKg,
      30,
      300,
      1
    );
    const parsedStart = parseMetricNumber(
      startWStr,
      profile.startWeightKg,
      30,
      300,
      1
    );
    const parsedGoal = parseMetricNumber(
      goalWStr,
      profile.goalWeightKg,
      30,
      300,
      1
    );

    const hasChanges =
      nextName !== profile.name ||
      parsedHeight !== profile.heightCm ||
      parsedCurrent !== profile.weightKg ||
      parsedStart !== profile.startWeightKg ||
      parsedGoal !== profile.goalWeightKg;

    if (!silentIfUnchanged || hasChanges) {
      const todayKey = toLocalDateKey();
      await updateProfile({
        name: nextName,
        heightCm: parsedHeight,
        weightKg: parsedCurrent,
        startWeightKg: parsedStart,
        goalWeightKg: parsedGoal,
        ...(parsedCurrent !== profile.weightKg
          ? {
              weightHistory: upsertWeightLogPoint(
                profile.weightHistory,
                todayKey,
                parsedCurrent
              ),
            }
          : {}),
      });
      showToast('Profile saved');
    }

    Keyboard.dismiss();
    onClose();
  };

  const commitSaveRef = useRef(commitSave);
  useEffect(() => {
    commitSaveRef.current = commitSave;
  });

  useEffect(() => {
    registerBackdropSave(() => commitSaveRef.current(true));
    return () => registerBackdropSave(null);
  }, [registerBackdropSave]);

  const previewHeightCm = parseMetricNumber(
    heightStr,
    profile.heightCm,
    120,
    240,
    0
  );
  const previewCurrentKg = parseMetricNumber(
    currentWStr,
    profile.weightKg,
    30,
    300,
    1
  );
  const previewGoalKg = parseMetricNumber(
    goalWStr,
    profile.goalWeightKg,
    30,
    300,
    1
  );
  const heightMeters = previewHeightCm / 100;
  const previewBmi = previewCurrentKg / (heightMeters * heightMeters);
  const goalDiff = Math.round((previewCurrentKg - previewGoalKg) * 10) / 10;

  return (
    <View style={{ gap: 10 }}>
      <Pressable
        onPress={() => Keyboard.dismiss()}
        style={styles.sheetHeaderRow}
      >
        <View style={{ flex: 1 }}>
          <Text style={styles.sheetTitle}>Edit profile</Text>
          <Text style={[styles.sheetSub, { marginBottom: 2 }]}>
            Tap Save or tap outside to keep changes
          </Text>
        </View>
        {keyboardVisible ? (
          <Pressable
            onPress={() => Keyboard.dismiss()}
            style={styles.keyboardDonePill}
          >
            <PlateIcon name="check" size={14} color="#FFFFFF" />
            <Text style={styles.keyboardDonePillText}>Done</Text>
          </Pressable>
        ) : null}
      </Pressable>

      <View style={{ flexDirection: 'row', gap: 10 }}>
        <View style={{ flex: 1.35 }}>
          <Text style={styles.fieldLabel}>Name</Text>
          <TextInput
            value={name}
            onChangeText={setName}
            style={styles.sheetInput}
            placeholder="Your name"
            placeholderTextColor={plateColors.faint}
            returnKeyType="done"
            onSubmitEditing={() => Keyboard.dismiss()}
          />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.fieldLabel}>
            {`Height (cm · ${heightMeters.toFixed(2)} m)`}
          </Text>
          <TextInput
            value={heightStr}
            onChangeText={setHeightStr}
            keyboardType="numeric"
            returnKeyType="done"
            onSubmitEditing={() => Keyboard.dismiss()}
            selectTextOnFocus
            style={styles.sheetInput}
          />
        </View>
      </View>

      <View style={{ flexDirection: 'row', gap: 10 }}>
        <View style={{ flex: 1 }}>
          <Text style={styles.fieldLabel}>Current weight (kg)</Text>
          <TextInput
            value={currentWStr}
            onChangeText={setCurrentWStr}
            keyboardType="decimal-pad"
            returnKeyType="done"
            onSubmitEditing={() => Keyboard.dismiss()}
            selectTextOnFocus
            style={styles.sheetInput}
          />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.fieldLabel}>Goal weight (kg)</Text>
          <TextInput
            value={goalWStr}
            onChangeText={setGoalWStr}
            keyboardType="decimal-pad"
            returnKeyType="done"
            onSubmitEditing={() => Keyboard.dismiss()}
            selectTextOnFocus
            style={styles.sheetInput}
          />
        </View>
      </View>

      <View style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-end' }}>
        <View style={{ flex: 1 }}>
          <Text style={styles.fieldLabel}>Starting weight (kg)</Text>
          <TextInput
            value={startWStr}
            onChangeText={setStartWStr}
            keyboardType="decimal-pad"
            returnKeyType="done"
            onSubmitEditing={() => Keyboard.dismiss()}
            selectTextOnFocus
            style={styles.sheetInput}
          />
        </View>
        <Pressable
          onPress={() => Keyboard.dismiss()}
          style={styles.profileLiveSummaryBox}
        >
          <Text style={styles.profileLiveSummaryTop}>
            {`BMI ${previewBmi.toFixed(1)}`}
          </Text>
          <Text style={styles.profileLiveSummarySub} numberOfLines={1}>
            {goalDiff === 0
              ? 'At goal weight'
              : goalDiff > 0
                ? `${goalDiff.toFixed(1)} kg to goal`
                : `+${Math.abs(goalDiff).toFixed(1)} kg target`}
          </Text>
        </Pressable>
      </View>

      <View style={styles.profileActionsRow}>
        <Pressable
          onPress={() => {
            Keyboard.dismiss();
            onClose();
          }}
          style={styles.sheetCancelBtn}
        >
          <Text style={styles.sheetCancelBtnText}>Cancel</Text>
        </Pressable>

        <Pressable
          onPress={() => void commitSave(false)}
          style={[styles.sheetPrimaryBtn, { flex: 1.5 }]}
        >
          <Text style={styles.sheetPrimaryBtnText}>Save profile</Text>
        </Pressable>
      </View>
    </View>
  );
}

function ScannerOverlayContent({ onClose }: { onClose: () => void }) {
  const isDesktopStage = useIsDesktopStage();
  const insets = useSafeAreaInsets();
  const keyboard = useKeyboardState();
  const {
    auth,
    selectedDateKey,
    saveMealEntry,
    setActiveTab,
    setDetailEntryId,
    startMealAnalysisJob,
    showToast,
  } = useCalorieTracker();

  const cameraRef = useRef<CameraView | null>(null);
  const lastScannedCodeRef = useRef<string>('');
  const [permission, requestPermission] = useCameraPermissions();
  const [facing, setFacing] = useState<CameraType>('back');
  const [cameraReady, setCameraReady] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [pickedPhoto, setPickedPhoto] = useState<PickedMealPhoto | null>(null);
  const [userNotes, setUserNotes] = useState('');
  const [scanMode, setScanMode] = useState<
    'scan' | 'barcode' | 'label' | 'library'
  >('scan');
  const [flashOn, setFlashOn] = useState(false);

  const [barcodeInput, setBarcodeInput] = useState('');
  const [barcodeLoading, setBarcodeLoading] = useState(false);
  const [barcodeError, setBarcodeError] = useState<string | null>(null);
  const [barcodeResult, setBarcodeResult] =
    useState<BarcodeProductResult | null>(null);

  const [scanLineY] = useState(() => new Animated.Value(12));
  const [shutterFlash] = useState(() => new Animated.Value(0));

  useEffect(() => {
    if (permission && !permission.granted && permission.canAskAgain) {
      void requestPermission();
    }
  }, [permission, requestPermission]);

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(scanLineY, {
          toValue: 204,
          duration: 2100,
          useNativeDriver: true,
        }),
        Animated.timing(scanLineY, {
          toValue: 12,
          duration: 2100,
          useNativeDriver: true,
        }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [scanLineY]);

  const handlePickLibrary = async () => {
    try {
      const picked = await pickPhotoFromLibrary();
      if (picked) {
        setPickedPhoto(picked);
        setScanMode('scan');
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not open library');
    }
  };

  const triggerShutterFlash = () => {
    Animated.sequence([
      Animated.timing(shutterFlash, {
        toValue: 0.95,
        duration: 80,
        useNativeDriver: true,
      }),
      Animated.timing(shutterFlash, {
        toValue: 0,
        duration: 260,
        useNativeDriver: true,
      }),
    ]).start();
  };

  const buildNotesWithMode = () => {
    const trimmed = userNotes.trim();
    if (scanMode === 'label') {
      return trimmed
        ? `Nutrition facts label scan. ${trimmed}`
        : 'Nutrition facts label scan — read calories and macros from the label.';
    }
    return trimmed || undefined;
  };

  const handleLookupBarcode = async (rawCode: string) => {
    const clean = sanitizeBarcodeDigits(rawCode);
    if (!clean || barcodeLoading) return;
    Keyboard.dismiss();
    setBarcodeInput(clean);
    setBarcodeLoading(true);
    setBarcodeError(null);
    try {
      const product = await lookupFoodBarcode(clean);
      setBarcodeResult(product);
      showToast(`Found: ${product.title}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Barcode lookup failed';
      setBarcodeResult(null);
      setBarcodeError(msg);
      showToast(msg, 'error');
    } finally {
      setBarcodeLoading(false);
    }
  };

  const handleLogBarcodeProduct = async () => {
    if (!barcodeResult) return;
    const now = new Date();
    const entry: MealEntry = {
      id: `meal_${now.getTime()}_${Math.random().toString(36).slice(2, 7)}`,
      dateKey: selectedDateKey,
      createdAt: now.toISOString(),
      mealType: inferMealTypeByHour(now),
      title: barcodeResult.title,
      photoUri: null,
      userNotes: `Barcode: ${barcodeResult.barcode} (${barcodeResult.metricPortion})`,
      aiProvider: 'manual',
      aiSummary: barcodeResult.summary,
      confidence: 'high',
      calories: barcodeResult.calories,
      protein: barcodeResult.protein,
      carbs: barcodeResult.carbs,
      fat: barcodeResult.fat,
      healthScore: barcodeResult.healthScore,
      items: barcodeResult.items,
      entryType: 'food',
      servings: 1,
      status: 'done',
    };
    await saveMealEntry(entry);
    setActiveTab('home');
    setDetailEntryId(entry.id);
    onClose();
    showToast(`${barcodeResult.title} added`);
  };

  const handleAnalyzeNotesOnly = () => {
    const notes = buildNotesWithMode();
    if (!notes) return;
    Keyboard.dismiss();
    triggerShutterFlash();
    setTimeout(() => {
      onClose();
      void startMealAnalysisJob({
        userNotes: notes,
        mimeType: 'image/jpeg',
      });
    }, 120);
  };

  const handleCaptureAnalyze = async () => {
    if (capturing) return;

    if (scanMode === 'barcode') {
      if (barcodeResult) {
        await handleLogBarcodeProduct();
        return;
      }
      if (barcodeInput.trim()) {
        await handleLookupBarcode(barcodeInput);
        return;
      }
      showToast('Point camera at a barcode or enter the digits above');
      return;
    }

    if (pickedPhoto) {
      triggerShutterFlash();
      const notes = buildNotesWithMode();
      setTimeout(() => {
        onClose();
        void startMealAnalysisJob({
          photoUri: pickedPhoto.uri,
          imageBase64: pickedPhoto.base64,
          mimeType: pickedPhoto.mimeType || 'image/jpeg',
          userNotes: notes,
        });
      }, 150);
      return;
    }

    if (!permission?.granted) {
      if (userNotes.trim()) {
        handleAnalyzeNotesOnly();
        return;
      }
      if (permission?.canAskAgain !== false) {
        const res = await requestPermission();
        if (!res.granted) {
          showToast('Camera permission is required to scan meals');
        }
        return;
      }
      try {
        const captured = await capturePhotoFromCamera();
        if (captured) {
          onClose();
          void startMealAnalysisJob({
            photoUri: captured.uri,
            imageBase64: captured.base64,
            mimeType: captured.mimeType || 'image/jpeg',
            userNotes: buildNotesWithMode(),
          });
        }
      } catch {
        if (Platform.OS !== 'web') {
          void Linking.openSettings();
        }
        showToast('Enable camera access in Settings');
      }
      return;
    }

    if (!cameraRef.current || !cameraReady) {
      if (userNotes.trim()) {
        handleAnalyzeNotesOnly();
        return;
      }
      showToast('Camera is starting up…');
      return;
    }

    setCapturing(true);
    triggerShutterFlash();
    try {
      const shot = await cameraRef.current.takePictureAsync({
        quality: 0.72,
        base64: true,
        exif: false,
      });
      if (!shot?.uri) {
        setCapturing(false);
        showToast('Could not capture photo — please try again');
        return;
      }
      let b64 = shot.base64 || '';
      if (!b64 && shot.uri.startsWith('data:')) {
        const comma = shot.uri.indexOf(',');
        b64 = comma >= 0 ? shot.uri.slice(comma + 1) : '';
      }
      if (b64) {
        b64 = stripImageMetadataBase64(b64);
      }
      const notes = buildNotesWithMode();
      onClose();
      void startMealAnalysisJob({
        photoUri: shot.uri,
        imageBase64: b64,
        mimeType: 'image/jpeg',
        userNotes: notes,
      });
    } catch {
      setCapturing(false);
      try {
        const fallbackShot = await capturePhotoFromCamera();
        if (fallbackShot) {
          const notes = buildNotesWithMode();
          onClose();
          void startMealAnalysisJob({
            photoUri: fallbackShot.uri,
            imageBase64: fallbackShot.base64,
            mimeType: fallbackShot.mimeType || 'image/jpeg',
            userNotes: notes,
          });
          return;
        }
      } catch (innerErr) {
        showToast(
          innerErr instanceof Error
            ? innerErr.message
            : 'Could not capture photo'
        );
      }
    }
  };

  const providerLabel = colors.providers[auth.activeProvider].label;

  return (
    <KeyboardAvoidingView
      behavior="padding"
      keyboardVerticalOffset={insets.top}
      style={styles.scannerRoot}
    >
      {/* Live Camera Viewfinder (or User's Picked Photo — NEVER stock images) */}
      {pickedPhoto ? (
        <Image
          source={{ uri: pickedPhoto.uri }}
          style={styles.scannerBgImage}
          resizeMode="cover"
        />
      ) : permission?.granted ? (
        <CameraView
          ref={cameraRef}
          style={styles.scannerBgImage}
          facing={facing}
          enableTorch={flashOn && facing === 'back'}
          flash={flashOn ? 'on' : 'off'}
          onCameraReady={() => setCameraReady(true)}
          onMountError={(e) => {
            showToast(e.message || 'Camera failed to start');
          }}
          barcodeScannerSettings={
            scanMode === 'barcode'
              ? { barcodeTypes: ['ean13', 'ean8', 'upc_a', 'upc_e'] }
              : undefined
          }
          onBarcodeScanned={
            scanMode === 'barcode' && !barcodeLoading && !barcodeResult
              ? ({ data }) => {
                  const clean = sanitizeBarcodeDigits(data || '');
                  if (
                    /^\d{6,18}$/.test(clean) &&
                    clean !== lastScannedCodeRef.current
                  ) {
                    lastScannedCodeRef.current = clean;
                    void handleLookupBarcode(clean);
                  }
                }
              : undefined
          }
        />
      ) : (
        <View style={[styles.scannerBgImage, { backgroundColor: '#0A0A0D' }]} />
      )}

      <LinearGradient
        colors={['rgba(0,0,0,0.58)', 'rgba(0,0,0,0.08)', 'rgba(0,0,0,0.78)']}
        locations={[0, 0.45, 1]}
        pointerEvents="none"
        style={StyleSheet.absoluteFill}
      />

      {/* Top Bar */}
      <View
        style={[
          styles.scannerTopBar,
          { top: isDesktopStage ? 54 : 12 },
        ]}
      >
        <Pressable onPress={onClose} style={styles.glassCircleBtn}>
          <PlateIcon name="x" size={18} color="#FFFFFF" />
        </Pressable>

        <View style={styles.scannerTitleCenter}>
          <Text style={styles.scannerTitleText}>Scanner</Text>
          <Text style={styles.scannerSubBadge}>{`AI · ${providerLabel}`}</Text>
        </View>

        <Pressable
          onPress={() => {
            if (pickedPhoto) {
              setPickedPhoto(null);
            } else {
              setFacing((prev) => (prev === 'back' ? 'front' : 'back'));
            }
          }}
          style={styles.glassCircleBtn}
        >
          <PlateIcon name="swap" size={18} color="#FFFFFF" />
        </Pressable>
      </View>

      {/* Center Scan Frame + Animated Scanline (or Barcode Result / Permission Prompt) */}
      <View style={styles.scannerCenterArea}>
        {scanMode === 'barcode' && barcodeResult ? (
          <View style={[styles.barcodeResultCard, cardShadow]}>
            <View style={styles.barcodeResultTopRow}>
              <View style={styles.barcodeBadgePill}>
                <PlateIcon name="barcode" size={14} color={plateColors.ink} />
                <Text style={styles.barcodeBadgeText}>
                  {barcodeResult.barcode}
                </Text>
              </View>
              <Text style={styles.barcodePortionPill}>
                {`Per ${barcodeResult.metricPortion}`}
              </Text>
            </View>

            <Text style={styles.barcodeTitleText} numberOfLines={2}>
              {barcodeResult.title}
            </Text>

            <View style={styles.barcodeMetricsRow}>
              <View style={styles.barcodeMetricBox}>
                <Text style={styles.barcodeMetricVal}>
                  {barcodeResult.calories}
                </Text>
                <Text style={styles.barcodeMetricLbl}>kcal</Text>
              </View>
              <View style={styles.barcodeMetricBox}>
                <Text
                  style={[styles.barcodeMetricVal, { color: plateColors.protein }]}
                >
                  {`${barcodeResult.protein} g`}
                </Text>
                <Text style={styles.barcodeMetricLbl}>Protein</Text>
              </View>
              <View style={styles.barcodeMetricBox}>
                <Text
                  style={[styles.barcodeMetricVal, { color: plateColors.carbs }]}
                >
                  {`${barcodeResult.carbs} g`}
                </Text>
                <Text style={styles.barcodeMetricLbl}>Carbs</Text>
              </View>
              <View style={styles.barcodeMetricBox}>
                <Text
                  style={[styles.barcodeMetricVal, { color: plateColors.fat }]}
                >
                  {`${barcodeResult.fat} g`}
                </Text>
                <Text style={styles.barcodeMetricLbl}>Fat</Text>
              </View>
            </View>

            <View style={styles.barcodeActionsRow}>
              <Pressable
                onPress={() => {
                  lastScannedCodeRef.current = '';
                  setBarcodeResult(null);
                  setBarcodeError(null);
                }}
                style={styles.barcodeResetBtn}
              >
                <Text style={styles.barcodeResetBtnText}>Scan another</Text>
              </Pressable>
              <Pressable
                onPress={() => void handleLogBarcodeProduct()}
                style={styles.barcodeLogBtn}
              >
                <Text style={styles.barcodeLogBtnText}>Add to Log</Text>
              </Pressable>
            </View>
          </View>
        ) : !pickedPhoto && permission && !permission.granted && scanMode !== 'barcode' ? (
          <View style={styles.permissionCard}>
            <PlateIcon name="camera" size={28} color="#FFFFFF" />
            <Text style={styles.permissionTitle}>Camera Access Required</Text>
            <Text style={styles.permissionSub}>
              Allow Plate to use your camera so you can point at your meal, or
              upload a photo / type gram details below.
            </Text>
            <Pressable
              onPress={() => {
                if (permission.canAskAgain) {
                  void requestPermission();
                } else if (Platform.OS !== 'web') {
                  void Linking.openSettings();
                }
              }}
              style={styles.permissionBtn}
            >
              <Text style={styles.permissionBtnText}>
                {permission.canAskAgain
                  ? 'Allow Camera Access'
                  : 'Open Settings'}
              </Text>
            </Pressable>
          </View>
        ) : (
          <View style={styles.scanFrameBox} pointerEvents="none">
            <View style={[styles.cornerBracket, styles.cornerTL]} />
            <View style={[styles.cornerBracket, styles.cornerTR]} />
            <View style={[styles.cornerBracket, styles.cornerBL]} />
            <View style={[styles.cornerBracket, styles.cornerBR]} />

            <Animated.View
              style={[
                styles.scanLine,
                { transform: [{ translateY: scanLineY }] },
              ]}
            />
          </View>
        )}

        <View style={styles.scannerHintRow}>
          <Text style={styles.scannerHintText}>
            {pickedPhoto
              ? 'Photo ready · tap shutter to analyze'
              : scanMode === 'barcode'
                ? barcodeError || 'Point camera at barcode or enter digits below'
                : scanMode === 'label'
                  ? 'Point camera at nutrition facts label'
                  : 'Point camera at your meal & tap shutter'}
          </Text>
          {pickedPhoto ? (
            <Pressable
              onPress={() => setPickedPhoto(null)}
              style={styles.liveCamChip}
            >
              <PlateIcon name="camera" size={13} color="#FFFFFF" />
              <Text style={styles.liveCamChipText}>Live Camera</Text>
            </Pressable>
          ) : null}
        </View>

        {scanMode === 'barcode' ? (
          <View style={styles.notesGlassWrap}>
            <PlateIcon name="barcode" size={15} color="rgba(255,255,255,0.85)" />
            <TextInput
              value={barcodeInput}
              onChangeText={(txt) => {
                setBarcodeInput(txt);
                if (barcodeError) setBarcodeError(null);
              }}
              placeholder="Enter EAN / UPC barcode (e.g. 3017620422003)…"
              placeholderTextColor="rgba(255,255,255,0.62)"
              keyboardType="number-pad"
              returnKeyType="search"
              onSubmitEditing={() => void handleLookupBarcode(barcodeInput)}
              style={styles.notesGlassInput}
            />
            <Pressable
              onPress={() => void handleLookupBarcode(barcodeInput)}
              disabled={barcodeLoading || !barcodeInput.trim()}
              style={[
                styles.notesActionPill,
                !barcodeInput.trim() ? { opacity: 0.45 } : null,
              ]}
            >
              {barcodeLoading ? (
                <ActivityIndicator size="small" color={plateColors.ink} />
              ) : (
                <Text style={styles.notesActionPillText}>Look up</Text>
              )}
            </Pressable>
          </View>
        ) : (
          <View style={styles.notesGlassWrap}>
            <PlateIcon name="sparkle" size={15} color="rgba(255,255,255,0.8)" />
            <TextInput
              value={userNotes}
              onChangeText={setUserNotes}
              placeholder="Optional: g or mL (e.g. 180 g chicken, 250 mL milk)…"
              placeholderTextColor="rgba(255,255,255,0.62)"
              style={styles.notesGlassInput}
              returnKeyType="done"
              onSubmitEditing={() => Keyboard.dismiss()}
            />
            {userNotes.trim() && !pickedPhoto ? (
              <Pressable
                onPress={handleAnalyzeNotesOnly}
                style={styles.notesActionPill}
              >
                <Text style={styles.notesActionPillText}>Analyze</Text>
              </Pressable>
            ) : keyboard.visible ? (
              <Pressable
                onPress={() => Keyboard.dismiss()}
                style={styles.liveCamChip}
              >
                <Text style={styles.liveCamChipText}>Done</Text>
              </Pressable>
            ) : null}
          </View>
        )}
      </View>

      {/* Bottom Modes + Shutter */}
      <View style={styles.scannerBottomArea}>
        <View style={styles.modesRow}>
          {(
            [
              ['scan', 'Scan food', 'scan'],
              ['barcode', 'Barcode', 'barcode'],
              ['label', 'Food label', 'label'],
              ['library', 'Library', 'image'],
            ] as const
          ).map(([id, label, icon]) => {
            const on = scanMode === id;
            return (
              <Pressable
                key={id}
                onPress={() => {
                  if (id === 'library') {
                    void handlePickLibrary();
                  } else {
                    setScanMode(id);
                  }
                }}
                style={[styles.modeBtn, on ? styles.modeBtnOn : null]}
              >
                <PlateIcon
                  name={icon}
                  size={20}
                  color={on ? plateColors.ink : '#FFFFFF'}
                />
                <Text
                  style={[styles.modeBtnText, on ? styles.modeBtnTextOn : null]}
                >
                  {label}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <View style={styles.shutterRow}>
          <Pressable
            onPress={() => setFlashOn((v) => !v)}
            style={[
              styles.glassCircleBtn,
              flashOn ? { backgroundColor: 'rgba(255,214,10,0.92)' } : null,
            ]}
          >
            <PlateIcon
              name="zap"
              size={18}
              color={flashOn ? plateColors.ink : '#FFFFFF'}
            />
          </Pressable>

          <Pressable
            onPress={() => void handleCaptureAnalyze()}
            disabled={capturing}
            style={({ pressed }) => [
              styles.shutterOuter,
              pressed || capturing ? { transform: [{ scale: 0.92 }] } : null,
            ]}
          >
            {capturing ? (
              <ActivityIndicator size="small" color="#FFFFFF" />
            ) : (
              <View style={styles.shutterInner} />
            )}
          </Pressable>

          <Pressable
            onPress={() => void handlePickLibrary()}
            style={styles.glassCircleBtn}
          >
            <PlateIcon name="image" size={18} color="#FFFFFF" />
          </Pressable>
        </View>
      </View>

      {/* Camera Shutter White Flash */}
      <Animated.View
        pointerEvents="none"
        style={[styles.flashOverlay, { opacity: shutterFlash }]}
      />
    </KeyboardAvoidingView>
  );
}

function NutritionDetailContent({
  entry,
  onClose,
}: {
  entry: MealEntry;
  onClose: () => void;
}) {
  const isDesktopStage = useIsDesktopStage();
  const insets = useSafeAreaInsets();
  const keyboard = useKeyboardState();
  const {
    saveMealEntry,
    removeMealEntry,
    refineMealEntry,
    showToast,
  } = useCalorieTracker();

  const [showAddIng, setShowAddIng] = useState(false);
  const [newIngName, setNewIngName] = useState('');
  const [newIngGrams, setNewIngGrams] = useState('');
  const [newIngKcal, setNewIngKcal] = useState('');

  const [showFixBox, setShowFixBox] = useState(false);
  const [fixPrompt, setFixPrompt] = useState('');
  const [refining, setRefining] = useState(false);

  const servings = entry.servings ?? 1;
  const imgSrc = resolveMealImageSource(entry);
  const health = entry.healthScore ?? 8;
  const healthColor =
    health >= 7
      ? plateColors.ok
      : health >= 5
        ? plateColors.carbs
        : plateColors.protein;

  const updateServings = async (delta: number) => {
    const next = Math.max(
      0.5,
      Math.min(5, Math.round((servings + delta) * 10) / 10)
    );
    await saveMealEntry({ ...entry, servings: next });
  };

  const handleAddIngredient = async () => {
    const cleanName = newIngName.trim();
    const kcalNum = Math.max(0, Math.round(Number(newIngKcal) || 0));
    const parsedGrams = Math.max(0, Math.round(Number(newIngGrams) || 0));
    if (!cleanName || kcalNum <= 0) {
      showToast('Enter ingredient name and kcal');
      return;
    }
    const addedItem: MealItem = {
      id: `ing_${Date.now()}`,
      name: cleanName,
      grams: parsedGrams > 0 ? parsedGrams : null,
      portion: parsedGrams > 0 ? `${parsedGrams} g` : undefined,
      calories: kcalNum,
      protein: 0,
      carbs: 0,
      fat: 0,
    };
    const nextItems = [...(entry.items || []), addedItem];
    await saveMealEntry({
      ...entry,
      calories: entry.calories + kcalNum,
      items: nextItems,
    });
    setNewIngName('');
    setNewIngGrams('');
    setNewIngKcal('');
    setShowAddIng(false);
    showToast(`${cleanName} added`);
  };

  const handleRunFix = async () => {
    if (!fixPrompt.trim()) {
      showToast('Describe what to adjust (e.g. "no fries" or "200 g rice")');
      return;
    }
    setRefining(true);
    const ok = await refineMealEntry(entry.id, fixPrompt.trim());
    setRefining(false);
    if (ok) {
      setFixPrompt('');
      setShowFixBox(false);
    }
  };

  const providerCaption =
    entry.aiProvider && entry.aiProvider !== 'manual'
      ? `AI estimate · ${colors.providers[entry.aiProvider].label}`
      : 'AI estimate · 94% confidence';

  return (
    <KeyboardAvoidingView
      behavior="padding"
      keyboardVerticalOffset={insets.top}
      style={styles.detailRoot}
    >
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingBottom: 112 }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* Hero Image */}
        <View style={styles.detailHero}>
          {imgSrc ? (
            <Image
              source={imgSrc}
              style={styles.detailHeroImg}
              resizeMode="cover"
            />
          ) : (
            <View style={styles.detailHeroFallback}>
              <PlateIcon
                name="flame"
                size={42}
                color="rgba(255,255,255,0.28)"
              />
            </View>
          )}
          <LinearGradient
            colors={['rgba(0,0,0,0.45)', 'transparent', 'rgba(0,0,0,0.2)']}
            locations={[0, 0.35, 1]}
            style={StyleSheet.absoluteFill}
          />

          <View
            style={[
              styles.detailTopBar,
              { top: isDesktopStage ? 54 : 12 },
            ]}
          >
            <Pressable onPress={onClose} style={styles.glassCircleBtn}>
              <PlateIcon name="back" size={18} color="#FFFFFF" />
            </Pressable>
            <Text style={styles.detailNavTitle}>Nutrition</Text>
            <Pressable
              onPress={async () => {
                await removeMealEntry(entry.id);
                onClose();
                showToast('Entry removed');
              }}
              style={styles.glassCircleBtn}
            >
              <PlateIcon name="trash" size={18} color="#FFFFFF" />
            </Pressable>
          </View>
        </View>

        {/* Overlapping Rounded Body */}
        <View style={styles.detailBody}>
          <View style={styles.detailMetaRow}>
            <View style={styles.detailTimePill}>
              <PlateIcon name="bookmark" size={12} color={plateColors.ink2} />
              <Text style={styles.detailTimeText}>
                {formatTimeShort(entry.createdAt)}
              </Text>
            </View>
            <View style={styles.aiConfidenceRow}>
              <PlateIcon name="sparkle" size={14} color={plateColors.muted} />
              <Text style={styles.aiConfidenceText}>{providerCaption}</Text>
            </View>
          </View>

          {/* Title + Servings Stepper */}
          <View style={styles.detailTitleRow}>
            <Text style={styles.detailTitleText}>{entry.title}</Text>

            <View style={styles.servingsStepper}>
              <Pressable
                onPress={() => updateServings(-0.5)}
                style={styles.stepperCircle}
              >
                <PlateIcon name="minus" size={15} color={plateColors.ink} />
              </Pressable>
              <Text style={styles.servingsVal}>{servings}</Text>
              <Pressable
                onPress={() => updateServings(0.5)}
                style={styles.stepperCircle}
              >
                <PlateIcon name="plus" size={15} color={plateColors.ink} />
              </Pressable>
            </View>
          </View>

          {/* Calories Card */}
          <View style={[styles.detailKcalCard, cardShadow]}>
            <View style={styles.detailKcalBadge}>
              <PlateIcon name="flame" size={24} color={plateColors.ink} />
            </View>
            <View>
              <Text style={styles.detailCardSmallLabel}>Calories</Text>
              <Text style={styles.detailKcalBig}>
                {formatNum(entry.calories * servings)}
              </Text>
            </View>
          </View>

          {/* 3 Macro Cards */}
          <View style={styles.detailMacrosRow}>
            <View style={[styles.detailMacroCard, cardShadow]}>
              <PlateIcon name="drum" size={18} color={plateColors.protein} />
              <View>
                <Text style={styles.detailMacroLabel}>Protein</Text>
                <Text style={styles.detailMacroVal}>
                  {`${Math.round(entry.protein * servings)} g`}
                </Text>
              </View>
            </View>

            <View style={[styles.detailMacroCard, cardShadow]}>
              <PlateIcon name="wheat" size={18} color={plateColors.carbs} />
              <View>
                <Text style={styles.detailMacroLabel}>Carbs</Text>
                <Text style={styles.detailMacroVal}>
                  {`${Math.round(entry.carbs * servings)} g`}
                </Text>
              </View>
            </View>

            <View style={[styles.detailMacroCard, cardShadow]}>
              <PlateIcon name="drop" size={18} color={plateColors.fat} />
              <View>
                <Text style={styles.detailMacroLabel}>Fats</Text>
                <Text style={styles.detailMacroVal}>
                  {`${Math.round(entry.fat * servings)} g`}
                </Text>
              </View>
            </View>
          </View>

          {/* Health Score */}
          <View style={[styles.healthCard, cardShadow]}>
            <View style={styles.healthBadge}>
              <PlateIcon
                name="heart"
                size={18}
                color="#F2465A"
                fill="#F2465A"
              />
            </View>
            <View style={{ flex: 1 }}>
              <View style={styles.healthTopRow}>
                <Text style={styles.healthTitle}>Health score</Text>
                <Text style={styles.healthScoreText}>{`${health}/10`}</Text>
              </View>
              <View style={styles.healthTrack}>
                <View
                  style={[
                    styles.healthFill,
                    {
                      width: `${Math.min(100, health * 10)}%`,
                      backgroundColor: healthColor,
                    },
                  ]}
                />
              </View>
            </View>
          </View>

          {entry.aiSummary ? (
            <Text style={styles.aiSummaryNote}>{entry.aiSummary}</Text>
          ) : null}

          {/* Ingredients */}
          <View style={styles.ingHeaderRow}>
            <Text style={styles.ingHeaderTitle}>Ingredients</Text>
            <Text style={styles.ingCountText}>
              {`${entry.items.length} detected`}
            </Text>
          </View>

          <View style={styles.ingWrap}>
            {entry.items.map((item) => {
              const metricTag = item.grams
                ? `${Math.round(item.grams * servings)} g`
                : item.portion || '';
              return (
                <View key={item.id} style={styles.ingChip}>
                  <Text style={styles.ingChipName}>
                    {item.name}
                    {metricTag ? ` (${metricTag})` : ''}
                  </Text>
                  <Text style={styles.ingChipKcal}>
                    {`${Math.round(item.calories * servings)} kcal`}
                  </Text>
                </View>
              );
            })}

            <Pressable
              onPress={() => setShowAddIng((v) => !v)}
              style={[styles.ingChip, styles.ingChipAdd]}
            >
              <Text style={styles.ingAddText}>+ Add</Text>
            </Pressable>
          </View>

          {showAddIng ? (
            <View style={[styles.inlineBox, cardShadow]}>
              <TextInput
                value={newIngName}
                onChangeText={setNewIngName}
                placeholder="Ingredient (e.g. Olive oil 15 mL)"
                placeholderTextColor={plateColors.faint}
                style={[styles.sheetInput, { flex: 1 }]}
              />
              <TextInput
                value={newIngGrams}
                onChangeText={setNewIngGrams}
                placeholder="g"
                placeholderTextColor={plateColors.faint}
                keyboardType="numeric"
                style={[styles.sheetInput, { width: 58 }]}
              />
              <TextInput
                value={newIngKcal}
                onChangeText={setNewIngKcal}
                placeholder="kcal"
                placeholderTextColor={plateColors.faint}
                keyboardType="numeric"
                style={[styles.sheetInput, { width: 66 }]}
              />
              <Pressable onPress={handleAddIngredient} style={styles.smallDarkBtn}>
                <Text style={styles.smallDarkBtnText}>Add</Text>
              </Pressable>
            </View>
          ) : null}

          {showFixBox ? (
            <View style={[styles.fixBox, cardShadow]}>
              <Text style={styles.fixBoxTitle}>
                Refine with AI (describe g, mL, or changes)
              </Text>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <TextInput
                  value={fixPrompt}
                  onChangeText={setFixPrompt}
                  placeholder='e.g. "no fries, 200 g beef patty, 15 mL sauce"'
                  placeholderTextColor={plateColors.faint}
                  style={[styles.sheetInput, { flex: 1 }]}
                />
                <Pressable
                  onPress={handleRunFix}
                  disabled={refining}
                  style={styles.smallDarkBtn}
                >
                  {refining ? (
                    <ActivityIndicator size="small" color="#FFFFFF" />
                  ) : (
                    <Text style={styles.smallDarkBtnText}>Apply</Text>
                  )}
                </Pressable>
              </View>
            </View>
          ) : null}
        </View>
      </ScrollView>

      {/* Sticky Bottom Actions */}
      <LinearGradient
        colors={['rgba(245,245,247,0)', '#F5F5F7', '#F5F5F7']}
        locations={[0, 0.35, 1]}
        style={styles.detailFooter}
      >
        <Pressable
          onPress={() => setShowFixBox((v) => !v)}
          style={styles.btnLine}
        >
          <PlateIcon name="sparkle" size={18} color={plateColors.ink} />
          <Text style={styles.btnLineText}>Fix results</Text>
        </Pressable>

        <Pressable onPress={onClose} style={styles.btnDark}>
          <Text style={styles.btnDarkText}>Done</Text>
        </Pressable>
      </LinearGradient>

      {keyboard.visible ? (
        <Pressable
          onPress={() => Keyboard.dismiss()}
          style={[styles.floatingKeyboardDone, { top: isDesktopStage ? 56 : 14 }]}
        >
          <PlateIcon name="check" size={14} color="#FFFFFF" />
          <Text style={styles.keyboardDonePillText}>Hide keyboard</Text>
        </Pressable>
      ) : null}
    </KeyboardAvoidingView>
  );
}

export function PlateOverlays({
  activeSheet,
  selectedExercise,
  onChangeSheet,
}: PlateOverlaysProps) {
  const isDesktopStage = useIsDesktopStage();
  const insets = useSafeAreaInsets();
  const keyboard = useKeyboardState();
  const {
    activeTab,
    setActiveTab,
    scannerOpen,
    setScannerOpen,
    detailEntryId,
    setDetailEntryId,
    meals,
    removeMealEntry,
    toastMessage,
    toastTone,
    showToast,
    lastAIError,
    clearLastAIError,
    openAILogsInSettings,
    selectedDateKey,
  } = useCalorieTracker();

  const [quickOpen, setQuickOpen] = useState(false);
  const profileBackdropSaveRef = useRef<(() => Promise<void>) | null>(null);

  const detailEntry = detailEntryId
    ? meals.find((m) => m.id === detailEntryId) ?? null
    : null;

  const hideFab =
    Boolean(activeSheet) || Boolean(detailEntry) || Boolean(scannerOpen);

  return (
    <>
      {/* Bottom Frosted Tab Bar */}
      <View style={styles.tabBar}>
        {TAB_ITEMS.map((tab) => {
          const isActive = activeTab === tab.id;
          return (
            <Pressable
              key={tab.id}
              onPress={() => {
                setQuickOpen(false);
                setActiveTab(tab.id);
              }}
              style={styles.tabItem}
            >
              <PlateIcon
                name={tab.icon}
                size={24}
                color={isActive ? plateColors.ink : '#B4B4BA'}
              />
              <Text
                style={[styles.tabLabel, isActive ? styles.tabLabelActive : null]}
              >
                {tab.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {/* Backdrop for Quick Actions or Bottom Sheet */}
      {quickOpen || activeSheet ? (
        <Pressable
          onPress={async () => {
            Keyboard.dismiss();
            setQuickOpen(false);
            if (activeSheet === 'profile' && profileBackdropSaveRef.current) {
              await profileBackdropSaveRef.current();
            } else {
              onChangeSheet(null);
            }
          }}
          style={[
            styles.backdrop,
            activeSheet ? styles.backdropDark : styles.backdropLight,
          ]}
        />
      ) : null}

      {/* 2×2 Quick Actions Grid */}
      {quickOpen ? (
        <View style={styles.quickGrid}>
          <Pressable
            onPress={() => {
              setQuickOpen(false);
              setScannerOpen(true);
            }}
            style={[styles.qaCard, styles.qaCardPrimary, cardShadow]}
          >
            <PlateIcon name="scan" size={26} color="#FFFFFF" />
            <View>
              <Text style={[styles.qaTitle, { color: '#FFFFFF' }]}>
                Scan food
              </Text>
              <Text style={styles.qaSubPrimary}>
                Snap a photo, AI does the rest
              </Text>
            </View>
          </Pressable>

          <Pressable
            onPress={() => {
              setQuickOpen(false);
              onChangeSheet('exercise');
            }}
            style={[styles.qaCard, cardShadow]}
          >
            <PlateIcon name="dumbbell" size={26} color={plateColors.ink} />
            <View>
              <Text style={styles.qaTitle}>Log exercise</Text>
              <Text style={styles.qaSub}>Run, lift, walk</Text>
            </View>
          </Pressable>

          <Pressable
            onPress={() => {
              setQuickOpen(false);
              onChangeSheet('saved');
            }}
            style={[styles.qaCard, cardShadow]}
          >
            <PlateIcon name="bookmark" size={26} color={plateColors.ink} />
            <View>
              <Text style={styles.qaTitle}>Saved foods</Text>
              <Text style={styles.qaSub}>Your go-to meals</Text>
            </View>
          </Pressable>

          <Pressable
            onPress={() => {
              setQuickOpen(false);
              onChangeSheet('db');
            }}
            style={[styles.qaCard, cardShadow]}
          >
            <PlateIcon name="search" size={26} color={plateColors.ink} />
            <View>
              <Text style={styles.qaTitle}>Food database</Text>
              <Text style={styles.qaSub}>Search & add</Text>
            </View>
          </Pressable>
        </View>
      ) : null}

      {/* Floating + Action Button */}
      {!hideFab ? (
        <Pressable
          onPress={() => setQuickOpen((v) => !v)}
          style={({ pressed }) => [
            styles.fab,
            pressed ? { transform: [{ scale: 0.93 }] } : null,
          ]}
        >
          <View
            style={
              quickOpen ? { transform: [{ rotate: '45deg' }] } : undefined
            }
          >
            <PlateIcon name="plus" size={28} color="#FFFFFF" />
          </View>
        </Pressable>
      ) : null}

      {/* Bottom Sheet */}
      {activeSheet ? (
        <KeyboardAvoidingView
          behavior="padding"
          keyboardVerticalOffset={insets.top}
          pointerEvents="box-none"
          style={styles.sheetHost}
        >
          <View
            style={[
              styles.bottomSheet,
              keyboard.visible ? styles.bottomSheetKeyboardOpen : null,
            ]}
          >
            <View style={styles.grabberRow}>
              <View style={styles.grabberSpacer} />
              <View style={styles.grabber} />
              <View style={styles.grabberRight}>
                {keyboard.visible && activeSheet !== 'profile' ? (
                  <Pressable
                    onPress={() => Keyboard.dismiss()}
                    style={styles.keyboardDonePill}
                  >
                    <PlateIcon name="check" size={13} color="#FFFFFF" />
                    <Text style={styles.keyboardDonePillText}>Done</Text>
                  </Pressable>
                ) : null}
              </View>
            </View>

            {activeSheet === 'saved' ? (
              <LibrarySheetBody
                key="saved"
                savedOnly
                onClose={() => onChangeSheet(null)}
              />
            ) : null}
            {activeSheet === 'db' ? (
              <LibrarySheetBody
                key="db"
                savedOnly={false}
                onClose={() => onChangeSheet(null)}
              />
            ) : null}
            {activeSheet !== 'saved' && activeSheet !== 'db' ? (
              <ScrollView
                style={styles.sheetScroll}
                contentContainerStyle={styles.sheetScrollContent}
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}
              >
                {activeSheet === 'exercise' ? (
                  <ExerciseSheetBody onClose={() => onChangeSheet(null)} />
                ) : null}
                {activeSheet === 'weight' ? (
                  <WeightSheetBody
                    key="weight"
                    onClose={() => onChangeSheet(null)}
                  />
                ) : null}
                {activeSheet === 'steps' ? (
                  <StepsSheetBody
                    key={selectedDateKey}
                    onClose={() => onChangeSheet(null)}
                  />
                ) : null}
                {activeSheet === 'profile' ? (
                  <ProfileSheetBody
                    key="profile"
                    keyboardVisible={keyboard.visible}
                    registerBackdropSave={(fn) => {
                      profileBackdropSaveRef.current = fn;
                    }}
                    onClose={() => onChangeSheet(null)}
                  />
                ) : null}
                {activeSheet === 'exerciseDetail' && selectedExercise ? (
                  <View style={{ gap: 12 }}>
                    <Text style={styles.sheetTitle}>
                      {selectedExercise.title}
                    </Text>
                    <Text style={styles.sheetSub}>
                      {`${selectedExercise.calories} kcal burned · ${
                        selectedExercise.exerciseMinutes ?? 30
                      } min · ${selectedExercise.exerciseIntensity ?? 'Medium'} intensity`}
                    </Text>
                    <Pressable
                      onPress={async () => {
                        await removeMealEntry(selectedExercise.id);
                        onChangeSheet(null);
                        showToast('Workout removed');
                      }}
                      style={[
                        styles.sheetPrimaryBtn,
                        { backgroundColor: plateColors.danger },
                      ]}
                    >
                      <Text style={styles.sheetPrimaryBtnText}>
                        Remove workout
                      </Text>
                    </Pressable>
                  </View>
                ) : null}
              </ScrollView>
            ) : null}
          </View>
        </KeyboardAvoidingView>
      ) : null}

      {/* Full-Screen Nutrition Detail */}
      {detailEntry ? (
        <NutritionDetailContent
          key={detailEntry.id}
          entry={detailEntry}
          onClose={() => setDetailEntryId(null)}
        />
      ) : null}

      {/* Full-Screen Scanner */}
      {scannerOpen ? (
        <ScannerOverlayContent onClose={() => setScannerOpen(false)} />
      ) : null}

      {/* Top Toast Notification */}
      {toastMessage ? (
        <View
          pointerEvents="none"
          style={[
            styles.toastWrap,
            { top: isDesktopStage ? 58 : 14 },
          ]}
        >
          <View
            style={[
              styles.toastPill,
              toastTone === 'error' ? styles.toastPillError : null,
            ]}
          >
            <PlateIcon
              name={toastTone === 'error' ? 'x' : 'check'}
              size={16}
              color={toastTone === 'error' ? '#FF6B6B' : plateColors.ok}
            />
            <Text style={styles.toastText} numberOfLines={2}>
              {toastMessage}
            </Text>
          </View>
        </View>
      ) : null}

      {/* Full AI Error Diagnostic Modal */}
      <Modal
        visible={Boolean(lastAIError)}
        transparent
        animationType="fade"
        onRequestClose={clearLastAIError}
      >
        <View style={styles.aiErrorBackdrop}>
          <View style={[styles.aiErrorCard, cardShadow]}>
            <View style={styles.aiErrorHeaderRow}>
              <View style={styles.aiErrorIconBadge}>
                <PlateIcon name="x" size={18} color="#FFFFFF" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.aiErrorTitle}>
                  {lastAIError?.title || 'AI Request Failed'}
                </Text>
                <Text style={styles.aiErrorMeta}>
                  {lastAIError
                    ? `${colors.providers[lastAIError.provider].label} · ${new Date(
                        lastAIError.timestamp
                      ).toLocaleTimeString()}`
                    : ''}
                </Text>
              </View>
            </View>

            <ScrollView
              style={styles.aiErrorBodyScroll}
              showsVerticalScrollIndicator
            >
              <Text selectable style={styles.aiErrorBodyText}>
                {lastAIError?.message || ''}
              </Text>
            </ScrollView>

            <View style={styles.aiErrorBtnRow}>
              <Pressable
                onPress={async () => {
                  if (!lastAIError) return;
                  await Clipboard.setStringAsync(
                    `[${lastAIError.timestamp}] ${lastAIError.title} (${lastAIError.provider})\n${lastAIError.message}`
                  );
                  showToast('Error copied to clipboard');
                }}
                style={styles.aiErrorSecondaryBtn}
              >
                <Text style={styles.aiErrorSecondaryBtnText}>Copy Error</Text>
              </Pressable>

              <Pressable
                onPress={() => {
                  onChangeSheet(null);
                  openAILogsInSettings();
                }}
                style={styles.aiErrorSecondaryBtn}
              >
                <Text style={styles.aiErrorSecondaryBtnText}>
                  AI Settings & Logs
                </Text>
              </Pressable>
            </View>

            <Pressable
              onPress={clearLastAIError}
              style={styles.sheetPrimaryBtn}
            >
              <Text style={styles.sheetPrimaryBtnText}>Dismiss</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  tabBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 88,
    paddingTop: 10,
    paddingLeft: 18,
    paddingRight: 108,
    paddingBottom: 22,
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'flex-start',
    backgroundColor: 'rgba(255,255,255,0.9)',
    borderTopWidth: 1,
    borderTopColor: 'rgba(0,0,0,0.05)',
    zIndex: 15,
  },
  tabItem: {
    width: 64,
    alignItems: 'center',
    gap: 4,
  },
  tabLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: '#B4B4BA',
  },
  tabLabelActive: {
    color: plateColors.ink,
  },
  fab: {
    position: 'absolute',
    right: 22,
    bottom: 24,
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: plateColors.ink,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.35,
    shadowRadius: 18,
    elevation: 8,
    zIndex: 42,
  },
  backdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 35,
  },
  backdropLight: {
    backgroundColor: 'rgba(245,245,247,0.82)',
  },
  backdropDark: {
    backgroundColor: 'rgba(0,0,0,0.38)',
  },
  quickGrid: {
    position: 'absolute',
    left: 20,
    right: 20,
    bottom: 104,
    zIndex: 40,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  qaCard: {
    width: '48%',
    flexGrow: 1,
    height: 116,
    borderRadius: 24,
    backgroundColor: plateColors.card,
    padding: 17,
    justifyContent: 'space-between',
  },
  qaCardPrimary: {
    backgroundColor: plateColors.ink,
  },
  qaTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: plateColors.ink,
    letterSpacing: -0.2,
  },
  qaSub: {
    fontSize: 12,
    fontWeight: '500',
    color: plateColors.muted,
    marginTop: 2,
  },
  qaSubPrimary: {
    fontSize: 12,
    fontWeight: '500',
    color: 'rgba(255,255,255,0.65)',
    marginTop: 2,
  },
  sheetHost: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'flex-end',
    zIndex: 50,
  },
  bottomSheet: {
    width: '100%',
    maxHeight: '90%',
    backgroundColor: plateColors.card,
    borderTopLeftRadius: 34,
    borderTopRightRadius: 34,
    paddingTop: 10,
    paddingHorizontal: 20,
    paddingBottom: 30,
  },
  bottomSheetKeyboardOpen: {
    maxHeight: '96%',
    paddingBottom: 14,
  },
  grabberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
    minHeight: 24,
  },
  grabberSpacer: {
    width: 72,
  },
  grabberRight: {
    width: 72,
    alignItems: 'flex-end',
  },
  grabber: {
    width: 40,
    height: 5,
    borderRadius: 5,
    backgroundColor: '#DCDCE0',
  },
  sheetScroll: {
    flexGrow: 0,
  },
  sheetScrollContent: {
    paddingBottom: 4,
  },
  sheetHeaderRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 10,
  },
  keyboardDonePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: plateColors.ink,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 99,
  },
  keyboardDonePillText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
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
    zIndex: 75,
  },
  sheetTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: plateColors.ink,
    letterSpacing: -0.6,
    marginBottom: 4,
  },
  sheetSub: {
    fontSize: 14,
    color: plateColors.muted,
    marginBottom: 16,
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    height: 46,
    borderRadius: 16,
    backgroundColor: plateColors.chip,
    paddingHorizontal: 14,
    marginBottom: 12,
  },
  searchInput: {
    flex: 1,
    fontSize: 15,
    color: plateColors.ink,
  },
  libRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: plateColors.line,
  },
  libThumbWrap: {
    width: 52,
    height: 52,
    borderRadius: 14,
    overflow: 'hidden',
    backgroundColor: plateColors.chip,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptySheetBox: {
    paddingVertical: 28,
    paddingHorizontal: 16,
    alignItems: 'center',
  },
  emptySheetText: {
    fontSize: 14,
    color: plateColors.muted,
    textAlign: 'center',
    lineHeight: 20,
  },
  libThumb: {
    width: '100%',
    height: '100%',
  },
  libFoodName: {
    fontSize: 15,
    fontWeight: '600',
    color: plateColors.ink,
  },
  libFoodMeta: {
    fontSize: 13,
    color: plateColors.muted,
    marginTop: 2,
  },
  roundDarkBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: plateColors.ink,
    alignItems: 'center',
    justifyContent: 'center',
  },
  roundLightBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: plateColors.chip,
    alignItems: 'center',
    justifyContent: 'center',
  },
  exOptionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    padding: 16,
    borderRadius: 20,
    backgroundColor: plateColors.chip,
    marginBottom: 10,
  },
  exOptionIcon: {
    width: 36,
    height: 36,
    borderRadius: 12,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  exOptionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: plateColors.ink,
  },
  exOptionDesc: {
    fontSize: 13,
    color: plateColors.muted,
    marginTop: 1,
  },
  exOptionKcal: {
    fontSize: 15,
    fontWeight: '700',
    color: plateColors.ink,
    fontVariant: ['tabular-nums'],
  },
  bigStepperCenter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 22,
    marginVertical: 18,
  },
  weightInputInlineWrap: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 4,
  },
  weightStepperInput: {
    minWidth: 112,
    textAlign: 'center',
    fontSize: 48,
    fontWeight: '700',
    color: plateColors.ink,
    letterSpacing: -1.6,
    fontVariant: ['tabular-nums'],
    paddingVertical: 2,
    paddingHorizontal: 6,
    borderRadius: 16,
    backgroundColor: plateColors.chip,
  },
  weightStepperNum: {
    fontSize: 52,
    fontWeight: '700',
    color: plateColors.ink,
    letterSpacing: -1.8,
    fontVariant: ['tabular-nums'],
  },
  weightStepperUnit: {
    fontSize: 20,
    fontWeight: '600',
    color: plateColors.muted,
  },
  presetChipsRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
    marginBottom: 18,
  },
  presetPill: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 99,
    backgroundColor: plateColors.chip,
  },
  presetPillActive: {
    backgroundColor: plateColors.ink,
  },
  presetPillText: {
    fontSize: 13,
    fontWeight: '600',
    color: plateColors.ink2,
    fontVariant: ['tabular-nums'],
  },
  sheetPrimaryBtn: {
    height: 52,
    borderRadius: 99,
    backgroundColor: plateColors.ink,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 18,
  },
  sheetPrimaryBtnText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
  profileActionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 4,
  },
  sheetCancelBtn: {
    flex: 1,
    height: 52,
    borderRadius: 99,
    backgroundColor: plateColors.chip,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  sheetCancelBtnText: {
    color: plateColors.ink2,
    fontSize: 15.5,
    fontWeight: '600',
  },
  profileLiveSummaryBox: {
    flex: 1,
    height: 44,
    borderRadius: 14,
    backgroundColor: plateColors.bg,
    borderWidth: 1,
    borderColor: plateColors.line,
    paddingHorizontal: 12,
    justifyContent: 'center',
  },
  profileLiveSummaryTop: {
    fontSize: 13,
    fontWeight: '700',
    color: plateColors.ink,
    fontVariant: ['tabular-nums'],
  },
  profileLiveSummarySub: {
    fontSize: 11.5,
    fontWeight: '500',
    color: plateColors.muted,
  },
  fieldLabel: {
    fontSize: 12.5,
    fontWeight: '600',
    color: plateColors.muted,
    marginBottom: 5,
  },
  sheetInput: {
    height: 44,
    borderRadius: 14,
    backgroundColor: plateColors.chip,
    paddingHorizontal: 13,
    fontSize: 14.5,
    color: plateColors.ink,
  },
  scannerRoot: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: '#000000',
    zIndex: 60,
    justifyContent: 'space-between',
  },
  scannerBgImage: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    width: '100%',
    height: '100%',
  },
  scannerTopBar: {
    position: 'absolute',
    left: 18,
    right: 18,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    zIndex: 4,
  },
  scannerTitleCenter: {
    alignItems: 'center',
  },
  scannerTitleText: {
    color: '#FFFFFF',
    fontSize: 17,
    fontWeight: '600',
  },
  scannerSubBadge: {
    color: 'rgba(255,255,255,0.75)',
    fontSize: 11.5,
    fontWeight: '500',
  },
  glassCircleBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.24)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  scannerCenterArea: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 58,
    paddingHorizontal: 22,
    gap: 12,
  },
  scanFrameBox: {
    width: 248,
    height: 228,
    position: 'relative',
  },
  permissionCard: {
    width: '100%',
    maxWidth: 300,
    backgroundColor: 'rgba(24,24,28,0.88)',
    borderRadius: 24,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.16)',
    paddingVertical: 24,
    paddingHorizontal: 20,
    alignItems: 'center',
    gap: 10,
  },
  permissionTitle: {
    color: '#FFFFFF',
    fontSize: 17,
    fontWeight: '700',
    textAlign: 'center',
  },
  permissionSub: {
    color: 'rgba(255,255,255,0.72)',
    fontSize: 13.5,
    textAlign: 'center',
    lineHeight: 19,
  },
  permissionBtn: {
    marginTop: 6,
    paddingHorizontal: 20,
    height: 44,
    borderRadius: 99,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  permissionBtnText: {
    color: plateColors.ink,
    fontSize: 14,
    fontWeight: '700',
  },
  cornerBracket: {
    position: 'absolute',
    width: 44,
    height: 44,
    borderColor: '#FFFFFF',
  },
  cornerTL: {
    top: 0,
    left: 0,
    borderTopWidth: 4,
    borderLeftWidth: 4,
    borderTopLeftRadius: 24,
  },
  cornerTR: {
    top: 0,
    right: 0,
    borderTopWidth: 4,
    borderRightWidth: 4,
    borderTopRightRadius: 24,
  },
  cornerBL: {
    bottom: 0,
    left: 0,
    borderBottomWidth: 4,
    borderLeftWidth: 4,
    borderBottomLeftRadius: 24,
  },
  cornerBR: {
    bottom: 0,
    right: 0,
    borderBottomWidth: 4,
    borderRightWidth: 4,
    borderBottomRightRadius: 24,
  },
  scanLine: {
    position: 'absolute',
    left: 14,
    right: 14,
    height: 2.5,
    borderRadius: 2,
    backgroundColor: '#FFFFFF',
  },
  scannerHintRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  scannerHintText: {
    color: 'rgba(255,255,255,0.88)',
    fontSize: 13,
    fontWeight: '500',
  },
  liveCamChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 99,
    backgroundColor: 'rgba(255,255,255,0.22)',
  },
  liveCamChipText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '600',
  },
  notesGlassWrap: {
    width: '100%',
    height: 42,
    borderRadius: 14,
    backgroundColor: 'rgba(0,0,0,0.46)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    gap: 8,
  },
  notesGlassInput: {
    flex: 1,
    color: '#FFFFFF',
    fontSize: 13,
  },
  notesActionPill: {
    paddingHorizontal: 11,
    paddingVertical: 6,
    borderRadius: 99,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 64,
  },
  notesActionPillText: {
    color: plateColors.ink,
    fontSize: 12,
    fontWeight: '700',
  },
  barcodeResultCard: {
    width: '100%',
    maxWidth: 340,
    backgroundColor: plateColors.card,
    borderRadius: 24,
    padding: 16,
    gap: 12,
  },
  barcodeResultTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  barcodeBadgePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: plateColors.chip,
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 8,
  },
  barcodeBadgeText: {
    fontSize: 11.5,
    fontWeight: '600',
    color: plateColors.ink2,
    fontVariant: ['tabular-nums'],
  },
  barcodePortionPill: {
    fontSize: 12,
    fontWeight: '600',
    color: plateColors.muted,
  },
  barcodeTitleText: {
    fontSize: 18,
    fontWeight: '700',
    color: plateColors.ink,
    letterSpacing: -0.4,
  },
  barcodeMetricsRow: {
    flexDirection: 'row',
    gap: 8,
  },
  barcodeMetricBox: {
    flex: 1,
    backgroundColor: plateColors.bg,
    borderRadius: 14,
    paddingVertical: 9,
    paddingHorizontal: 6,
    alignItems: 'center',
  },
  barcodeMetricVal: {
    fontSize: 15,
    fontWeight: '700',
    color: plateColors.ink,
    fontVariant: ['tabular-nums'],
  },
  barcodeMetricLbl: {
    fontSize: 11,
    fontWeight: '500',
    color: plateColors.muted,
    marginTop: 2,
  },
  barcodeActionsRow: {
    flexDirection: 'row',
    gap: 8,
  },
  barcodeResetBtn: {
    flex: 1,
    height: 42,
    borderRadius: 99,
    backgroundColor: plateColors.chip,
    alignItems: 'center',
    justifyContent: 'center',
  },
  barcodeResetBtnText: {
    fontSize: 13.5,
    fontWeight: '600',
    color: plateColors.ink,
  },
  barcodeLogBtn: {
    flex: 1.35,
    height: 42,
    borderRadius: 99,
    backgroundColor: plateColors.ink,
    alignItems: 'center',
    justifyContent: 'center',
  },
  barcodeLogBtnText: {
    fontSize: 13.5,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  scannerBottomArea: {
    paddingBottom: 32,
    gap: 18,
  },
  modesRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: 14,
  },
  modeBtn: {
    width: 76,
    paddingVertical: 9,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.18)',
    alignItems: 'center',
    gap: 5,
  },
  modeBtnOn: {
    backgroundColor: '#FFFFFF',
  },
  modeBtnText: {
    fontSize: 11.5,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  modeBtnTextOn: {
    color: plateColors.ink,
  },
  shutterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 44,
  },
  shutterOuter: {
    width: 78,
    height: 78,
    borderRadius: 39,
    borderWidth: 4,
    borderColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  shutterInner: {
    width: 62,
    height: 62,
    borderRadius: 31,
    backgroundColor: '#FFFFFF',
  },
  flashOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: '#FFFFFF',
    zIndex: 70,
  },
  detailRoot: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: plateColors.bg,
    zIndex: 55,
  },
  detailHero: {
    height: 300,
    backgroundColor: '#18181C',
    position: 'relative',
  },
  detailHeroImg: {
    width: '100%',
    height: '100%',
  },
  detailHeroFallback: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  detailTopBar: {
    position: 'absolute',
    left: 18,
    right: 18,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  detailNavTitle: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
  detailBody: {
    marginTop: -28,
    backgroundColor: plateColors.bg,
    borderTopLeftRadius: 30,
    borderTopRightRadius: 30,
    paddingHorizontal: 20,
    paddingTop: 22,
    gap: 12,
  },
  detailMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  detailTimePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: plateColors.chip,
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 8,
  },
  detailTimeText: {
    fontSize: 12,
    fontWeight: '500',
    color: plateColors.ink2,
  },
  aiConfidenceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  aiConfidenceText: {
    fontSize: 12.5,
    color: plateColors.muted,
  },
  detailTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  detailTitleText: {
    flex: 1,
    fontSize: 25,
    fontWeight: '700',
    color: plateColors.ink,
    letterSpacing: -0.8,
  },
  servingsStepper: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    backgroundColor: '#FFFFFF',
    borderWidth: 1.5,
    borderColor: plateColors.line,
    borderRadius: 99,
    padding: 4,
  },
  stepperCircle: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  servingsVal: {
    minWidth: 28,
    textAlign: 'center',
    fontSize: 15,
    fontWeight: '700',
    color: plateColors.ink,
    fontVariant: ['tabular-nums'],
  },
  detailKcalCard: {
    backgroundColor: plateColors.card,
    borderRadius: 26,
    padding: 18,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  detailKcalBadge: {
    width: 48,
    height: 48,
    borderRadius: 16,
    backgroundColor: plateColors.chip,
    alignItems: 'center',
    justifyContent: 'center',
  },
  detailCardSmallLabel: {
    fontSize: 13,
    fontWeight: '500',
    color: plateColors.muted,
    marginBottom: 2,
  },
  detailKcalBig: {
    fontSize: 34,
    fontWeight: '700',
    color: plateColors.ink,
    lineHeight: 36,
    fontVariant: ['tabular-nums'],
  },
  detailMacrosRow: {
    flexDirection: 'row',
    gap: 10,
  },
  detailMacroCard: {
    flex: 1,
    backgroundColor: plateColors.card,
    borderRadius: 22,
    padding: 13,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  detailMacroLabel: {
    fontSize: 12,
    fontWeight: '500',
    color: plateColors.muted,
  },
  detailMacroVal: {
    fontSize: 17,
    fontWeight: '700',
    color: plateColors.ink,
    fontVariant: ['tabular-nums'],
  },
  healthCard: {
    backgroundColor: plateColors.card,
    borderRadius: 24,
    paddingHorizontal: 18,
    paddingVertical: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  healthBadge: {
    width: 36,
    height: 36,
    borderRadius: 12,
    backgroundColor: '#FFEDEE',
    alignItems: 'center',
    justifyContent: 'center',
  },
  healthTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  healthTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: plateColors.ink,
  },
  healthScoreText: {
    fontSize: 15,
    fontWeight: '700',
    color: plateColors.ink,
    fontVariant: ['tabular-nums'],
  },
  healthTrack: {
    height: 8,
    borderRadius: 8,
    backgroundColor: plateColors.chip,
    overflow: 'hidden',
  },
  healthFill: {
    height: '100%',
    borderRadius: 8,
  },
  aiSummaryNote: {
    fontSize: 13,
    color: plateColors.muted,
    lineHeight: 18,
  },
  ingHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    marginTop: 4,
  },
  ingHeaderTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: plateColors.ink,
  },
  ingCountText: {
    fontSize: 13,
    color: plateColors.muted,
  },
  ingWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  ingChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: plateColors.line,
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  ingChipName: {
    fontSize: 13.5,
    fontWeight: '500',
    color: plateColors.ink,
  },
  ingChipKcal: {
    fontSize: 13,
    color: plateColors.muted,
    fontVariant: ['tabular-nums'],
  },
  ingChipAdd: {
    borderStyle: 'dashed',
  },
  ingAddText: {
    fontSize: 13.5,
    fontWeight: '500',
    color: plateColors.muted,
  },
  inlineBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#FFFFFF',
    padding: 10,
    borderRadius: 18,
  },
  fixBox: {
    backgroundColor: '#FFFFFF',
    padding: 12,
    borderRadius: 20,
    gap: 8,
  },
  fixBoxTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: plateColors.ink2,
  },
  smallDarkBtn: {
    height: 44,
    paddingHorizontal: 14,
    borderRadius: 14,
    backgroundColor: plateColors.ink,
    alignItems: 'center',
    justifyContent: 'center',
  },
  smallDarkBtnText: {
    color: '#FFFFFF',
    fontSize: 13.5,
    fontWeight: '600',
  },
  detailFooter: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 26,
  },
  btnLine: {
    flex: 1,
    height: 54,
    borderRadius: 99,
    backgroundColor: '#FFFFFF',
    borderWidth: 1.5,
    borderColor: plateColors.line,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  btnLineText: {
    fontSize: 16,
    fontWeight: '600',
    color: plateColors.ink,
  },
  btnDark: {
    flex: 1,
    height: 54,
    borderRadius: 99,
    backgroundColor: plateColors.ink,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnDarkText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  toastWrap: {
    position: 'absolute',
    left: 20,
    right: 20,
    alignItems: 'center',
    zIndex: 85,
  },
  toastPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: plateColors.ink,
    paddingHorizontal: 18,
    paddingVertical: 11,
    borderRadius: 99,
    maxWidth: '94%',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.35,
    shadowRadius: 16,
    elevation: 8,
  },
  toastPillError: {
    backgroundColor: '#2B1216',
    borderWidth: 1,
    borderColor: 'rgba(255,107,107,0.45)',
    borderRadius: 22,
  },
  toastText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '600',
    flexShrink: 1,
  },
  aiErrorBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.54)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 22,
  },
  aiErrorCard: {
    width: '100%',
    maxWidth: 380,
    backgroundColor: plateColors.card,
    borderRadius: 28,
    padding: 20,
    gap: 12,
  },
  aiErrorHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  aiErrorIconBadge: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: plateColors.danger,
    alignItems: 'center',
    justifyContent: 'center',
  },
  aiErrorTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: plateColors.ink,
    letterSpacing: -0.3,
  },
  aiErrorMeta: {
    fontSize: 12.5,
    color: plateColors.muted,
    marginTop: 2,
  },
  aiErrorBodyScroll: {
    maxHeight: 240,
    backgroundColor: '#16161A',
    borderRadius: 16,
    paddingHorizontal: 13,
    paddingVertical: 11,
  },
  aiErrorBodyText: {
    color: '#F4F4F6',
    fontSize: 12.5,
    lineHeight: 18,
    fontFamily: Platform.select({
      ios: 'Menlo',
      android: 'monospace',
      default: 'monospace',
    }),
  },
  aiErrorBtnRow: {
    flexDirection: 'row',
    gap: 8,
  },
  aiErrorSecondaryBtn: {
    flex: 1,
    height: 42,
    borderRadius: 14,
    backgroundColor: plateColors.chip,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 10,
  },
  aiErrorSecondaryBtnText: {
    fontSize: 13,
    fontWeight: '600',
    color: plateColors.ink,
  },
});
