import { Redirect } from 'expo-router';
import React, { useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { PhoneStageFrame } from '../components/PhoneStageFrame';
import { PlateHomeView } from '../components/PlateHomeView';
import {
  ActiveSheetType,
  PlateOverlays,
} from '../components/PlateOverlays';
import { PlateProgressView } from '../components/PlateProgressView';
import { PlateSettingsView } from '../components/PlateSettingsView';
import { useCalorieTracker } from '../context/CalorieContext';
import { plateColors } from '../theme/colors';
import { MealEntry } from '../types/models';

export default function MainPlateScreen() {
  const {
    isReady,
    hasCompletedOnboarding,
    activeTab,
    scannerOpen,
    detailEntryId,
  } = useCalorieTracker();

  const [activeSheet, setActiveSheet] = useState<ActiveSheetType>(null);
  const [selectedExercise, setSelectedExercise] = useState<MealEntry | null>(
    null
  );

  if (!isReady) {
    return (
      <PhoneStageFrame>
        <View style={styles.loadingWrap}>
          <ActivityIndicator size="large" color={plateColors.ink} />
        </View>
      </PhoneStageFrame>
    );
  }

  if (!hasCompletedOnboarding) {
    return <Redirect href="/onboarding" />;
  }

  const lightStatusBar = Boolean(scannerOpen) || Boolean(detailEntryId);

  return (
    <PhoneStageFrame lightStatusBar={lightStatusBar}>
      <View style={styles.container}>
        {activeTab === 'home' ? (
          <PlateHomeView
            onOpenStepsSheet={() => setActiveSheet('steps')}
            onOpenWaterSheet={() => setActiveSheet('water')}
            onSelectExercise={(entry) => {
              setSelectedExercise(entry);
              setActiveSheet('exerciseDetail');
            }}
          />
        ) : null}

        {activeTab === 'progress' ? (
          <PlateProgressView
            onOpenWeightSheet={() => setActiveSheet('weight')}
            onOpenProfileSheet={() => setActiveSheet('profile')}
          />
        ) : null}

        {activeTab === 'settings' ? (
          <PlateSettingsView
            onOpenProfileSheet={() => setActiveSheet('profile')}
          />
        ) : null}

        <PlateOverlays
          activeSheet={activeSheet}
          selectedExercise={selectedExercise}
          onChangeSheet={(next) => {
            setActiveSheet(next);
            if (!next) setSelectedExercise(null);
          }}
        />
      </View>
    </PhoneStageFrame>
  );
}

const styles = StyleSheet.create({
  loadingWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: plateColors.bg,
  },
  container: {
    flex: 1,
    backgroundColor: plateColors.bg,
    position: 'relative',
  },
});
