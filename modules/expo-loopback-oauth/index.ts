import { requireOptionalNativeModule } from 'expo-modules-core';

export interface LoopbackServerInfo {
  port: number;
  redirectUri: string;
  loopbackIpUri: string;
}

interface ExpoLoopbackOAuthNativeModule {
  startServerAsync(
    preferredPort: number,
    allowFallback: boolean
  ): Promise<LoopbackServerInfo>;
  waitForCallbackAsync(timeoutMs: number): Promise<string>;
  stopServerAsync(): Promise<void>;
}

const NativeLoopback =
  requireOptionalNativeModule<ExpoLoopbackOAuthNativeModule>(
    'ExpoLoopbackOAuth'
  );

export function isLoopbackOAuthSupported(): boolean {
  return Boolean(NativeLoopback);
}

export async function startLoopbackOAuthServer(
  preferredPort: number = 1455,
  allowFallback: boolean = true
): Promise<LoopbackServerInfo | null> {
  if (!NativeLoopback) {
    return null;
  }
  return NativeLoopback.startServerAsync(preferredPort, allowFallback);
}

export async function waitForLoopbackOAuthCallback(
  timeoutMs: number = 180000
): Promise<string> {
  if (!NativeLoopback) {
    throw new Error('Native loopback OAuth module is not available.');
  }
  return NativeLoopback.waitForCallbackAsync(timeoutMs);
}

export async function stopLoopbackOAuthServer(): Promise<void> {
  if (!NativeLoopback) {
    return;
  }
  try {
    await NativeLoopback.stopServerAsync();
  } catch {
    // ignore cleanup errors
  }
}
