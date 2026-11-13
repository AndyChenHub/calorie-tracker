import { LinearGradient } from 'expo-linear-gradient';
import React, { useMemo, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { buildWeightSeries, formatNum } from '../constants/plateCatalog';
import { useCalorieTracker } from '../context/CalorieContext';
import { cardShadow, plateColors } from '../theme/colors';
import { toLocalDateKey } from '../utils/date';
import { useIsDesktopStage } from './PhoneStageFrame';
import {
  PlateIcon,
  WeekBarDayPoint,
  WeeklyMacroBarsChart,
  WeightAreaChart,
} from './PlatePrimitives';

const DAY_LETTERS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

interface PlateProgressViewProps {
  onOpenWeightSheet: () => void;
  onOpenProfileSheet: () => void;
}

export function PlateProgressView({
  onOpenWeightSheet,
  onOpenProfileSheet,
}: PlateProgressViewProps) {
  const isDesktopStage = useIsDesktopStage();
  const { profile, streakCount, dailySummaries, goals } = useCalorieTracker();
  const [range, setRange] = useState<30 | 90 | 180>(90);

  const todayKey = toLocalDateKey();

  const weightSeries = useMemo(() => buildWeightSeries(profile), [profile]);

  const totalSpan = Math.abs(profile.startWeightKg - profile.goalWeightKg);
  const progressDone = Math.abs(profile.startWeightKg - profile.weightKg);
  const progressPct =
    totalSpan > 0.05
      ? Math.max(0, Math.min(100, Math.round((progressDone / totalSpan) * 100)))
      : 100;
  const weightDelta = Number(
    Math.abs(profile.startWeightKg - profile.weightKg).toFixed(1)
  );

  // Current Monday..Sunday week
  const now = new Date();
  const dow = (now.getDay() + 6) % 7;
  const monday = new Date(now);
  monday.setDate(now.getDate() - dow);

  const weekPoints: WeekBarDayPoint[] = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    const key = toLocalDateKey(d);
    const sum = dailySummaries[key];
    return {
      dateKey: key,
      label: DAY_LETTERS[i],
      calories: sum?.calories ?? 0,
      protein: sum?.protein ?? 0,
      carbs: sum?.carbs ?? 0,
      fat: sum?.fat ?? 0,
    };
  });

  const weeklyTotalKcal = weekPoints.reduce((acc, d) => acc + d.calories, 0);

  // BMI calculation
  const heightMeters = Math.max(1.1, profile.heightCm / 100);
  const bmi = profile.weightKg / (heightMeters * heightMeters);
  const bmiPos = Math.max(2, Math.min(98, ((bmi - 15) / 25) * 100));

  const bmiBadge =
    bmi < 18.5
      ? { label: 'Underweight', bg: '#E8F0FE', fg: '#2F6FE0' }
      : bmi < 25
        ? { label: 'Healthy', bg: '#E6F8EE', fg: '#1E9E5A' }
        : bmi < 30
          ? { label: 'Overweight', bg: '#FFF5DC', fg: '#B7821A' }
          : { label: 'Obese', bg: '#FFE9E7', fg: '#D6453A' };

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={[
        styles.content,
        { paddingTop: isDesktopStage ? 58 : 10 },
      ]}
      showsVerticalScrollIndicator={false}
    >
      <Text style={styles.pageTitle}>Progress</Text>

      {/* Top 2-Column Row: Current Weight + Day Streak */}
      <View style={styles.grid2}>
        <View style={[styles.weightCard, cardShadow]}>
          <Text style={styles.cardMutedLabel}>Current weight</Text>
          <Text style={styles.weightBig}>
            {profile.weightKg.toFixed(1)}
            <Text style={styles.weightUnit}> kg</Text>
          </Text>
          <Text style={styles.goalLine}>
            {'Goal '}
            <Text style={styles.goalBold}>{`${profile.goalWeightKg} kg`}</Text>
          </Text>
          <View style={styles.progressTrack}>
            <View
              style={[styles.progressFill, { width: `${progressPct}%` }]}
            />
          </View>
          <Pressable
            onPress={onOpenWeightSheet}
            style={({ pressed }) => [
              styles.logWeightBtn,
              pressed ? { opacity: 0.85, transform: [{ scale: 0.98 }] } : null,
            ]}
          >
            <PlateIcon name="scale" size={15} color="#FFFFFF" />
            <Text style={styles.logWeightBtnText}>Log weight</Text>
          </Pressable>
        </View>

        <View style={[styles.streakCard, cardShadow]}>
          <View style={styles.bigFlameWrap}>
            <PlateIcon
              name="flame"
              size={50}
              color={plateColors.flame}
              fill="#FFB25B"
            />
          </View>
          <Text style={styles.streakBigNum}>{streakCount}</Text>
          <Text style={styles.cardMutedLabel}>Day streak</Text>

          <View style={styles.streakDotsRow}>
            {weekPoints.map((pt) => {
              const logged = pt.calories > 0;
              return (
                <View
                  key={pt.dateKey}
                  style={[
                    styles.streakDot,
                    logged ? styles.streakDotActive : null,
                  ]}
                >
                  <Text
                    style={[
                      styles.streakDotText,
                      logged ? styles.streakDotTextActive : null,
                    ]}
                  >
                    {pt.label}
                  </Text>
                </View>
              );
            })}
          </View>
        </View>
      </View>

      {/* Goal Progress Bezier Area Chart */}
      <View style={[styles.chartCard, cardShadow]}>
        <View style={styles.chartHeader}>
          <Text style={styles.chartTitle}>Goal progress</Text>
          <View style={styles.deltaBadge}>
            <PlateIcon name="down" size={13} color={plateColors.ok} />
            <Text style={styles.deltaText}>
              {`${weightDelta} kg · ${progressPct}% to goal`}
            </Text>
          </View>
        </View>

        <View style={styles.segmentedBar}>
          {(
            [
              [30, '1M'],
              [90, '3M'],
              [180, '6M'],
            ] as const
          ).map(([val, label]) => {
            const active = range === val;
            return (
              <Pressable
                key={val}
                onPress={() => setRange(val)}
                style={[styles.segBtn, active ? styles.segBtnActive : null]}
              >
                <Text
                  style={[
                    styles.segBtnText,
                    active ? styles.segBtnTextActive : null,
                  ]}
                >
                  {label}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <WeightAreaChart
          series={weightSeries}
          range={range}
          goalWeight={profile.goalWeightKg}
        />
      </View>

      {/* This Week's Energy Stacked Bar Chart */}
      <View style={[styles.chartCard, cardShadow]}>
        <View style={styles.chartHeader}>
          <Text style={styles.chartTitle}>{"This week's energy"}</Text>
          <Text style={styles.chartRightMuted}>
            {`${formatNum(weeklyTotalKcal)} kcal`}
          </Text>
        </View>

        <View style={{ marginTop: 6 }}>
          <WeeklyMacroBarsChart
            days={weekPoints}
            calorieGoal={goals.dailyCalories}
            todayKey={todayKey}
          />
        </View>

        <View style={styles.legendRow}>
          <View style={styles.legendItem}>
            <View
              style={[
                styles.legendSwatch,
                { backgroundColor: plateColors.protein },
              ]}
            />
            <Text style={styles.legendLabel}>Protein</Text>
          </View>
          <View style={styles.legendItem}>
            <View
              style={[
                styles.legendSwatch,
                { backgroundColor: plateColors.carbs },
              ]}
            />
            <Text style={styles.legendLabel}>Carbs</Text>
          </View>
          <View style={styles.legendItem}>
            <View
              style={[styles.legendSwatch, { backgroundColor: plateColors.fat }]}
            />
            <Text style={styles.legendLabel}>Fats</Text>
          </View>
        </View>
      </View>

      {/* BMI Card */}
      <Pressable
        onPress={onOpenProfileSheet}
        style={({ pressed }) => [
          styles.chartCard,
          cardShadow,
          pressed ? { opacity: 0.95 } : null,
        ]}
      >
        <View style={styles.chartHeader}>
          <Text style={styles.chartTitle}>Your BMI</Text>
          <Text style={styles.chartRightMuted}>{`${profile.heightCm} cm`}</Text>
        </View>

        <View style={styles.bmiValueRow}>
          <Text style={styles.bmiBigNum}>{bmi.toFixed(1)}</Text>
          <View style={[styles.bmiTag, { backgroundColor: bmiBadge.bg }]}>
            <Text style={[styles.bmiTagText, { color: bmiBadge.fg }]}>
              {bmiBadge.label}
            </Text>
          </View>
        </View>

        <View style={styles.bmiSpectrumContainer}>
          <LinearGradient
            colors={['#4C8DF6', '#34C77B', '#34C77B', '#F0C23B', '#F2665A']}
            locations={[0, 0.28, 0.48, 0.66, 1]}
            start={{ x: 0, y: 0.5 }}
            end={{ x: 1, y: 0.5 }}
            style={styles.bmiGradientBar}
          />
          <View style={[styles.bmiThumb, { left: `${bmiPos}%` }]} />
        </View>

        <View style={styles.legendRow}>
          <View style={styles.legendItem}>
            <View
              style={[styles.legendSwatch, { backgroundColor: plateColors.fat }]}
            />
            <Text style={styles.legendLabel}>Under</Text>
          </View>
          <View style={styles.legendItem}>
            <View
              style={[styles.legendSwatch, { backgroundColor: plateColors.ok }]}
            />
            <Text style={styles.legendLabel}>Healthy</Text>
          </View>
          <View style={styles.legendItem}>
            <View style={[styles.legendSwatch, { backgroundColor: '#F0C23B' }]} />
            <Text style={styles.legendLabel}>Over</Text>
          </View>
          <View style={styles.legendItem}>
            <View
              style={[
                styles.legendSwatch,
                { backgroundColor: plateColors.protein },
              ]}
            />
            <Text style={styles.legendLabel}>Obese</Text>
          </View>
        </View>
      </Pressable>
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
    paddingBottom: 128,
  },
  pageTitle: {
    fontSize: 30,
    fontWeight: '700',
    color: plateColors.ink,
    letterSpacing: -1.1,
    marginTop: 4,
    marginBottom: 18,
  },
  grid2: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 12,
  },
  weightCard: {
    flex: 1,
    backgroundColor: plateColors.card,
    borderRadius: 26,
    padding: 18,
    gap: 10,
  },
  cardMutedLabel: {
    fontSize: 13,
    fontWeight: '500',
    color: plateColors.muted,
  },
  weightBig: {
    fontSize: 30,
    fontWeight: '700',
    color: plateColors.ink,
    lineHeight: 32,
    letterSpacing: -0.9,
    fontVariant: ['tabular-nums'],
  },
  weightUnit: {
    fontSize: 15,
    fontWeight: '600',
    color: plateColors.muted,
  },
  goalLine: {
    fontSize: 13,
    color: plateColors.ink2,
  },
  goalBold: {
    fontWeight: '700',
  },
  progressTrack: {
    height: 8,
    borderRadius: 8,
    backgroundColor: plateColors.chip,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 8,
    backgroundColor: plateColors.ink,
  },
  logWeightBtn: {
    height: 38,
    borderRadius: 12,
    backgroundColor: plateColors.ink,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: 2,
  },
  logWeightBtnText: {
    color: '#FFFFFF',
    fontSize: 13.5,
    fontWeight: '600',
  },
  streakCard: {
    flex: 1,
    backgroundColor: plateColors.card,
    borderRadius: 26,
    padding: 16,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
  },
  bigFlameWrap: {
    marginBottom: 2,
  },
  streakBigNum: {
    fontSize: 26,
    fontWeight: '700',
    color: plateColors.ink,
    fontVariant: ['tabular-nums'],
  },
  streakDotsRow: {
    flexDirection: 'row',
    gap: 4,
    marginTop: 6,
  },
  streakDot: {
    width: 19,
    height: 19,
    borderRadius: 10,
    backgroundColor: plateColors.chip,
    alignItems: 'center',
    justifyContent: 'center',
  },
  streakDotActive: {
    backgroundColor: plateColors.flame,
  },
  streakDotText: {
    fontSize: 9.5,
    fontWeight: '700',
    color: plateColors.muted,
  },
  streakDotTextActive: {
    color: '#FFFFFF',
  },
  chartCard: {
    backgroundColor: plateColors.card,
    borderRadius: 26,
    paddingHorizontal: 18,
    paddingTop: 18,
    paddingBottom: 15,
    marginBottom: 12,
  },
  chartHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  chartTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: plateColors.ink,
    letterSpacing: -0.3,
  },
  chartRightMuted: {
    fontSize: 13,
    color: plateColors.muted,
    fontVariant: ['tabular-nums'],
  },
  deltaBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  deltaText: {
    fontSize: 13,
    fontWeight: '600',
    color: plateColors.ok,
    fontVariant: ['tabular-nums'],
  },
  segmentedBar: {
    flexDirection: 'row',
    backgroundColor: plateColors.chip,
    borderRadius: 12,
    padding: 3,
    marginTop: 12,
    marginBottom: 8,
  },
  segBtn: {
    flex: 1,
    height: 30,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  segBtnActive: {
    backgroundColor: '#FFFFFF',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 3,
    elevation: 1,
  },
  segBtnText: {
    fontSize: 13,
    fontWeight: '600',
    color: plateColors.muted,
  },
  segBtnTextActive: {
    color: plateColors.ink,
  },
  legendRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 14,
    marginTop: 8,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  legendSwatch: {
    width: 8,
    height: 8,
    borderRadius: 3,
  },
  legendLabel: {
    fontSize: 12,
    fontWeight: '500',
    color: plateColors.ink2,
  },
  bmiValueRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 10,
  },
  bmiBigNum: {
    fontSize: 30,
    fontWeight: '700',
    color: plateColors.ink,
    fontVariant: ['tabular-nums'],
    letterSpacing: -0.9,
  },
  bmiTag: {
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 8,
  },
  bmiTagText: {
    fontSize: 12,
    fontWeight: '700',
  },
  bmiSpectrumContainer: {
    position: 'relative',
    height: 22,
    justifyContent: 'center',
    marginTop: 14,
    marginBottom: 8,
  },
  bmiGradientBar: {
    height: 10,
    borderRadius: 10,
    width: '100%',
  },
  bmiThumb: {
    position: 'absolute',
    width: 8,
    height: 22,
    marginLeft: -4,
    borderRadius: 4,
    backgroundColor: plateColors.ink,
    borderWidth: 2,
    borderColor: '#FFFFFF',
  },
});
