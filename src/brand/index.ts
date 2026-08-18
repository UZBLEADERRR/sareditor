import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';

const STORAGE_KEY = 'fara.brand.v1';

export const DEFAULT_BRAND = {
  name: 'Fara Editor',
  tagline: 'AI montaj · Reels · TikTok · Shorts',
  /** Absolute path of a user-chosen logo; falls back to the bundled asset. */
  logoUri: '',
} as const;

export type Brand = {
  name: string;
  tagline: string;
  logoUri: string;
};

type BrandState = Brand & {
  hydrated: boolean;
  hydrate: () => Promise<void>;
  update: (patch: Partial<Brand>) => void;
  reset: () => void;
};

/**
 * App identity kept in storage rather than hardcoded, so the name and logo can
 * be changed from inside the app without a rebuild. The launcher icon still
 * comes from assets/ at build time — only what is drawn inside the app is
 * covered here.
 */
export const useBrand = create<BrandState>((set, get) => ({
  ...DEFAULT_BRAND,
  hydrated: false,

  hydrate: async () => {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) {
      set({ hydrated: true });
      return;
    }
    try {
      set({ ...DEFAULT_BRAND, ...(JSON.parse(raw) as Partial<Brand>), hydrated: true });
    } catch {
      set({ ...DEFAULT_BRAND, hydrated: true });
    }
  },

  update: (patch) => {
    set(patch);
    const { name, tagline, logoUri } = get();
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify({ name, tagline, logoUri })).catch(() => undefined);
  },

  reset: () => {
    set({ ...DEFAULT_BRAND });
    AsyncStorage.removeItem(STORAGE_KEY).catch(() => undefined);
  },
}));
