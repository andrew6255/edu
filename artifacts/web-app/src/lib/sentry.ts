import * as Sentry from '@sentry/react';

/**
 * sentry.ts — Frontend Sentry initialisation.
 *
 * Called once in main.tsx before React renders.
 * Set VITE_SENTRY_DSN in web-app/.env to enable reporting.
 * Safe to omit — Sentry no-ops if DSN is absent.
 */
export function initSentry(): void {
  const dsn = import.meta.env.VITE_SENTRY_DSN as string | undefined;

  if (!dsn) {
    // No warning in development — expected behaviour when DSN not configured.
    return;
  }

  Sentry.init({
    dsn,
    environment: import.meta.env.MODE,
    release: import.meta.env.VITE_APP_VERSION ?? 'local',

    integrations: [
      Sentry.browserTracingIntegration(),
      Sentry.replayIntegration({
        // Mask all input text and block all images in session replays by default
        maskAllText: true,
        blockAllMedia: true,
      }),
    ],

    // Capture 10% of transactions in production to stay within free quota
    tracesSampleRate: import.meta.env.PROD ? 0.1 : 1.0,

    // Capture 5% of sessions for replay in production
    replaysSessionSampleRate: import.meta.env.PROD ? 0.05 : 1.0,

    // Always capture replays for error sessions
    replaysOnErrorSampleRate: 1.0,

    // Ignore noisy browser/extension errors
    ignoreErrors: [
      'ResizeObserver loop limit exceeded',
      'ResizeObserver loop completed with undelivered notifications',
      /^Network Error$/,
      /^ChunkLoadError/,
      /^Loading chunk/,
    ],
  });
}

/**
 * Sentry-wrapped React.ErrorBoundary — use this in place of React's built-in
 * ErrorBoundary to automatically capture component render errors.
 *
 * Usage:
 *   <SentryErrorBoundary fallback={<p>Something went wrong.</p>}>
 *     <YourComponent />
 *   </SentryErrorBoundary>
 */
export const SentryErrorBoundary = Sentry.ErrorBoundary;

/**
 * Manually capture an error with optional context tags.
 * Useful for caught errors that you don't want to re-throw.
 */
export function captureException(
  error: unknown,
  context?: Record<string, string | number | boolean>,
): void {
  Sentry.withScope((scope) => {
    if (context) {
      scope.setExtras(context);
    }
    Sentry.captureException(error);
  });
}
