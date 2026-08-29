import * as Sentry from "@sentry/node";

let initialized = false;
let enabled = false;

function initSentry(): boolean {
  if (initialized) return enabled;

  const dsn = process.env.SENTRY_DSN?.trim();
  if (!dsn) {
    initialized = true;
    enabled = false;
    return false;
  }

  const environment = process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? "development";

  Sentry.init({
    dsn,
    sendDefaultPii: false,
    environment,
    tracesSampleRate: environment === "production" ? 0.2 : 0,
  });

  initialized = true;
  enabled = true;
  return true;
}

/** Capture an unexpected server error and flush before the Vercel isolate freezes. */
export async function captureServerException(err: unknown): Promise<void> {
  if (!initSentry()) return;
  Sentry.captureException(err);
  await Sentry.flush(2000);
}
