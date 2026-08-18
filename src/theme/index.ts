export const colors = {
  bg: '#07070A',
  bgElevated: '#101018',
  surface: '#16161F',
  surfaceAlt: '#1E1E29',
  border: '#2A2A38',
  borderSoft: '#20202C',

  text: '#F4F4F7',
  textDim: '#9B9BAB',
  textFaint: '#65657A',

  accent: '#7C5CFF',
  accentSoft: '#9B85FF',
  pink: '#FF4D8D',
  amber: '#FFB65C',
  teal: '#38E0C8',
  green: '#3ED598',
  red: '#FF5C6C',

  overlay: 'rgba(4,4,8,0.82)',
} as const;

export const gradients = {
  brand: ['#7C5CFF', '#FF4D8D'] as const,
  brandWide: ['#7C5CFF', '#FF4D8D', '#FFB65C'] as const,
  fade: ['transparent', 'rgba(7,7,10,0.95)'] as const,
  card: ['#1B1B27', '#12121A'] as const,
};

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;

export const radius = {
  sm: 8,
  md: 14,
  lg: 20,
  xl: 28,
  pill: 999,
} as const;

export const typography = {
  display: { fontSize: 28, fontWeight: '800' as const, letterSpacing: -0.6 },
  title: { fontSize: 20, fontWeight: '700' as const, letterSpacing: -0.3 },
  section: { fontSize: 13, fontWeight: '700' as const, letterSpacing: 0.8 },
  body: { fontSize: 15, fontWeight: '500' as const },
  small: { fontSize: 13, fontWeight: '500' as const },
  tiny: { fontSize: 11, fontWeight: '600' as const, letterSpacing: 0.4 },
  mono: { fontSize: 12, fontWeight: '600' as const, fontVariant: ['tabular-nums'] as ('tabular-nums')[] },
};

export const shadow = {
  card: {
    shadowColor: '#000',
    shadowOpacity: 0.4,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 8,
  },
};
