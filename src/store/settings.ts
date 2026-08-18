import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { create } from 'zustand';

import { LLM_PROVIDERS, STT_PROVIDERS, type LlmConfig, type LlmProviderId, type SttConfig, type SttProviderId } from '../ai/types';

const PREFS_KEY = 'sar.settings.v1';
const LLM_KEY_SECRET = 'sar_llm_api_key';
const STT_KEY_SECRET = 'sar_stt_api_key';

type StoredPrefs = {
  llmProvider: LlmProviderId;
  llmModel: string;
  llmBaseUrl: string;
  sttProvider: SttProviderId;
  sttModel: string;
  sttBaseUrl: string;
  sttLanguage: string;
  defaultPlatform: string;
  keepWorkFiles: boolean;
};

type SettingsState = StoredPrefs & {
  llmApiKey: string;
  sttApiKey: string;
  hydrated: boolean;

  hydrate: () => Promise<void>;
  setLlmProvider: (provider: LlmProviderId) => void;
  setSttProvider: (provider: SttProviderId) => void;
  update: (patch: Partial<StoredPrefs>) => void;
  setLlmApiKey: (key: string) => Promise<void>;
  setSttApiKey: (key: string) => Promise<void>;
  llmConfig: () => LlmConfig;
  sttConfig: () => SttConfig;
  isLlmReady: () => boolean;
  isSttReady: () => boolean;
};

const DEFAULTS: StoredPrefs = {
  llmProvider: 'anthropic',
  llmModel: LLM_PROVIDERS.anthropic.defaultModel,
  llmBaseUrl: '',
  sttProvider: 'openai',
  sttModel: STT_PROVIDERS.openai.defaultModel,
  sttBaseUrl: '',
  sttLanguage: '',
  defaultPlatform: 'instagram_reels',
  keepWorkFiles: false,
};

/**
 * API keys live in the Android keystore via SecureStore, never in AsyncStorage
 * alongside the rest of the preferences — they are the one thing here worth
 * protecting if the device is backed up or inspected.
 */
export const useSettings = create<SettingsState>((set, get) => ({
  ...DEFAULTS,
  llmApiKey: '',
  sttApiKey: '',
  hydrated: false,

  hydrate: async () => {
    const [rawPrefs, llmApiKey, sttApiKey] = await Promise.all([
      AsyncStorage.getItem(PREFS_KEY),
      SecureStore.getItemAsync(LLM_KEY_SECRET).catch(() => null),
      SecureStore.getItemAsync(STT_KEY_SECRET).catch(() => null),
    ]);

    let prefs = DEFAULTS;
    if (rawPrefs) {
      try {
        prefs = { ...DEFAULTS, ...(JSON.parse(rawPrefs) as Partial<StoredPrefs>) };
      } catch {
        // Corrupted preferences should not stop the app from starting.
      }
    }

    set({ ...prefs, llmApiKey: llmApiKey ?? '', sttApiKey: sttApiKey ?? '', hydrated: true });
  },

  setLlmProvider: (provider) => {
    const info = LLM_PROVIDERS[provider];
    const patch = { llmProvider: provider, llmModel: info.defaultModel, llmBaseUrl: '' };
    set(patch);
    persist(get());
  },

  setSttProvider: (provider) => {
    const info = STT_PROVIDERS[provider];
    const patch = { sttProvider: provider, sttModel: info.defaultModel, sttBaseUrl: '' };
    set(patch);
    persist(get());
  },

  update: (patch) => {
    set(patch as Partial<SettingsState>);
    persist(get());
  },

  setLlmApiKey: async (key) => {
    set({ llmApiKey: key });
    if (key) await SecureStore.setItemAsync(LLM_KEY_SECRET, key);
    else await SecureStore.deleteItemAsync(LLM_KEY_SECRET).catch(() => undefined);
  },

  setSttApiKey: async (key) => {
    set({ sttApiKey: key });
    if (key) await SecureStore.setItemAsync(STT_KEY_SECRET, key);
    else await SecureStore.deleteItemAsync(STT_KEY_SECRET).catch(() => undefined);
  },

  llmConfig: () => {
    const state = get();
    return {
      provider: state.llmProvider,
      apiKey: state.llmApiKey,
      baseUrl: state.llmBaseUrl || undefined,
      model: state.llmModel,
    };
  },

  sttConfig: () => {
    const state = get();
    return {
      provider: state.sttProvider,
      apiKey: state.sttApiKey,
      baseUrl: state.sttBaseUrl || undefined,
      model: state.sttModel,
      language: state.sttLanguage || undefined,
    };
  },

  isLlmReady: () => Boolean(get().llmApiKey && get().llmModel),
  isSttReady: () => Boolean(get().sttApiKey && get().sttModel),
}));

let persistTimer: ReturnType<typeof setTimeout> | null = null;

/** Debounced so dragging a slider does not hammer AsyncStorage. */
function persist(state: SettingsState): void {
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    const prefs: StoredPrefs = {
      llmProvider: state.llmProvider,
      llmModel: state.llmModel,
      llmBaseUrl: state.llmBaseUrl,
      sttProvider: state.sttProvider,
      sttModel: state.sttModel,
      sttBaseUrl: state.sttBaseUrl,
      sttLanguage: state.sttLanguage,
      defaultPlatform: state.defaultPlatform,
      keepWorkFiles: state.keepWorkFiles,
    };
    AsyncStorage.setItem(PREFS_KEY, JSON.stringify(prefs)).catch(() => undefined);
  }, 250);
}
