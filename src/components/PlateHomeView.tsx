import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Image,
  LayoutChangeEvent,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {
  estimateStepMeters,
  formatMetersMetric,
  formatNum,
  formatWaterLiters,
  mlToWaterSteps,
  resolveMealImageSource,
  WATER_STEP_ML,
  waterStepsToMl,
} from '../constants/plateCatalog';
import { useCalorieTracker } from '../context/CalorieContext';
import { isProviderConfigured } from '../services/ai';
import { cardShadow, colors, plateColors } from '../theme/colors';
import { MealEntry } from '../types/models';
import {
  formatTimeShort,
  parseLocalDateKey,
  shiftDateKey,
  toLocalDateKey,
} from '../utils/date';
import { PlateLogoMark, useIsDesktopStage } from './PhoneStageFrame';
import { PlateIcon, ProgressRing } from './PlatePrimitives';

const DAY_LETTERS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

const PENDING_STAGES: [number, string][] = [
  [0, 'Uploading photo…'],
  [18, 'Separating ingredients…'],
  [48, 'Breaking down macros…'],
  [78, 'Final checks…'],
];

function getPendingStageLabel(progress: number = 0): string {
  let label = PENDING_STAGES[0][1];
  for (const [threshold, text] of PENDING_STAGES) {
    if (progress >= threshold) {
      label = text;
    }
  }
  return label;
}

interface PlateHomeViewProps {
  onOpenStepsSheet: () => void;
  onOpenWaterSheet: () => void;
  onSelectExercise: (entry: MealEntry) => void;
}

function PendingMealCard({ entry }: { entry: MealEntry }) {
  const [pulse] = useState(() => new Animated.Value(0.45));

  useEffect(() => {
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: 650,
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 0.45,
          duration: 650,
          useNativeDriver: true,
        }),
      ])
    );
    anim.start();
    return () => anim.stop();
  }, [pulse]);

  const imgSrc = resolveMealImageSource(entry);
  const progress = Math.round(entry.progress ?? 8);

  return (
    <View style={[styles.logCard, cardShadow]}>
      <View style={styles.logImgWrap}>
        {imgSrc ? (
          <Image source={imgSrc} style={styles.logImg} resizeMode="cover" />
        ) : null}
        <View style={styles.pendingScrim}>
          <ProgressRing
            size={54}
            strokeWidth={5}
            progress={progress / 100}
            color="#FFFFFF"
            trackColor="rgba(255,255,255,0.26)"
          >
            <Text style={styles.pendingPct}>{`${progress}%`}</Text>
          </ProgressRing>
        </View>
      </View>

      <View style={styles.logBody}>
        <Text style={styles.pendingStatusText} numberOfLines={1}>
          {getPendingStageLabel(progress)}
        </Text>
        <Animated.View
          style={[styles.skeletonBar, { width: '80%', opacity: pulse }]}
        />
        <View style={styles.skeletonRow}>
          <Animated.View
            style={[styles.skeletonBar, { width: '24%', opacity: pulse }]}
          />
          <Animated.View
            style={[styles.skeletonBar, { width: '24%', opacity: pulse }]}
          />
          <Animated.View
            style={[styles.skeletonBar, { width: '24%', opacity: pulse }]}
          />
        </View>
        <Text style={styles.pendingNotify}>
          {"We'll let you know when it's done"}
        </Text>
      </View>
    </View>
  );
}

export function PlateHomeView({
  onOpenStepsSheet,
  onOpenWaterSheet,
  onSelectExercise,
}: PlateHomeViewProps) {
  const {
    selectedDateKey,
    setSelectedDateKey,
    mealsForSelectedDate,
    dailySummaries,
    selectedDaySummary,
    streakCount,
    goals,
    profile,
    preferences,
    updatePreferences,
    waterByDate,
    addWaterMl,
    stepsByDate,
    auth,
    companionStatus,
    setActiveTab,
    setDetailEntryId,
    setScannerOpen,
    refiningByEntryId,
    showToast,
  } = useCalorieTracker();

  const isDesktopStage = useIsDesktopStage();
  const [carouselWidth, setCarouselWidth] = useState(350);
  const [carouselPage, setCarouselPage] = useState(0);
  const carouselRef = useRef<React.ComponentRef<typeof ScrollView> | null>(null);

  const todayKey = toLocalDateKey();
  const providerMeta = colors.providers[auth.activeProvider];
  const providerReady = isProviderConfigured(
    auth.activeProvider,
    auth,
    companionStatus
  ).ready;

  // Build Monday..Sunday week containing `selectedDateKey`
  const selectedDateObj = parseLocalDateKey(selectedDateKey);
  const dow = (selectedDateObj.getDay() + 6) % 7;
  const mondayDate = new Date(selectedDateObj);
  mondayDate.setDate(selectedDateObj.getDate() - dow);

  const todayDateObj = parseLocalDateKey(todayKey);
  const todayDow = (todayDateObj.getDay() + 6) % 7;
  const currentMonday = new Date(todayDateObj);
  currentMonday.setDate(todayDateObj.getDate() - todayDow);
  const isCurrentWeek =
    toLocalDateKey(mondayDate) === toLocalDateKey(currentMonday);

  const weekDays = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(mondayDate);
    d.setDate(mondayDate.getDate() + i);
    const key = toLocalDateKey(d);
    const sum = dailySummaries[key];
    const kcal = sum?.calories ?? 0;
    const pct = kcal / Math.max(1, goals.dailyCalories);
    const isFuture = key > todayKey;
    return {
      key,
      letter: DAY_LETTERS[i],
      dayNum: d.getDate(),
      kcal,
      pct,
      isFuture,
      isSelected: key === selectedDateKey,
    };
  });

  const sundayDate = new Date(mondayDate);
  sundayDate.setDate(mondayDate.getDate() + 6);
  const weekRangeLabel = isCurrentWeek
    ? 'This week'
    : `${mondayDate.toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
      })} – ${sundayDate.toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
      })}`;

  // Hero & Macro values
  const burned = selectedDaySummary.burnedCalories;
  const budget =
    goals.dailyCalories + (preferences.addBurned ? burned : 0);
  const left = budget - selectedDaySummary.calories;
  const eaten = preferences.showEaten;
  const heroBig = eaten ? selectedDaySummary.calories : Math.abs(left);
  const isOver = !eaten && left < 0;

  const steps = stepsByDate[selectedDateKey] ?? 0;
  const water = waterByDate[selectedDateKey] ?? 0;
  const waterMl = waterStepsToMl(water);
  const waterGoalMl = Math.max(250, waterStepsToMl(goals.waterGlasses));
  const waterPct = Math.min(1, waterMl / waterGoalMl);
  const stepKcal = Math.round(steps * 0.04);
  const stepMeters = estimateStepMeters(steps, profile.heightCm);
  const activeRefiningCount = Object.keys(refiningByEntryId).length;

  const handleQuickAddWater = async (deltaMl: number) => {
    const nextMl = await addWaterMl(deltaMl, selectedDateKey);
    if (deltaMl > 0) {
      showToast(
        `+${deltaMl} mL water · ${formatWaterLiters(mlToWaterSteps(nextMl))} today`
      );
    }
  };

  const handleCarouselLayout = (e: LayoutChangeEvent) => {
    const w = Math.round(e.nativeEvent.layout.width);
    if (w > 0 && w !== carouselWidth) {
      setCarouselWidth(w);
    }
  };

  const handleCarouselScroll = (
    e: NativeSyntheticEvent<NativeScrollEvent>
  ) => {
    const x = e.nativeEvent.contentOffset.x;
    const w = e.nativeEvent.layoutMeasurement.width || carouselWidth;
    if (w > 0) {
      const idx = Math.round(x / w);
      if (idx !== carouselPage) {
        setCarouselPage(idx);
      }
    }
  };

  const scrollToPage = (pageIdx: number) => {
    setCarouselPage(pageIdx);
    carouselRef.current?.scrollTo({
      x: pageIdx * carouselWidth,
      animated: true,
    });
  };

  const renderMacroCard = (
    key: 'p' | 'c' | 'f',
    name: string,
    val: number,
    goal: number,
    accent: string,
    iconName: 'drum' | 'wheat' | 'drop'
  ) => {
    const rem = goal - val;
    const displayVal = eaten ? Math.round(val) : Math.abs(Math.round(rem));
    const overMacro = !eaten && rem < 0;

    return (
      <View key={key} style={[styles.macroCard, cardShadow]}>
        <View>
          <Text style={styles.macroVal}>{`${displayVal} g`}</Text>
          <Text style={styles.macroLabel} numberOfLines={1}>
            {`${name} `}
            {eaten ? (
              <Text style={styles.macroLabelBold}>eaten</Text>
            ) : overMacro ? (
              <Text style={[styles.macroLabelBold, { color: plateColors.protein }]}>
                over
              </Text>
            ) : (
              'left'
            )}
          </Text>
        </View>
        <View style={styles.macroRingWrap}>
          <ProgressRing
            size={66}
            strokeWidth={6.5}
            progress={val / Math.max(1, goal)}
            color={accent}
          >
            <PlateIcon name={iconName} size={18} color={accent} />
          </ProgressRing>
        </View>
      </View>
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
    >
      {/* Top Brand + AI Pill + Streak */}
      <View style={styles.topRow}>
        <View style={styles.brandWrap}>
          <PlateLogoMark size={28} />
          <Text style={styles.brandText}>Plate</Text>
        </View>

        <View style={styles.topRightGroup}>
          <Pressable
            onPress={() => setActiveTab('settings')}
            style={({ pressed }) => [
              styles.aiPill,
              cardShadow,
              pressed ? { opacity: 0.75 } : null,
            ]}
          >
            <View
              style={[
                styles.aiDot,
                {
                  backgroundColor: providerReady
                    ? plateColors.ok
                    : plateColors.faint,
                },
              ]}
            />
            <Text style={styles.aiPillText}>{providerMeta.label}</Text>
          </Pressable>

          <Pressable
            onPress={() => setActiveTab('progress')}
            style={({ pressed }) => [
              styles.streakPill,
              cardShadow,
              pressed ? { transform: [{ scale: 0.96 }] } : null,
            ]}
          >
            <PlateIcon
              name="flame"
              size={18}
              color={plateColors.flame}
              fill={plateColors.flame}
            />
            <Text style={styles.streakNum}>{streakCount}</Text>
          </Pressable>
        </View>
      </View>

      {/* Week Navigation Bar (subtle previous-days browser) */}
      <View style={styles.weekNavRow}>
        <Pressable
          onPress={() => setSelectedDateKey(shiftDateKey(selectedDateKey, -7))}
          hitSlop={8}
          style={styles.weekArrowBtn}
        >
          <PlateIcon name="back" size={14} color={plateColors.muted} />
        </Pressable>

        <Pressable
          onPress={() => {
            if (selectedDateKey !== todayKey) {
              setSelectedDateKey(todayKey);
            }
          }}
        >
          <Text style={styles.weekRangeText}>
            {weekRangeLabel}
            {selectedDateKey !== todayKey ? (
              <Text style={styles.jumpTodayText}> · Today</Text>
            ) : null}
          </Text>
        </Pressable>

        <Pressable
          onPress={() => {
            if (!isCurrentWeek) {
              const nextKey = shiftDateKey(selectedDateKey, 7);
              setSelectedDateKey(nextKey > todayKey ? todayKey : nextKey);
            }
          }}
          disabled={isCurrentWeek}
          hitSlop={8}
          style={[styles.weekArrowBtn, isCurrentWeek ? { opacity: 0.25 } : null]}
        >
          <View style={{ transform: [{ rotate: '180deg' }] }}>
            <PlateIcon name="back" size={14} color={plateColors.muted} />
          </View>
        </Pressable>
      </View>

      {/* 7-Day Ring Strip */}
      <View style={styles.weekStrip}>
        {weekDays.map((d) => {
          const ringColor =
            d.pct > 1.08 ? plateColors.protein : plateColors.ink;
          return (
            <Pressable
              key={d.key}
              disabled={d.isFuture}
              onPress={() => setSelectedDateKey(d.key)}
              style={[
                styles.dayCell,
                d.isSelected ? [styles.dayCellSelected, cardShadow] : null,
                d.isFuture ? styles.dayCellFuture : null,
              ]}
            >
              <ProgressRing
                size={36}
                strokeWidth={2.5}
                progress={d.pct}
                color={ringColor}
                trackColor={d.kcal > 0 ? '#E6E6EA' : '#CFCFD5'}
                dashedTrack={d.kcal > 0 ? undefined : '2.5 3.2'}
              >
                <Text style={styles.dayLetter}>{d.letter}</Text>
              </ProgressRing>
              <Text
                style={[
                  styles.dayNumber,
                  d.isSelected ? styles.dayNumberSelected : null,
                ]}
              >
                {d.dayNum}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {/* 2-Page Horizontal Carousel */}
      <View onLayout={handleCarouselLayout} style={styles.carouselOuter}>
        <ScrollView
          ref={carouselRef}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          onScroll={handleCarouselScroll}
          scrollEventThrottle={16}
        >
          {/* Page 1: Hero Calories + 3 Macros */}
          <View style={[styles.carouselPage, { width: carouselWidth }]}>
            <Pressable
              onPress={() => updatePreferences({ showEaten: !eaten })}
              style={({ pressed }) => [
                styles.heroCard,
                cardShadow,
                pressed ? { transform: [{ scale: 0.99 }] } : null,
              ]}
            >
              <View style={{ flex: 1, paddingRight: 10 }}>
                <Text
                  style={styles.heroBigNum}
                  numberOfLines={1}
                  adjustsFontSizeToFit
                >
                  {formatNum(heroBig)}
                </Text>
                <View style={styles.heroLabelRow}>
                  <Text
                    style={[
                      styles.heroLabelText,
                      isOver ? { color: plateColors.protein } : null,
                    ]}
                  >
                    {'Calories '}
                    <Text style={styles.heroLabelBold}>
                      {eaten ? 'eaten' : isOver ? 'over' : 'left'}
                    </Text>
                  </Text>
                  <PlateIcon name="swap" size={17} color={plateColors.faint} />
                </View>
              </View>

              <ProgressRing
                size={118}
                strokeWidth={10}
                progress={selectedDaySummary.calories / Math.max(1, budget)}
                color={isOver ? plateColors.protein : plateColors.ink}
              >
                <PlateIcon
                  name="flame"
                  size={30}
                  color={isOver ? plateColors.protein : plateColors.ink}
                />
              </ProgressRing>
            </Pressable>

            <View style={styles.macrosRow}>
              {renderMacroCard(
                'p',
                'Protein',
                selectedDaySummary.protein,
                goals.proteinGrams,
                plateColors.protein,
                'drum'
              )}
              {renderMacroCard(
                'c',
                'Carbs',
                selectedDaySummary.carbs,
                goals.carbsGrams,
                plateColors.carbs,
                'wheat'
              )}
              {renderMacroCard(
                'f',
                'Fats',
                selectedDaySummary.fat,
                goals.fatGrams,
                plateColors.fat,
                'drop'
              )}
            </View>
          </View>

          {/* Page 2: Steps + Calories Burned + Water */}
          <View style={[styles.carouselPage, { width: carouselWidth }]}>
            <View style={styles.p2Grid}>
              <Pressable
                onPress={onOpenStepsSheet}
                style={({ pressed }) => [
                  styles.miniCard,
                  cardShadow,
                  pressed ? { transform: [{ scale: 0.98 }] } : null,
                ]}
              >
                <View>
                  <Text style={styles.miniVal}>{formatNum(steps)}</Text>
                  <Text style={styles.miniSub}>
                    {`of ${formatNum(goals.dailySteps)} · ${formatMetersMetric(
                      stepMeters
                    )}`}
                  </Text>
                </View>
                <View style={{ alignSelf: 'flex-start' }}>
                  <ProgressRing
                    size={76}
                    strokeWidth={7}
                    progress={steps / Math.max(1, goals.dailySteps)}
                    color={plateColors.ink}
                  >
                    <PlateIcon name="walk" size={22} color={plateColors.ink} />
                  </ProgressRing>
                </View>
              </Pressable>

              <View style={[styles.miniCard, cardShadow]}>
                <View style={styles.miniTopRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.miniVal}>
                      {formatNum(burned + stepKcal)}
                      <Text style={styles.miniValUnit}> kcal</Text>
                    </Text>
                    <Text style={styles.miniSub}>Calories burned</Text>
                  </View>
                  <View style={styles.chipBadge}>
                    <PlateIcon name="flame" size={18} color={plateColors.ink} />
                  </View>
                </View>

                <View style={styles.subLines}>
                  <View style={styles.subLineRow}>
                    <Text style={styles.subLineLabel}>Steps</Text>
                    <Text style={styles.subLineVal}>{`+${stepKcal}`}</Text>
                  </View>
                  <View style={styles.subLineRow}>
                    <Text style={styles.subLineLabel}>Workouts</Text>
                    <Text style={styles.subLineVal}>{`+${burned}`}</Text>
                  </View>
                </View>
              </View>
            </View>

            <View style={[styles.waterCard, cardShadow]}>
              <Pressable
                onPress={onOpenWaterSheet}
                style={styles.waterTapBody}
              >
                <View style={styles.chipBadge}>
                  <PlateIcon name="drop" size={18} color={plateColors.fat} />
                </View>

                <View style={{ flex: 1 }}>
                  <Text style={styles.waterVal}>{formatWaterLiters(water)}</Text>
                  <Text style={styles.waterSub}>
                    {`Water · ${formatNum(waterMl)} mL / ${formatWaterLiters(
                      goals.waterGlasses
                    )}`}
                  </Text>
                  <View style={styles.glassesRow}>
                    {Array.from(
                      { length: Math.min(12, Math.max(1, goals.waterGlasses)) },
                      (_, idx) => {
                        const filled = idx + 0.01 <= water;
                        const partial = !filled && idx < water;
                        return (
                          <View key={idx} style={styles.glassCup}>
                            {filled ? (
                              <View style={styles.glassFill} />
                            ) : partial ? (
                              <View
                                style={[
                                  styles.glassFill,
                                  {
                                    height: Math.max(
                                      4,
                                      Math.round((water - idx) * 14)
                                    ),
                                  },
                                ]}
                              />
                            ) : null}
                          </View>
                        );
                      }
                    )}
                  </View>
                </View>
              </Pressable>

              <Pressable
                onPress={() => void handleQuickAddWater(-WATER_STEP_ML)}
                disabled={waterMl <= 0}
                style={({ pressed }) => [
                  styles.roundBtn,
                  waterMl <= 0 ? { opacity: 0.35 } : null,
                  pressed ? { transform: [{ scale: 0.9 }] } : null,
                ]}
              >
                <PlateIcon name="minus" size={18} color={plateColors.ink} />
              </Pressable>

              <Pressable
                onPress={() => void handleQuickAddWater(WATER_STEP_ML)}
                style={({ pressed }) => [
                  styles.roundBtn,
                  styles.roundBtnDark,
                  pressed ? { transform: [{ scale: 0.9 }] } : null,
                ]}
              >
                <PlateIcon name="plus" size={18} color="#FFFFFF" />
              </Pressable>
            </View>
          </View>
        </ScrollView>
      </View>

      {/* Carousel Dots */}
      <View style={styles.dotsRow}>
        {[0, 1].map((idx) => {
          const active = carouselPage === idx;
          return (
            <Pressable
              key={idx}
              onPress={() => scrollToPage(idx)}
              hitSlop={8}
              style={[styles.dot, active ? styles.dotActive : null]}
            />
          );
        })}
      </View>

      {/* Always-Visible Hydration Quick Bar */}
      <View style={[styles.waterQuickCard, cardShadow]}>
        <Pressable
          onPress={onOpenWaterSheet}
          style={({ pressed }) => [
            styles.waterQuickTapArea,
            pressed ? { opacity: 0.8 } : null,
          ]}
        >
          <View style={styles.waterQuickIconWrap}>
            <PlateIcon name="drop" size={18} color={plateColors.fat} />
          </View>
          <View style={{ flex: 1, gap: 5 }}>
            <View style={styles.waterQuickHeaderRow}>
              <Text style={styles.waterQuickTitle}>Water</Text>
              <Text style={styles.waterQuickAmount}>
                {`${formatWaterLiters(water)} `}
                <Text style={styles.waterQuickGoalText}>
                  {`/ ${formatWaterLiters(goals.waterGlasses)} (${formatNum(
                    waterMl
                  )} mL)`}
                </Text>
              </Text>
            </View>
            <View style={styles.waterQuickProgressTrack}>
              <View
                style={[
                  styles.waterQuickProgressFill,
                  { width: `${Math.round(waterPct * 100)}%` },
                ]}
              />
            </View>
          </View>
        </Pressable>

        <View style={styles.waterQuickActions}>
          <Pressable
            onPress={() => void handleQuickAddWater(-WATER_STEP_ML)}
            disabled={waterMl <= 0}
            hitSlop={6}
            style={({ pressed }) => [
              styles.waterQuickMinusBtn,
              waterMl <= 0 ? { opacity: 0.35 } : null,
              pressed ? { transform: [{ scale: 0.92 }] } : null,
            ]}
          >
            <PlateIcon name="minus" size={15} color={plateColors.ink} />
          </Pressable>

          <Pressable
            onPress={() => void handleQuickAddWater(WATER_STEP_ML)}
            hitSlop={6}
            style={({ pressed }) => [
              styles.waterQuickAddPill,
              pressed ? { transform: [{ scale: 0.94 }] } : null,
            ]}
          >
            <PlateIcon name="plus" size={13} color="#FFFFFF" />
            <Text style={styles.waterQuickAddPillText}>250 mL</Text>
          </Pressable>
        </View>
      </View>

      {/* Background AI Working Indicator */}
      {activeRefiningCount > 0 ? (
        <View style={[styles.refiningBanner, cardShadow]}>
          <ActivityIndicator size="small" color="#FFFFFF" />
          <View style={{ flex: 1 }}>
            <Text style={styles.refiningBannerTitle}>
              AI is recalculating nutrition in the background…
            </Text>
            <Text style={styles.refiningBannerSub}>
              Calories and macros will update automatically when ready
            </Text>
          </View>
        </View>
      ) : null}

      {/* Recently Logged */}
      <View style={styles.sectionHead}>
        <Text style={styles.sectionTitle}>Recently logged</Text>
        {mealsForSelectedDate.length > 0 ? (
          <Text style={styles.sectionCount}>
            {`${mealsForSelectedDate.length} ${
              mealsForSelectedDate.length === 1 ? 'item' : 'items'
            }`}
          </Text>
        ) : null}
      </View>

      {mealsForSelectedDate.length === 0 ? (
        <Pressable
          onPress={() => setScannerOpen(true)}
          style={({ pressed }) => [
            styles.emptyCard,
            pressed ? { opacity: 0.75 } : null,
          ]}
        >
          <Text style={styles.emptyTitle}>
            {`Nothing logged ${
              selectedDateKey === todayKey ? 'yet' : 'this day'
            }`}
          </Text>
          <Text style={styles.emptySub}>Tap + to snap your first meal</Text>
        </Pressable>
      ) : (
        <View style={styles.logList}>
          {mealsForSelectedDate.map((entry) => {
            if (entry.status === 'pending') {
              return <PendingMealCard key={entry.id} entry={entry} />;
            }

            if (entry.entryType === 'exercise') {
              return (
                <Pressable
                  key={entry.id}
                  onPress={() => onSelectExercise(entry)}
                  style={({ pressed }) => [
                    styles.logCard,
                    cardShadow,
                    pressed ? { transform: [{ scale: 0.985 }] } : null,
                  ]}
                >
                  <View style={styles.exIconTile}>
                    <PlateIcon
                      name={entry.exerciseIcon ?? 'dumbbell'}
                      size={26}
                      color={plateColors.ink}
                    />
                  </View>
                  <View style={styles.logBody}>
                    <View style={styles.logTopRow}>
                      <Text style={styles.logName} numberOfLines={1}>
                        {entry.title}
                      </Text>
                      <View style={styles.timePill}>
                        <Text style={styles.timePillText}>
                          {formatTimeShort(entry.createdAt)}
                        </Text>
                      </View>
                    </View>
                    <View style={styles.logKcalRow}>
                      <PlateIcon
                        name="flame"
                        size={16}
                        color={plateColors.ink}
                      />
                      <Text style={styles.logKcalBold}>
                        {formatNum(entry.calories)}
                      </Text>
                      <Text style={styles.logKcalLabel}>calories</Text>
                    </View>
                    <Text style={styles.logSubText}>
                      {`Intensity: ${entry.exerciseIntensity ?? 'Medium'} · ${
                        entry.exerciseMinutes ?? 30
                      } min`}
                    </Text>
                  </View>
                </Pressable>
              );
            }

            const mult = entry.servings ?? 1;
            const imgSrc = resolveMealImageSource(entry);
            const isRefiningThis = Boolean(refiningByEntryId[entry.id]);

            return (
              <Pressable
                key={entry.id}
                onPress={() => setDetailEntryId(entry.id)}
                style={({ pressed }) => [
                  styles.logCard,
                  cardShadow,
                  isRefiningThis ? styles.logCardRefining : null,
                  pressed ? { transform: [{ scale: 0.985 }] } : null,
                ]}
              >
                <View style={styles.logImgWrap}>
                  {imgSrc ? (
                    <Image
                      source={imgSrc}
                      style={styles.logImg}
                      resizeMode="cover"
                    />
                  ) : (
                    <View style={styles.logImgFallback}>
                      <PlateIcon
                        name="camera"
                        size={22}
                        color={plateColors.muted}
                      />
                    </View>
                  )}
                  {isRefiningThis ? (
                    <View style={styles.pendingScrim}>
                      <ActivityIndicator size="small" color="#FFFFFF" />
                    </View>
                  ) : null}
                </View>

                <View style={styles.logBody}>
                  <View style={styles.logTopRow}>
                    <Text style={styles.logName} numberOfLines={1}>
                      {entry.title}
                      {mult !== 1 ? ` ×${mult}` : ''}
                    </Text>
                    <View style={styles.timePill}>
                      <Text style={styles.timePillText}>
                        {formatTimeShort(entry.createdAt)}
                      </Text>
                    </View>
                  </View>

                  {isRefiningThis ? (
                    <View style={styles.cardRefiningPill}>
                      <PlateIcon
                        name="sparkle"
                        size={12}
                        color={plateColors.ink}
                      />
                      <Text style={styles.cardRefiningPillText} numberOfLines={1}>
                        AI updating calories & macros…
                      </Text>
                    </View>
                  ) : null}

                  <View style={styles.logKcalRow}>
                    <PlateIcon name="flame" size={16} color={plateColors.ink} />
                    <Text style={styles.logKcalBold}>
                      {formatNum(entry.calories * mult)}
                    </Text>
                    <Text style={styles.logKcalLabel}>calories</Text>
                  </View>

                  <View style={styles.macroMiniRow}>
                    <View style={styles.macroMiniItem}>
                      <PlateIcon
                        name="drum"
                        size={14}
                        color={plateColors.protein}
                      />
                      <Text style={styles.macroMiniText}>
                        {`${Math.round(entry.protein * mult)} g`}
                      </Text>
                    </View>
                    <View style={styles.macroMiniItem}>
                      <PlateIcon
                        name="wheat"
                        size={14}
                        color={plateColors.carbs}
                      />
                      <Text style={styles.macroMiniText}>
                        {`${Math.round(entry.carbs * mult)} g`}
                      </Text>
                    </View>
                    <View style={styles.macroMiniItem}>
                      <PlateIcon
                        name="drop"
                        size={14}
                        color={plateColors.fat}
                      />
                      <Text style={styles.macroMiniText}>
                        {`${Math.round(entry.fat * mult)} g`}
                      </Text>
                    </View>
                  </View>
                </View>
              </Pressable>
            );
          })}
        </View>
      )}
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
    paddingBottom: 126,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 2,
    marginBottom: 12,
  },
  brandWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
  },
  brandText: {
    fontSize: 24,
    fontWeight: '700',
    color: plateColors.ink,
    letterSpacing: -0.9,
  },
  topRightGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  aiPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 36,
    paddingHorizontal: 11,
    backgroundColor: plateColors.card,
    borderRadius: 99,
  },
  aiDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  aiPillText: {
    fontSize: 12.5,
    fontWeight: '600',
    color: plateColors.ink2,
  },
  streakPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 36,
    paddingLeft: 10,
    paddingRight: 14,
    backgroundColor: plateColors.card,
    borderRadius: 99,
  },
  streakNum: {
    fontSize: 15,
    fontWeight: '700',
    color: plateColors.ink,
    fontVariant: ['tabular-nums'],
  },
  weekNavRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
    paddingHorizontal: 4,
  },
  weekArrowBtn: {
    padding: 4,
  },
  weekRangeText: {
    fontSize: 12,
    fontWeight: '600',
    color: plateColors.muted,
  },
  jumpTodayText: {
    color: plateColors.ink,
    fontWeight: '700',
  },
  weekStrip: {
    flexDirection: 'row',
    gap: 4,
    marginBottom: 16,
  },
  dayCell: {
    flex: 1,
    alignItems: 'center',
    gap: 6,
    paddingVertical: 8,
    borderRadius: 16,
  },
  dayCellSelected: {
    backgroundColor: plateColors.card,
  },
  dayCellFuture: {
    opacity: 0.35,
  },
  dayLetter: {
    fontSize: 12,
    fontWeight: '600',
    color: plateColors.ink2,
  },
  dayNumber: {
    fontSize: 13,
    fontWeight: '600',
    color: plateColors.muted,
    fontVariant: ['tabular-nums'],
  },
  dayNumberSelected: {
    color: plateColors.ink,
  },
  carouselOuter: {
    width: '100%',
  },
  carouselPage: {
    gap: 12,
  },
  heroCard: {
    backgroundColor: plateColors.card,
    borderRadius: 26,
    paddingVertical: 24,
    paddingLeft: 26,
    paddingRight: 22,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  heroBigNum: {
    fontSize: 52,
    fontWeight: '700',
    color: plateColors.ink,
    lineHeight: 56,
    letterSpacing: -1.8,
    fontVariant: ['tabular-nums'],
  },
  heroLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 6,
  },
  heroLabelText: {
    fontSize: 15,
    fontWeight: '500',
    color: plateColors.ink2,
  },
  heroLabelBold: {
    fontWeight: '700',
  },
  macrosRow: {
    flexDirection: 'row',
    gap: 10,
  },
  macroCard: {
    flex: 1,
    backgroundColor: plateColors.card,
    borderRadius: 26,
    paddingHorizontal: 13,
    paddingTop: 15,
    paddingBottom: 14,
    gap: 14,
  },
  macroVal: {
    fontSize: 20,
    fontWeight: '700',
    color: plateColors.ink,
    letterSpacing: -0.6,
    fontVariant: ['tabular-nums'],
  },
  macroLabel: {
    fontSize: 12.5,
    fontWeight: '500',
    color: plateColors.muted,
    marginTop: 2,
  },
  macroLabelBold: {
    fontWeight: '600',
    color: plateColors.ink2,
  },
  macroRingWrap: {
    alignSelf: 'center',
  },
  p2Grid: {
    flexDirection: 'row',
    gap: 10,
  },
  miniCard: {
    flex: 1,
    backgroundColor: plateColors.card,
    borderRadius: 26,
    padding: 18,
    minHeight: 162,
    justifyContent: 'space-between',
  },
  miniTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 6,
  },
  miniVal: {
    fontSize: 26,
    fontWeight: '700',
    color: plateColors.ink,
    letterSpacing: -0.9,
    fontVariant: ['tabular-nums'],
  },
  miniValUnit: {
    fontSize: 14,
    fontWeight: '600',
    color: plateColors.muted,
  },
  miniSub: {
    fontSize: 13,
    fontWeight: '500',
    color: plateColors.muted,
    marginTop: 2,
  },
  chipBadge: {
    width: 34,
    height: 34,
    borderRadius: 12,
    backgroundColor: plateColors.chip,
    alignItems: 'center',
    justifyContent: 'center',
  },
  subLines: {
    gap: 6,
  },
  subLineRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  subLineLabel: {
    fontSize: 13,
    color: plateColors.ink2,
  },
  subLineVal: {
    fontSize: 13,
    fontWeight: '600',
    color: plateColors.ink2,
    fontVariant: ['tabular-nums'],
  },
  waterCard: {
    backgroundColor: plateColors.card,
    borderRadius: 26,
    padding: 18,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  waterVal: {
    fontSize: 22,
    fontWeight: '700',
    color: plateColors.ink,
    letterSpacing: -0.6,
    fontVariant: ['tabular-nums'],
  },
  waterSub: {
    fontSize: 13,
    color: plateColors.muted,
    marginTop: 1,
  },
  glassesRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
    marginTop: 10,
  },
  glassCup: {
    width: 14,
    height: 18,
    borderTopLeftRadius: 3,
    borderTopRightRadius: 3,
    borderBottomLeftRadius: 5,
    borderBottomRightRadius: 5,
    backgroundColor: plateColors.chip,
    overflow: 'hidden',
    justifyContent: 'flex-end',
  },
  glassFill: {
    height: 14,
    backgroundColor: plateColors.fat,
  },
  roundBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: plateColors.chip,
    alignItems: 'center',
    justifyContent: 'center',
  },
  roundBtnDark: {
    backgroundColor: plateColors.ink,
  },
  dotsRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 6,
    marginTop: 12,
    marginBottom: 14,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 6,
    backgroundColor: '#D4D4D9',
  },
  dotActive: {
    width: 18,
    backgroundColor: plateColors.ink,
  },
  waterTapBody: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  waterQuickCard: {
    backgroundColor: plateColors.card,
    borderRadius: 22,
    paddingVertical: 12,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 18,
  },
  waterQuickTapArea: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  waterQuickIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 12,
    backgroundColor: '#EAF4FF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  waterQuickHeaderRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: 6,
  },
  waterQuickTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: plateColors.ink,
  },
  waterQuickAmount: {
    fontSize: 13,
    fontWeight: '700',
    color: plateColors.ink,
    fontVariant: ['tabular-nums'],
  },
  waterQuickGoalText: {
    fontSize: 12,
    fontWeight: '500',
    color: plateColors.muted,
  },
  waterQuickProgressTrack: {
    height: 6,
    borderRadius: 99,
    backgroundColor: plateColors.chip,
    overflow: 'hidden',
  },
  waterQuickProgressFill: {
    height: '100%',
    borderRadius: 99,
    backgroundColor: plateColors.fat,
  },
  waterQuickActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  waterQuickMinusBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: plateColors.chip,
    alignItems: 'center',
    justifyContent: 'center',
  },
  waterQuickAddPill: {
    height: 32,
    paddingHorizontal: 10,
    borderRadius: 99,
    backgroundColor: plateColors.ink,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  waterQuickAddPillText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  refiningBanner: {
    backgroundColor: plateColors.ink,
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 11,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 14,
  },
  refiningBannerTitle: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },
  refiningBannerSub: {
    color: 'rgba(255,255,255,0.72)',
    fontSize: 11.5,
    fontWeight: '500',
    marginTop: 1,
  },
  logCardRefining: {
    borderWidth: 1.5,
    borderColor: plateColors.ink,
  },
  cardRefiningPill: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: '#EEF4FF',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
  cardRefiningPillText: {
    fontSize: 11.5,
    fontWeight: '700',
    color: plateColors.ink,
  },
  sectionHead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 19,
    fontWeight: '700',
    color: plateColors.ink,
    letterSpacing: -0.5,
  },
  sectionCount: {
    fontSize: 13,
    color: plateColors.muted,
  },
  emptyCard: {
    paddingVertical: 34,
    paddingHorizontal: 20,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: '#DADADF',
    borderRadius: 22,
    alignItems: 'center',
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: plateColors.ink,
    marginBottom: 4,
  },
  emptySub: {
    fontSize: 14,
    color: plateColors.muted,
  },
  logList: {
    gap: 10,
  },
  logCard: {
    flexDirection: 'row',
    backgroundColor: plateColors.card,
    borderRadius: 22,
    minHeight: 104,
    overflow: 'hidden',
  },
  logImgWrap: {
    width: 88,
    height: 88,
    margin: 8,
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: '#E6E6EB',
    position: 'relative',
  },
  logImg: {
    width: '100%',
    height: '100%',
  },
  logImgFallback: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  exIconTile: {
    width: 64,
    margin: 12,
    borderRadius: 16,
    backgroundColor: plateColors.chip,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logBody: {
    flex: 1,
    paddingVertical: 13,
    paddingRight: 14,
    paddingLeft: 4,
    justifyContent: 'center',
    gap: 6,
  },
  logTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  logName: {
    flex: 1,
    fontSize: 15,
    fontWeight: '600',
    color: plateColors.ink,
    letterSpacing: -0.3,
  },
  timePill: {
    backgroundColor: plateColors.chip,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  timePillText: {
    fontSize: 11.5,
    fontWeight: '500',
    color: plateColors.ink2,
  },
  logKcalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  logKcalBold: {
    fontSize: 18,
    fontWeight: '700',
    color: plateColors.ink,
    letterSpacing: -0.5,
    fontVariant: ['tabular-nums'],
  },
  logKcalLabel: {
    fontSize: 14,
    color: plateColors.ink2,
  },
  logSubText: {
    fontSize: 13,
    color: plateColors.muted,
  },
  macroMiniRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  macroMiniItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  macroMiniText: {
    fontSize: 13,
    fontWeight: '500',
    color: plateColors.ink2,
    fontVariant: ['tabular-nums'],
  },
  pendingScrim: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  pendingPct: {
    color: '#FFFFFF',
    fontSize: 12.5,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  pendingStatusText: {
    fontSize: 15,
    fontWeight: '600',
    color: plateColors.ink,
  },
  skeletonBar: {
    height: 10,
    borderRadius: 6,
    backgroundColor: '#E5E5EA',
  },
  skeletonRow: {
    flexDirection: 'row',
    gap: 8,
  },
  pendingNotify: {
    fontSize: 12,
    color: plateColors.muted,
  },
});
