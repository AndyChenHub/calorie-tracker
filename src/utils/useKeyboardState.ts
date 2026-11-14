import { useEffect, useState } from 'react';
import { Keyboard, Platform } from 'react-native';

export interface KeyboardState {
  visible: boolean;
  height: number;
}

/**
 * Tracks software keyboard visibility and height across iOS and Android
 * using React Native's standard Keyboard event listeners.
 */
export function useKeyboardState(): KeyboardState {
  const [state, setState] = useState<KeyboardState>({
    visible: false,
    height: 0,
  });

  useEffect(() => {
    if (Platform.OS === 'web') return;

    const onShow = (e: { endCoordinates?: { height?: number } }) => {
      const h = Math.max(0, Math.round(e.endCoordinates?.height ?? 0));
      setState({ visible: h > 0, height: h });
    };
    const onHide = () => {
      setState({ visible: false, height: 0 });
    };

    const subs = [
      Keyboard.addListener('keyboardDidShow', onShow),
      Keyboard.addListener('keyboardDidHide', onHide),
      ...(Platform.OS === 'ios'
        ? [
            Keyboard.addListener('keyboardWillShow', onShow),
            Keyboard.addListener('keyboardWillHide', onHide),
          ]
        : []),
    ];

    return () => {
      for (const s of subs) {
        s.remove();
      }
    };
  }, []);

  return state;
}
