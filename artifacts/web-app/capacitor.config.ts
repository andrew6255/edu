import type { CapacitorConfig } from '@capacitor/cli';

const isDevelopment = process.env.NODE_ENV !== 'production';

const config: CapacitorConfig = {
  appId: 'com.antigravity.iqgames',
  appName: 'IQ Games',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
    cleartext: isDevelopment,
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 2000,
      backgroundColor: '#0f172a',
      showSpinner: true,
      androidSpinnerStyle: 'large',
      spinnerColor: '#38bdf8',
    },
  },
};

export default config;
