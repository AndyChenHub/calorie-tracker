import { Redirect } from 'expo-router';
import React, { useEffect } from 'react';
import { useCalorieTracker } from '../context/CalorieContext';

export default function AddMealRouteRedirect() {
  const { setActiveTab, setScannerOpen } = useCalorieTracker();

  useEffect(() => {
    setActiveTab('home');
    setScannerOpen(true);
  }, [setActiveTab, setScannerOpen]);

  return <Redirect href="/" />;
}
