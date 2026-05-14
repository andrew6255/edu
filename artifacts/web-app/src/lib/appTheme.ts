import type { UserAppearanceSettings } from '@/lib/userService';

export type AppThemeId = UserAppearanceSettings['appTheme'];

export interface AppThemeDefinition {
  id: AppThemeId;
  label: string;
  description: string;
  audience: string;
  preview: {
    background: string;
    card: string;
    accent: string;
    accentSoft: string;
  };
  vars: Record<string, string>;
}

export const APP_THEMES: AppThemeDefinition[] = [
  {
    id: 'modern-dark',
    label: 'Original Logic Lords',
    description: 'Your current official Logic Lords design with the original dark fantasy feel.',
    audience: 'Main official design',
    preview: {
      background: '#0f172a',
      card: '#1e293b',
      accent: '#3b82f6',
      accentSoft: '#a78bfa',
    },
    vars: {
      '--background': '222 47% 11%',
      '--foreground': '210 40% 98%',
      '--border': '217 33% 25%',
      '--input': '217 33% 25%',
      '--ring': '217 91% 60%',
      '--card': '222 47% 18%',
      '--card-foreground': '210 40% 98%',
      '--primary': '217 91% 60%',
      '--primary-foreground': '222 47% 11%',
      '--secondary': '217 33% 25%',
      '--secondary-foreground': '210 40% 98%',
      '--muted': '217 33% 20%',
      '--muted-foreground': '215 20% 65%',
      '--accent': '217 91% 60%',
      '--accent-foreground': '222 47% 11%',
      '--destructive': '0 84% 60%',
      '--destructive-foreground': '210 40% 98%',
      '--ll-bg-dark': '#0f172a',
      '--ll-bg-card': '#1e293b',
      '--ll-accent': '#3b82f6',
      '--ll-green': '#10b981',
      '--ll-red': '#ef4444',
      '--ll-grey': '#475569',
      '--ll-glow': 'rgba(59, 130, 246, 0.5)',
      '--ll-surface-2': '#162338',
      '--ll-surface-3': '#22314a',
      '--ll-border': 'rgba(96, 123, 160, 0.38)',
      '--ll-border-strong': 'rgba(59, 130, 246, 0.42)',
      '--ll-text-soft': 'rgba(203, 213, 225, 0.88)',
      '--ll-overlay': 'rgba(7, 12, 24, 0.82)',
      '--app-font-sans': 'Segoe UI, Tahoma, Geneva, Verdana, sans-serif',
      '--radius': '0.5rem',
    },
  },
  {
    id: 'minimal-focus',
    label: 'Forest Journal',
    description: 'A calm earthy look with sage, moss, cream, and notebook warmth.',
    audience: 'Student sample',
    preview: {
      background: '#eef3ee',
      card: '#f7faf7',
      accent: '#2f6f67',
      accentSoft: '#7fa08f',
    },
    vars: {
      '--background': '132 20% 93%',
      '--foreground': '168 24% 18%',
      '--border': '150 14% 72%',
      '--input': '150 14% 72%',
      '--ring': '172 39% 31%',
      '--card': '132 22% 97%',
      '--card-foreground': '168 24% 18%',
      '--primary': '172 39% 31%',
      '--primary-foreground': '210 40% 98%',
      '--secondary': '144 17% 88%',
      '--secondary-foreground': '166 22% 22%',
      '--muted': '138 14% 88%',
      '--muted-foreground': '160 12% 35%',
      '--accent': '150 20% 53%',
      '--accent-foreground': '210 40% 98%',
      '--destructive': '0 72% 51%',
      '--destructive-foreground': '210 40% 98%',
      '--ll-bg-dark': '#eef3ee',
      '--ll-bg-card': '#f7faf7',
      '--ll-accent': '#2f6f67',
      '--ll-green': '#3f7f74',
      '--ll-red': '#b91c1c',
      '--ll-grey': '#93a39d',
      '--ll-glow': 'rgba(47, 111, 103, 0.16)',
      '--ll-surface-2': '#e7eeea',
      '--ll-surface-3': '#dbe6e0',
      '--ll-border': 'rgba(122, 142, 135, 0.42)',
      '--ll-border-strong': 'rgba(47, 111, 103, 0.34)',
      '--ll-text-soft': 'rgba(63, 81, 76, 0.9)',
      '--ll-overlay': 'rgba(238, 243, 238, 0.92)',
      '--app-font-sans': 'Georgia, Segoe UI, Tahoma, Geneva, Verdana, sans-serif',
      '--radius': '0.7rem',
    },
  },
  {
    id: 'ocean-breeze',
    label: 'Ocean Breeze',
    description: 'A soft aqua coastal theme with clean contrast and a calm study-friendly mood.',
    audience: 'Student sample',
    preview: {
      background: '#e9f4f6',
      card: '#f5fbfc',
      accent: '#347f98',
      accentSoft: '#74aeb0',
    },
    vars: {
      '--background': '191 31% 92%',
      '--foreground': '198 38% 21%',
      '--border': '191 22% 73%',
      '--input': '191 22% 73%',
      '--ring': '196 49% 45%',
      '--card': '190 33% 96%',
      '--card-foreground': '198 38% 21%',
      '--primary': '196 49% 45%',
      '--primary-foreground': '0 0% 100%',
      '--secondary': '184 28% 89%',
      '--secondary-foreground': '198 31% 25%',
      '--muted': '188 22% 86%',
      '--muted-foreground': '196 18% 34%',
      '--accent': '182 29% 56%',
      '--accent-foreground': '0 0% 100%',
      '--destructive': '0 84% 60%',
      '--destructive-foreground': '210 40% 98%',
      '--ll-bg-dark': '#e9f4f6',
      '--ll-bg-card': '#f5fbfc',
      '--ll-accent': '#347f98',
      '--ll-green': '#4f9791',
      '--ll-red': '#ef4444',
      '--ll-grey': '#9ebec5',
      '--ll-glow': 'rgba(52, 127, 152, 0.16)',
      '--ll-surface-2': '#ddecef',
      '--ll-surface-3': '#cfe2e7',
      '--ll-border': 'rgba(101, 138, 148, 0.42)',
      '--ll-border-strong': 'rgba(52, 127, 152, 0.34)',
      '--ll-text-soft': 'rgba(58, 82, 88, 0.9)',
      '--ll-overlay': 'rgba(233, 244, 246, 0.92)',
      '--app-font-sans': 'Inter, Segoe UI, Tahoma, Geneva, Verdana, sans-serif',
      '--radius': '0.95rem',
    },
  },
  {
    id: 'royal-ember',
    label: 'Royal Ember',
    description: 'A refined navy-and-bronze theme with premium contrast that feels rich without being harsh.',
    audience: 'Student sample',
    preview: {
      background: '#151b26',
      card: '#222b38',
      accent: '#c79a56',
      accentSoft: '#b46b4f',
    },
    vars: {
      '--background': '215 27% 12%',
      '--foreground': '35 46% 93%',
      '--border': '214 18% 27%',
      '--input': '214 18% 27%',
      '--ring': '35 48% 56%',
      '--card': '213 24% 18%',
      '--card-foreground': '35 46% 93%',
      '--primary': '35 48% 56%',
      '--primary-foreground': '215 27% 12%',
      '--secondary': '18 35% 30%',
      '--secondary-foreground': '35 46% 93%',
      '--muted': '214 17% 22%',
      '--muted-foreground': '34 21% 72%',
      '--accent': '17 39% 50%',
      '--accent-foreground': '41 100% 96%',
      '--destructive': '0 84% 60%',
      '--destructive-foreground': '210 40% 98%',
      '--ll-bg-dark': '#151b26',
      '--ll-bg-card': '#222b38',
      '--ll-accent': '#c79a56',
      '--ll-green': '#6ba67b',
      '--ll-red': '#d67b7b',
      '--ll-grey': '#677487',
      '--ll-glow': 'rgba(199, 154, 86, 0.18)',
      '--ll-surface-2': '#1b2430',
      '--ll-surface-3': '#283241',
      '--ll-border': 'rgba(122, 136, 154, 0.34)',
      '--ll-border-strong': 'rgba(199, 154, 86, 0.34)',
      '--ll-text-soft': 'rgba(223, 210, 194, 0.84)',
      '--ll-overlay': 'rgba(12, 16, 24, 0.8)',
      '--app-font-sans': 'Georgia, Segoe UI, Tahoma, Geneva, Verdana, sans-serif',
      '--radius': '0.8rem',
    },
  },
];

export const DEFAULT_APP_THEME_ID: AppThemeId = 'modern-dark';

export function getThemeDefinition(themeId: AppThemeId | undefined | null): AppThemeDefinition {
  return APP_THEMES.find((theme) => theme.id === themeId) ?? APP_THEMES.find((theme) => theme.id === DEFAULT_APP_THEME_ID)!;
}

export function applyAppTheme(themeId: AppThemeId | undefined | null): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  const theme = getThemeDefinition(themeId);
  Object.entries(theme.vars).forEach(([key, value]) => {
    root.style.setProperty(key, value);
  });
  root.dataset.appTheme = theme.id;
}
