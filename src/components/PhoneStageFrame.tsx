import React, { useEffect, useState } from 'react';
import {
  Image,
  Platform,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { plateColors } from '../theme/colors';

interface PhoneStageFrameProps {
  children: React.ReactNode;
  lightStatusBar?: boolean;
}

export function useIsDesktopStage(): boolean {
  const { width } = useWindowDimensions();
  return Platform.OS === 'web' && width > 500;
}

function formatClock(d: Date): string {
  const h = d.getHours() % 12 || 12;
  const m = String(d.getMinutes()).padStart(2, '0');
  return `${h}:${m}`;
}

const PLATE_ICON_SOURCE = require('../../assets/icon.png');

export function PlateLogoMark({ size = 28 }: { size?: number }) {
  const radius = Math.round(size * 0.24);
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: radius,
        overflow: 'hidden',
        backgroundColor: plateColors.ink,
      }}
    >
      <Image
        source={PLATE_ICON_SOURCE}
        style={{ width: size, height: size }}
        resizeMode="cover"
      />
    </View>
  );
}

export function PhoneStageFrame({
  children,
  lightStatusBar = false,
}: PhoneStageFrameProps) {
  const { width: winW, height: winH } = useWindowDimensions();
  const [clockText, setClockText] = useState<string>(() =>
    formatClock(new Date())
  );

  useEffect(() => {
    const id = setInterval(() => {
      setClockText(formatClock(new Date()));
    }, 20000);
    return () => clearInterval(id);
  }, []);

  const isDesktopStage = Platform.OS === 'web' && winW > 500;

  if (!isDesktopStage) {
    return (
      <View style={styles.mobileRoot}>
        <SafeAreaView style={styles.mobileSafe} edges={['top']}>
          <View style={styles.mobileBody}>{children}</View>
        </SafeAreaView>
      </View>
    );
  }

  const scaleH = winH > 0 ? (winH - 44) / 868 : 1;
  const scaleW = winW > 0 ? (winW - 36) / 414 : 1;
  const scale = Math.max(0.55, Math.min(1, scaleH, scaleW));
  const statusColor = lightStatusBar ? '#FFFFFF' : plateColors.ink;

  const webDeviceExtra =
    Platform.OS === 'web'
      ? ({
          boxShadow:
            '0 0 0 11px #0B0B0C, 0 0 0 12px #3A3A40, 0 50px 100px -30px rgba(0,0,0,0.45)',
        } as object)
      : {};

  return (
    <View style={styles.stage}>
      <View
        style={[
          styles.device,
          webDeviceExtra,
          scale < 0.999 ? { transform: [{ scale }] } : null,
        ]}
      >
        {/* iPhone Status Bar + Dynamic Island */}
        <View style={styles.statusBar} pointerEvents="none">
          <Text style={[styles.clock, { color: statusColor }]}>{clockText}</Text>
          <View style={styles.island} />
          <View style={styles.sbIcons}>
            <View
              style={[
                styles.sigBar,
                { height: 5, backgroundColor: statusColor },
              ]}
            />
            <View
              style={[
                styles.sigBar,
                { height: 8, backgroundColor: statusColor },
              ]}
            />
            <View
              style={[
                styles.sigBar,
                { height: 11, backgroundColor: statusColor },
              ]}
            />
            <View style={[styles.battery, { borderColor: statusColor }]}>
              <View
                style={[styles.batteryFill, { backgroundColor: statusColor }]}
              />
            </View>
          </View>
        </View>

        <View style={styles.deviceViewport}>{children}</View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  mobileRoot: {
    flex: 1,
    backgroundColor: plateColors.bg,
  },
  mobileSafe: {
    flex: 1,
  },
  mobileBody: {
    flex: 1,
    position: 'relative',
    overflow: 'hidden',
  },
  stage: {
    flex: 1,
    backgroundColor: plateColors.stageBg,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  device: {
    width: 390,
    height: 844,
    backgroundColor: plateColors.bg,
    borderRadius: 54,
    overflow: 'hidden',
    position: 'relative',
  },
  statusBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 52,
    paddingTop: 16,
    paddingLeft: 36,
    paddingRight: 30,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    zIndex: 75,
  },
  clock: {
    fontSize: 15,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
  island: {
    position: 'absolute',
    top: 11,
    left: 135,
    width: 120,
    height: 34,
    borderRadius: 20,
    backgroundColor: '#000000',
  },
  sbIcons: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 3,
  },
  sigBar: {
    width: 3,
    borderRadius: 1,
  },
  battery: {
    width: 24,
    height: 11,
    borderWidth: 1.5,
    borderRadius: 3.5,
    marginLeft: 6,
    padding: 1.5,
    justifyContent: 'center',
  },
  batteryFill: {
    width: 15,
    height: 5,
    borderRadius: 1.5,
  },
  deviceViewport: {
    flex: 1,
    position: 'relative',
    overflow: 'hidden',
  },
});
