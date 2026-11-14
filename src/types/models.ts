export type MealType = 'breakfast' | 'lunch' | 'dinner' | 'snack';

export type AIProviderId = 'antigravity' | 'claude' | 'gpt';

export type ExerciseIconName = 'activity' | 'dumbbell' | 'walk';

export interface MealItem {
  id: string;
  name: string;
  grams?: number | null;
  portion?: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
}

export interface MealEntry {
  id: string;
  /** Local calendar date in YYYY-MM-DD format */
  dateKey: string;
  createdAt: string;
  mealType: MealType;
  title: string;
  photoUri?: string | null;
  userNotes?: string;
  aiProvider?: AIProviderId | 'manual';
  aiSummary?: string;
  confidence?: 'high' | 'medium' | 'low';
  /** Base calories & macros for 1 serving (multiplied by `servings` for food entries) */
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  items: MealItem[];
  /** Plate UI extensions */
  entryType?: 'food' | 'exercise';
  presetFoodId?: string;
  servings?: number;
  healthScore?: number;
  status?: 'pending' | 'done';
  progress?: number;
  exerciseMinutes?: number;
  exerciseIntensity?: 'Low' | 'Medium' | 'High';
  exerciseIcon?: ExerciseIconName;
}

export interface UserGoals {
  dailyCalories: number;
  proteinGrams: number;
  carbsGrams: number;
  fatGrams: number;
  waterGlasses: number;
  dailySteps: number;
}

export interface WeightLogPoint {
  dateKey: string;
  weightKg: number;
}

export interface UserProfile {
  name: string;
  weightKg: number;
  goalWeightKg: number;
  startWeightKg: number;
  heightCm: number;
  weightHistory?: WeightLogPoint[];
}

export interface AppPreferences {
  addBurned: boolean;
  rollover: boolean;
  reminders: boolean;
  showEaten: boolean;
}

export interface ChatGPTOnDeviceSession {
  connected: boolean;
  accessToken: string;
  refreshToken: string;
  clientId: string;
  extAgentHostId: string;
  /** Unix timestamp in seconds (0 if non-expiring) */
  expiresAt: number;
  scope?: string;
  email?: string;
  name?: string;
  chatgptAccountId?: string;
  oauthMode?: 'siwc' | 'codex';
}

export interface ProviderAuthConfig {
  activeProvider: AIProviderId;
  /** Optional Companion Python server URL for local desktop Antigravity SDK / loopback */
  companionUrl: string;
  companionToken: string;
  /** Direct provider API keys authorized on each provider's website and stored securely on-device */
  claudeApiKey: string;
  openaiApiKey: string;
  geminiApiKey: string;
  /** Serverless on-device ChatGPT OAuth 2.0 + PKCE session stored in iOS Keychain */
  chatgptOAuth?: ChatGPTOnDeviceSession;
  /** Preferred models */
  claudeModel: string;
  gptModel: string;
  geminiModel: string;
}

export interface AIMealAnalysisResult {
  title: string;
  summary: string;
  confidence: 'high' | 'medium' | 'low';
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  healthScore?: number;
  items: MealItem[];
  providerUsed: AIProviderId;
  modelUsed?: string;
}

export interface DailySummary {
  dateKey: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  burnedCalories: number;
  mealCount: number;
}

export interface CompanionStatusResponse {
  ok: boolean;
  service: string;
  version?: string;
  antigravitySdkInstalled: boolean;
  antigravityCliDetected: boolean;
  antigravityReady: boolean;
  lanUrls?: string[];
  chatgptOAuth?: {
    connected: boolean;
    email?: string | null;
    name?: string | null;
    directTokensScope?: boolean;
  };
  googleOAuth?: {
    configured: boolean;
    connected: boolean;
    email?: string | null;
  };
  serverProviders: {
    antigravity: boolean;
    claude: boolean;
    gpt: boolean;
    gemini: boolean;
  };
  message: string;
}

export type AILogLevel = 'info' | 'ok' | 'warn' | 'error';

export interface AIDiagnosticLogEntry {
  id: string;
  timestamp: string;
  level: AILogLevel;
  scope: string;
  message: string;
  detail?: string;
}

export interface AIConnectionTestResult {
  ok: boolean;
  provider: AIProviderId;
  authMethod: string;
  modelUsed?: string;
  endpoint?: string;
  httpStatus?: number;
  latencyMs: number;
  replyText?: string;
  errorMessage?: string;
  timestamp: string;
}

export interface AIErrorReport {
  title: string;
  message: string;
  provider: AIProviderId;
  timestamp: string;
}
