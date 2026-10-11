export type ThemeKey = 'blue' | 'white' | 'dark' | 'red' | 'green' | 'yellow';

export interface ThemeConfig {
  id: ThemeKey;
  name: string;
  isLight: boolean;
  bg: string;
  bgHex: string;
  sidebar: string;
  header: string;
  card: string;
  cardSub: string;
  cardBorder: string;
  textPrimary: string;
  textMuted: string;
  textDim: string;
  inputBg: string;
  inputBorder: string;
  accent: string;
  accentBg: string;
  accentBgHover: string;
  accentText: string;
  accentBorder: string;
  glow: string;
  badgeBg: string;
  badgeText: string;
  badgeBorder: string;
}

export const themes: Record<ThemeKey, ThemeConfig> = {
  // DEFAULT: exact blue currently in the app - DO NOT ALTER
  blue: {
    id: 'blue',
    name: 'Blue (Default)',
    isLight: false,
    bg: 'bg-[#03040A]',
    bgHex: '#03040A',
    sidebar: 'bg-[#0A0D19]',
    header: 'bg-[#0A0D19]/80',
    card: 'bg-[#0A0D19]',
    cardSub: 'bg-[#101427]',
    cardBorder: 'border-white/5',
    textPrimary: 'text-slate-100',
    textMuted: 'text-slate-400',
    textDim: 'text-slate-500',
    inputBg: 'bg-[#101427]',
    inputBorder: 'border-white/10',
    accent: 'indigo-500',
    accentBg: 'bg-indigo-600',
    accentBgHover: 'hover:bg-indigo-500',
    accentText: 'text-indigo-400',
    accentBorder: 'border-indigo-500/30',
    glow: 'shadow-indigo-500/20',
    badgeBg: 'bg-indigo-500/10',
    badgeText: 'text-indigo-400',
    badgeBorder: 'border-indigo-500/20',
  },
  white: {
    id: 'white',
    name: 'White (Light)',
    isLight: true,
    bg: 'bg-[#F8FAFC]',
    bgHex: '#F8FAFC',
    sidebar: 'bg-[#FFFFFF]',
    header: 'bg-[#FFFFFF]/90',
    card: 'bg-[#FFFFFF]',
    cardSub: 'bg-[#F1F5F9]',
    cardBorder: 'border-slate-200',
    textPrimary: 'text-slate-900',
    textMuted: 'text-slate-600',
    textDim: 'text-slate-400',
    inputBg: 'bg-[#F1F5F9]',
    inputBorder: 'border-slate-300',
    accent: 'blue-600',
    accentBg: 'bg-blue-600',
    accentBgHover: 'hover:bg-blue-500',
    accentText: 'text-blue-600',
    accentBorder: 'border-blue-500/30',
    glow: 'shadow-blue-500/10',
    badgeBg: 'bg-blue-50',
    badgeText: 'text-blue-700',
    badgeBorder: 'border-blue-200',
  },
  dark: {
    id: 'dark',
    name: 'Dark (Onyx Night)',
    isLight: false,
    bg: 'bg-[#000000]',
    bgHex: '#000000',
    sidebar: 'bg-[#0B0C10]',
    header: 'bg-[#0B0C10]/90',
    card: 'bg-[#0F1117]',
    cardSub: 'bg-[#161822]',
    cardBorder: 'border-white/10',
    textPrimary: 'text-zinc-100',
    textMuted: 'text-zinc-400',
    textDim: 'text-zinc-600',
    inputBg: 'bg-[#161822]',
    inputBorder: 'border-white/15',
    accent: 'indigo-500',
    accentBg: 'bg-indigo-600',
    accentBgHover: 'hover:bg-indigo-500',
    accentText: 'text-indigo-400',
    accentBorder: 'border-indigo-500/40',
    glow: 'shadow-indigo-600/30',
    badgeBg: 'bg-indigo-950/40',
    badgeText: 'text-indigo-300',
    badgeBorder: 'border-indigo-500/30',
  },
  red: {
    id: 'red',
    name: 'Red (Crimson)',
    isLight: false,
    bg: 'bg-[#0B0305]',
    bgHex: '#0B0305',
    sidebar: 'bg-[#140609]',
    header: 'bg-[#140609]/90',
    card: 'bg-[#1A0A0E]',
    cardSub: 'bg-[#240F14]',
    cardBorder: 'border-red-950/40',
    textPrimary: 'text-rose-100',
    textMuted: 'text-rose-300/70',
    textDim: 'text-rose-400/40',
    inputBg: 'bg-[#240F14]',
    inputBorder: 'border-red-800/30',
    accent: 'rose-500',
    accentBg: 'bg-rose-600',
    accentBgHover: 'hover:bg-rose-500',
    accentText: 'text-rose-400',
    accentBorder: 'border-rose-500/30',
    glow: 'shadow-rose-600/30',
    badgeBg: 'bg-rose-950/40',
    badgeText: 'text-rose-400',
    badgeBorder: 'border-rose-800/40',
  },
  green: {
    id: 'green',
    name: 'Green (Emerald)',
    isLight: false,
    bg: 'bg-[#020B06]',
    bgHex: '#020B06',
    sidebar: 'bg-[#05140B]',
    header: 'bg-[#05140B]/90',
    card: 'bg-[#091D11]',
    cardSub: 'bg-[#0F2818]',
    cardBorder: 'border-emerald-950/40',
    textPrimary: 'text-emerald-100',
    textMuted: 'text-emerald-300/70',
    textDim: 'text-emerald-400/40',
    inputBg: 'bg-[#0F2818]',
    inputBorder: 'border-emerald-800/30',
    accent: 'emerald-500',
    accentBg: 'bg-emerald-600',
    accentBgHover: 'hover:bg-emerald-500',
    accentText: 'text-emerald-400',
    accentBorder: 'border-emerald-500/30',
    glow: 'shadow-emerald-600/30',
    badgeBg: 'bg-emerald-950/40',
    badgeText: 'text-emerald-400',
    badgeBorder: 'border-emerald-800/40',
  },
  yellow: {
    id: 'yellow',
    name: 'Yellow (Amber Gold)',
    isLight: false,
    bg: 'bg-[#0B0802]',
    bgHex: '#0B0802',
    sidebar: 'bg-[#140E05]',
    header: 'bg-[#140E05]/90',
    card: 'bg-[#1C1408]',
    cardSub: 'bg-[#261C0D]',
    cardBorder: 'border-amber-950/40',
    textPrimary: 'text-amber-100',
    textMuted: 'text-amber-300/70',
    textDim: 'text-amber-400/40',
    inputBg: 'bg-[#261C0D]',
    inputBorder: 'border-amber-800/30',
    accent: 'amber-500',
    accentBg: 'bg-amber-600',
    accentBgHover: 'hover:bg-amber-500',
    accentText: 'text-amber-400',
    accentBorder: 'border-amber-500/30',
    glow: 'shadow-amber-600/30',
    badgeBg: 'bg-amber-950/40',
    badgeText: 'text-amber-400',
    badgeBorder: 'border-amber-800/40',
  },
};
