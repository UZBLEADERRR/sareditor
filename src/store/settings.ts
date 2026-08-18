import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { create } from 'zustand';

import type { ModelOption } from '../ai/models';
import { type LlmConfig, type LlmProviderId, type SttConfig, type SttProviderId } from '../ai/types';
import { VOICE_PROVIDERS, type VoiceConfig, type VoiceOption, type VoiceProviderId } from '../ai/voice';

const PREFS_KEY = 'sar.settings.v1';
const LLM_KEY_SECRET = 'sar_llm_api_key';
const STT_KEY_SECRET = 'sar_stt_api_key';
const VOICE_KEY_SECRET = 'sar_voice_api_key';

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
  /** Last catalogue fetched from the provider, so the picker survives a restart. */
  llmModelOptions: ModelOption[];
  sttModelOptions: ModelOption[];
  /** Model used to draw illustrations; shares the AI provider's key. */
  imageModel: string;
  imageModelOptions: ModelOption[];
  autoImages: boolean;
  /** Text-to-speech. The device engine is the default because it costs nothing. */
  voiceProvider: VoiceProviderId;
  voiceModel: string;
  voiceBaseUrl: string;
  voiceId: string;
  voiceLanguage: string;
  voiceOptions: VoiceOption[];
};

type SettingsState = StoredPrefs & {
  llmApiKey: string;
  sttApiKey: string;
  voiceApiKey: string;
  hydrated: boolean;

  hydrate: () => Promise<void>;
  setLlmProvider: (provider: LlmProviderId) => void;
  setSttProvider: (provider: SttProviderId) => void;
  setLlmModelOptions: (options: ModelOption[]) => void;
  setSttModelOptions: (options: ModelOption[]) => void;
  setImageModelOptions: (options: ModelOption[]) => void;
  update: (patch: Partial<StoredPrefs>) => void;
  setLlmApiKey: (key: string) => Promise<void>;
  setSttApiKey: (key: string) => Promise<void>;
  setVoiceApiKey: (key: string) => Promise<void>;
  setVoiceProvider: (provider: VoiceProviderId) => void;
  setVoiceOptions: (options: VoiceOption[]) => void;
  llmConfig: () => LlmConfig;
  sttConfig: () => SttConfig;
  imageConfig: () => LlmConfig & { methods?: string[] };
  voiceConfig: () => VoiceConfig;
  voiceLabel: () => string;
  isLlmReady: () => boolean;
  isSttReady: () => boolean;
  isImageReady: () => boolean;
  isVoiceReady: () => boolean;
};

/**
 * No model names live here. The provider's own catalogue is fetched with the
 * user's key and the chosen id is stored — a baked-in default would be stale
 * the moment the provider ships something newer.
 */
const DEFAULTS: StoredPrefs = {
  llmProvider: 'gemini',
  llmModel: '',
  llmBaseUrl: '',
  sttProvider: 'gemini',
  sttModel: '',
  sttBaseUrl: '',
  sttLanguage: '',
  defaultPlatform: 'instagram_reels',
  keepWorkFiles: false,
  llmModelOptions: [],
  sttModelOptions: [],
  imageModel: '',
  imageModelOptions: [],
  autoImages: true,
  voiceProvider: 'device',
  voiceModel: '',
  voiceBaseUrl: '',
  voiceId: '',
  voiceLanguage: '',
  voiceOptions: [],
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
  voiceApiKey: '',
  hydrated: false,

  hydrate: async () => {
    const [rawPrefs, llmApiKey, sttApiKey, voiceApiKey] = await Promise.all([
      AsyncStorage.getItem(PREFS_KEY),
      SecureStore.getItemAsync(LLM_KEY_SECRET).catch(() => null),
      SecureStore.getItemAsync(STT_KEY_SECRET).catch(() => null),
      SecureStore.getItemAsync(VOICE_KEY_SECRET).catch(() => null),
    ]);

    let prefs = DEFAULTS;
    if (rawPrefs) {
      try {
        prefs = { ...DEFAULTS, ...(JSON.parse(rawPrefs) as Partial<StoredPrefs>) };
      } catch {
        // Corrupted preferences should not stop the app from starting.
      }
    }

    set({
      ...prefs,
      llmApiKey: llmApiKey ?? '',
      sttApiKey: sttApiKey ?? '',
      voiceApiKey: voiceApiKey ?? '',
      hydrated: true,
    });
  },

  setLlmProvider: (provider) => {
    // The previous provider's catalogue means nothing to the new one.
    set({
      llmProvider: provider,
      llmModel: '',
      llmBaseUrl: '',
      llmModelOptions: [],
      imageModel: '',
      imageModelOptions: [],
    });
    persist(get());
  },

  setSttProvider: (provider) => {
    set({ sttProvider: provider, sttModel: '', sttBaseUrl: '', sttModelOptions: [] });
    persist(get());
  },

  setLlmModelOptions: (options) => {
    set({ llmModelOptions: options });
    persist(get());
  },

  setSttModelOptions: (options) => {
    set({ sttModelOptions: options });
    persist(get());
  },

  setImageModelOptions: (options) => {
    set({ imageModelOptions: options });
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

  setVoiceApiKey: async (key) => {
    set({ voiceApiKey: key });
    if (key) await SecureStore.setItemAsync(VOICE_KEY_SECRET, key);
    else await SecureStore.deleteItemAsync(VOICE_KEY_SECRET).catch(() => undefined);
  },

  setVoiceProvider: (provider) => {
    // Voice ids belong to one provider only; keeping the old one would send
    // ElevenLabs an OpenAI voice name.
    set({ voiceProvider: provider, voiceId: '', voiceModel: '', voiceBaseUrl: '', voiceOptions: [] });
    persist(get());
  },

  setVoiceOptions: (options) => {
    set({ voiceOptions: options });
    persist(get());
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
      apiKey: effectiveSttKey(state),
      baseUrl: state.sttBaseUrl || undefined,
      model: state.sttModel,
      language: state.sttLanguage || undefined,
    };
  },

  imageConfig: () => {
    const state = get();
    return {
      provider: state.llmProvider,
      apiKey: state.llmApiKey,
      baseUrl: state.llmBaseUrl || undefined,
      model: state.imageModel,
      // The endpoint shape depends on what the catalogue said this model does.
      methods: state.imageModelOptions.find((option) => option.id === state.imageModel)?.methods,
    };
  },

  voiceConfig: () => {
    const state = get();
    return {
      provider: state.voiceProvider,
      apiKey: effectiveVoiceKey(state),
      baseUrl: state.voiceBaseUrl || undefined,
      model: state.voiceModel || undefined,
      voiceId: state.voiceId || undefined,
      language: state.voiceLanguage || undefined,
    };
  },

  voiceLabel: () => {
    const state = get();
    const provider = VOICE_PROVIDERS[state.voiceProvider].label;
    const voice = state.voiceOptions.find((option) => option.id === state.voiceId)?.label ?? state.voiceId;
    return voice ? `${provider} · ${voice}` : provider;
  },

  isLlmReady: () => Boolean(get().llmApiKey && get().llmModel),
  isSttReady: () => Boolean(effectiveSttKey(get()) && get().sttModel),
  isImageReady: () => Boolean(get().llmApiKey && get().imageModel && get().llmProvider === 'gemini'),

  // The phone's own engine needs nothing at all, which is why it is the default.
  isVoiceReady: () => {
    const state = get();
    if (state.voiceProvider === 'device') return true;
    if (!effectiveVoiceKey(state)) return false;
    return state.voiceProvider === 'gemini' ? Boolean(state.voiceModel) : Boolean(state.voiceId);
  },
}));

/** ElevenLabs always needs its own key; the others can share the model key. */
function effectiveVoiceKey(state: SettingsState): string {
  if (state.voiceApiKey) return state.voiceApiKey;
  if (state.voiceProvider === 'elevenlabs' || state.voiceProvider === 'device') return '';
  return state.voiceProvider === state.llmProvider ? state.llmApiKey : '';
}

/**
 * One provider, one key. When both halves point at the same provider the user
 * should not have to paste the same key twice, so the speech side falls back to
 * the model key unless it has one of its own.
 */
function effectiveSttKey(state: SettingsState): string {
  if (state.sttApiKey) return state.sttApiKey;
  return state.sttProvider === state.llmProvider ? state.llmApiKey : '';
}

export function sttKeyIsShared(state: {
  sttApiKey: string;
  sttProvider: SttProviderId;
  llmProvider: LlmProviderId;
  llmApiKey: string;
}): boolean {
  return !state.sttApiKey && state.sttProvider === state.llmProvider && Boolean(state.llmApiKey);
}

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
      llmModelOptions: state.llmModelOptions,
      sttModelOptions: state.sttModelOptions,
      imageModel: state.imageModel,
      imageModelOptions: state.imageModelOptions,
      autoImages: state.autoImages,
      voiceProvider: state.voiceProvider,
      voiceModel: state.voiceModel,
      voiceBaseUrl: state.voiceBaseUrl,
      voiceId: state.voiceId,
      voiceLanguage: state.voiceLanguage,
      voiceOptions: state.voiceOptions,
    };
    AsyncStorage.setItem(PREFS_KEY, JSON.stringify(prefs)).catch(() => undefined);
  }, 250);
}
