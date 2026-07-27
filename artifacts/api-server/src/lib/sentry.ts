import * as Sentry from '@sentry/node';
import { logger } from './logger';

/**
 * sentry.ts — Backend Sentry initialisation.
 *
 * Call `initSentry()` as the very first statement in index.ts, before any
 * other imports that could throw, so that all exceptions are captured.
 *
 * Set SENTRY_DSN in your .env (or deployment secrets) to enable reporting.
 * Omitting the variable is safe — Sentry will simply no-op in that case.
 */
export function initSentry(): void {
  const dsn = process.env['SENTRY_DSN'];

  if (!dsn) {
    logger.info('[sentry] SENTRY_DSN not set — error reporting disabled');
    return;
  }

  Sentry.init({
    dsn,
    environment: process.env['NODE_ENV'] ?? 'development',
    release: process.env['APP_VERSION'] ?? 'local',

    // Capture 100% of transactions in dev; tune down in production
    tracesSampleRate: process.env['NODE_ENV'] === 'production' ? 0.1 : 1.0,

    // Breadcrumbs: capture console output only in production to avoid noise
    integrations: [
      Sentry.httpIntegration(),
    ],

    // Do not send events for expected "not found" or "unauthorised" responses
    beforeSend(event) {
      const status = (event.extra?.['statusCode'] as number | undefined);
      if (status === 404 || status === 401 || status === 403) return null;
      return event;
    },
  });

  logger.info(
    { environment: process.env['NODE_ENV'], release: process.env['APP_VERSION'] ?? 'local' },
    '[sentry] Initialised',
  );
}

/**
 * Express error handler — must be registered AFTER all routes.
 * Re-exports the Sentry handler so callers never import @sentry/node directly.
 */
export function sentryErrorHandler(): ReturnType<typeof Sentry.expressErrorHandler> {
  return Sentry.expressErrorHandler();
}
