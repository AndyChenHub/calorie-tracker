import * as Application from 'expo-application';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import { Platform } from 'react-native';

/**
 * Synchronized by `scripts/bump-version.mjs` alongside `package.json`, `app.json`, and `backend/server.py`.
 */
export const FALLBACK_APP_VERSION = '1.1.5';
export const FALLBACK_BUILD_NUMBER = '7';
export const EXPO_SDK_MAJOR = '58';
export const RELEASE_DATE = '2026-11-14';

export interface AppVersionMetadata {
  version: string;
  buildNumber: string;
  runtimeVersion: string;
  sdkLabel: string;
  environmentLabel: string;
  releaseDate: string;
  shortBadge: string;
  fullBadge: string;
}

export function getAppVersionMetadata(): AppVersionMetadata {
  const isStandaloneOrBare =
    Constants.executionEnvironment === ExecutionEnvironment.Standalone ||
    Constants.executionEnvironment === ExecutionEnvironment.Bare;

  const configVersion = Constants.expoConfig?.version || FALLBACK_APP_VERSION;
  const configBuild =
    Platform.OS === 'android'
      ? String(
          Constants.expoConfig?.android?.versionCode ?? FALLBACK_BUILD_NUMBER
        )
      : String(Constants.expoConfig?.ios?.buildNumber ?? FALLBACK_BUILD_NUMBER);

  const version =
    isStandaloneOrBare && Application.nativeApplicationVersion
      ? Application.nativeApplicationVersion
      : configVersion;

  const buildNumber =
    isStandaloneOrBare && Application.nativeBuildVersion
      ? Application.nativeBuildVersion
      : configBuild;

  const runtimeVersion = Constants.expoRuntimeVersion || version;

  const extra = (Constants.expoConfig?.extra ?? {}) as {
    releaseDate?: string;
  };
  const releaseDate = extra.releaseDate || RELEASE_DATE;

  let environmentLabel = 'Native';
  if (Platform.OS === 'web') {
    environmentLabel = 'Web';
  } else if (Constants.executionEnvironment === ExecutionEnvironment.StoreClient) {
    environmentLabel = 'Expo Go';
  } else if (Platform.OS === 'ios') {
    environmentLabel = 'iOS';
  } else if (Platform.OS === 'android') {
    environmentLabel = 'Android';
  }

  return {
    version,
    buildNumber,
    runtimeVersion,
    sdkLabel: `SDK ${EXPO_SDK_MAJOR}`,
    environmentLabel,
    releaseDate,
    shortBadge: `v${version}`,
    fullBadge: `v${version} · Build ${buildNumber}`,
  };
}
