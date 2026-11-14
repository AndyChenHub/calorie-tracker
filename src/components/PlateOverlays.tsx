import { CameraType, CameraView, useCameraPermissions } from 'expo-camera';
import { LinearGradient } from 'expo-linear-gradient';
import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Image,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
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
import { useIsDesktopStage } from './PhoneStageFrame';
import { PlateIcon, PlateIconName } from './PlatePrimitives';

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
  const [weightVal, setWeightVal] = useState<number>(profile.weightKg);

  return (
    <View>
      <Text style={styles.sheetTitle}>Log weight</Text>
      <Text style={styles.sheetSub}>Small steps, big change</Text>

      <View style={styles.bigStepperCenter}>
        <Pressable
          onPress={() =>
            setWeightVal((v) => Math.max(30, Math.round((v - 0.1) * 10) / 10))
          }
          style={({ pressed }) => [
            styles.roundLightBtn,
            pressed ? { transform: [{ scale: 0.9 }] } : null,
          ]}
        >
          <PlateIcon name="minus" size={18} color={plateColors.ink} />
        </Pressable>

        <Text style={styles.weightStepperNum}>
          {weightVal.toFixed(1)}
          <Text style={styles.weightStepperUnit}> kg</Text>
        </Text>

        <Pressable
          onPress={() =>
            setWeightVal((v) => Math.min(250, Math.round((v + 0.1) * 10) / 10))
          }
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
          const todayKey = toLocalDateKey();
          await updateProfile({
            weightKg: weightVal,
            weightHistory: upsertWeightLogPoint(
              profile.weightHistory,
              todayKey,
              weightVal
            ),
          });
          onClose();
          showToast(`Weight logged · ${weightVal.toFixed(1)} kg`);
        }}
        style={styles.sheetPrimaryBtn}
      >
        <Text style={styles.sheetPrimaryBtnText}>Save</Text>
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

function ProfileSheetBody({ onClose }: { onClose: () => void }) {
  const { profile, updateProfile, showToast } = useCalorieTracker();
  const [name, setName] = useState(profile.name);
  const [heightStr, setHeightStr] = useState(String(profile.heightCm));
  const [startWStr, setStartWStr] = useState(String(profile.startWeightKg));
  const [goalWStr, setGoalWStr] = useState(String(profile.goalWeightKg));

  return (
    <View style={{ gap: 10 }}>
      <Text style={styles.sheetTitle}>Edit profile</Text>
      <Text style={styles.sheetSub}>Used for BMI and weight goal charts</Text>

      <View style={{ flexDirection: 'row', gap: 10 }}>
        <View style={{ flex: 1.4 }}>
          <Text style={styles.fieldLabel}>Name</Text>
          <TextInput
            value={name}
            onChangeText={setName}
            style={styles.sheetInput}
            placeholder="Your name"
            placeholderTextColor={plateColors.faint}
          />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.fieldLabel}>
            {`Height (cm · ${(
              Math.max(120, Math.min(240, Number(heightStr) || 175)) / 100
            ).toFixed(2)} m)`}
          </Text>
          <TextInput
            value={heightStr}
            onChangeText={setHeightStr}
            keyboardType="numeric"
            style={styles.sheetInput}
          />
        </View>
      </View>

      <View style={{ flexDirection: 'row', gap: 10 }}>
        <View style={{ flex: 1 }}>
          <Text style={styles.fieldLabel}>Starting weight (kg)</Text>
          <TextInput
            value={startWStr}
            onChangeText={setStartWStr}
            keyboardType="decimal-pad"
            style={styles.sheetInput}
          />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.fieldLabel}>Goal weight (kg)</Text>
          <TextInput
            value={goalWStr}
            onChangeText={setGoalWStr}
            keyboardType="decimal-pad"
            style={styles.sheetInput}
          />
        </View>
      </View>

      <Pressable
        onPress={async () => {
          const parsedStart = Math.max(
            30,
            Math.min(
              300,
              Math.round((Number(startWStr) || profile.startWeightKg) * 10) / 10
            )
          );
          const parsedGoal = Math.max(
            30,
            Math.min(
              300,
              Math.round((Number(goalWStr) || profile.goalWeightKg) * 10) / 10
            )
          );
          await updateProfile({
            name: name.trim() || 'You',
            heightCm: Math.max(120, Math.min(240, Number(heightStr) || 175)),
            startWeightKg: parsedStart,
            goalWeightKg: parsedGoal,
          });
          onClose();
          showToast('Profile saved');
        }}
        style={[styles.sheetPrimaryBtn, { marginTop: 6 }]}
      >
        <Text style={styles.sheetPrimaryBtnText}>Save profile</Text>
      </Pressable>
    </View>
  );
}

function ScannerOverlayContent({ onClose }: { onClose: () => void }) {
  const isDesktopStage = useIsDesktopStage();
  const { auth, startMealAnalysisJob, showToast } = useCalorieTracker();

  const cameraRef = useRef<CameraView | null>(null);
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

  const handleCaptureAnalyze = async () => {
    if (capturing) return;

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
      showToast('Camera is starting up…');
      return;
    }

    setCapturing(true);
    triggerShutterFlash();
    try {
      const shot = await cameraRef.current.takePictureAsync({
        quality: 0.72,
        base64: true,
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
    <View style={styles.scannerRoot}>
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
              ? { barcodeTypes: ['ean13', 'ean8', 'upc_a', 'upc_e', 'qr'] }
              : undefined
          }
          onBarcodeScanned={
            scanMode === 'barcode'
              ? ({ data }) => {
                  if (data && !userNotes.includes(data)) {
                    setUserNotes((prev) =>
                      prev ? `${prev} (Barcode: ${data})` : `Barcode: ${data}`
                    );
                    showToast(`Barcode scanned: ${data}`);
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

      {/* Center Scan Frame + Animated Scanline (or Permission Prompt) */}
      <View style={styles.scannerCenterArea}>
        {!pickedPhoto && permission && !permission.granted ? (
          <View style={styles.permissionCard}>
            <PlateIcon name="camera" size={28} color="#FFFFFF" />
            <Text style={styles.permissionTitle}>Camera Access Required</Text>
            <Text style={styles.permissionSub}>
              Allow Plate to use your camera so you can point at your meal and
              scan calories directly.
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
                ? 'Point camera at package barcode'
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

        {/* Optional Grams / mL / Ingredients Context Input */}
        <View style={styles.notesGlassWrap}>
          <PlateIcon name="sparkle" size={15} color="rgba(255,255,255,0.8)" />
          <TextInput
            value={userNotes}
            onChangeText={setUserNotes}
            placeholder="Optional: g or mL (e.g. 180 g chicken, 250 mL milk)…"
            placeholderTextColor="rgba(255,255,255,0.62)"
            style={styles.notesGlassInput}
            returnKeyType="done"
          />
        </View>
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
    </View>
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
    <View style={styles.detailRoot}>
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
    </View>
  );
}

export function PlateOverlays({
  activeSheet,
  selectedExercise,
  onChangeSheet,
}: PlateOverlaysProps) {
  const isDesktopStage = useIsDesktopStage();
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
    showToast,
    selectedDateKey,
  } = useCalorieTracker();

  const [quickOpen, setQuickOpen] = useState(false);

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
          onPress={() => {
            setQuickOpen(false);
            onChangeSheet(null);
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
        <View style={styles.bottomSheet}>
          <View style={styles.grabber} />
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
          {activeSheet === 'exercise' ? (
            <ExerciseSheetBody onClose={() => onChangeSheet(null)} />
          ) : null}
          {activeSheet === 'weight' ? (
            <WeightSheetBody key="weight" onClose={() => onChangeSheet(null)} />
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
              onClose={() => onChangeSheet(null)}
            />
          ) : null}
          {activeSheet === 'exerciseDetail' && selectedExercise ? (
            <View style={{ gap: 12 }}>
              <Text style={styles.sheetTitle}>{selectedExercise.title}</Text>
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
                <Text style={styles.sheetPrimaryBtnText}>Remove workout</Text>
              </Pressable>
            </View>
          ) : null}
        </View>
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
          <View style={styles.toastPill}>
            <PlateIcon name="check" size={16} color={plateColors.ok} />
            <Text style={styles.toastText} numberOfLines={1}>
              {toastMessage}
            </Text>
          </View>
        </View>
      ) : null}
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
  bottomSheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    maxHeight: '85%',
    backgroundColor: plateColors.card,
    borderTopLeftRadius: 34,
    borderTopRightRadius: 34,
    paddingTop: 10,
    paddingHorizontal: 20,
    paddingBottom: 32,
    zIndex: 50,
  },
  grabber: {
    width: 40,
    height: 5,
    borderRadius: 5,
    backgroundColor: '#DCDCE0',
    alignSelf: 'center',
    marginBottom: 14,
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
    height: 54,
    borderRadius: 99,
    backgroundColor: plateColors.ink,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sheetPrimaryBtnText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
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
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.35,
    shadowRadius: 16,
    elevation: 8,
  },
  toastText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '600',
  },
});
