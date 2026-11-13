import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import React from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { CalorieProvider } from '../context/CalorieContext';
import { plateColors } from '../theme/colors';

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <CalorieProvider>
        <StatusBar style="dark" />
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: plateColors.bg },
          }}
        >
          <Stack.Screen name="index" />
          <Stack.Screen
            name="onboarding"
            options={{ animation: 'fade', gestureEnabled: false }}
          />
          <Stack.Screen name="add-meal" options={{ animation: 'none' }} />
          <Stack.Screen name="settings" options={{ animation: 'none' }} />
          <Stack.Screen name="auth" />
        </Stack>
      </CalorieProvider>
    </SafeAreaProvider>
  );
}
