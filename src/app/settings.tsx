import { Redirect } from 'expo-router';
import React, { useEffect } from 'react';
import { useCalorieTracker } from '../context/CalorieContext';

export default function SettingsRouteRedirect() {
  const { setActiveTab } = useCalorieTracker();

  useEffect(() => {
    setActiveTab('settings');
  }, [setActiveTab]);

  return <Redirect href="/" />;
}
