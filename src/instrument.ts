import { useEffect } from "react";
import {
  createRoutesFromChildren,
  matchRoutes,
  useLocation,
  useNavigationType,
} from "react-router-dom";
import * as Sentry from "@sentry/react";

const dsnRaw = import.meta.env.VITE_SENTRY_DSN;
const dsn = typeof dsnRaw === "string" ? dsnRaw.trim() : "";

if (dsn) {
  Sentry.init({
    dsn,
    sendDefaultPii: false,
    environment: import.meta.env.MODE,
    tracesSampleRate: import.meta.env.PROD ? 0.2 : 0,
    integrations: [
      Sentry.reactRouterBrowserTracingIntegration({
        useEffect,
        useLocation,
        useNavigationType,
        createRoutesFromChildren,
        matchRoutes,
      }),
    ],
    tracePropagationTargets: ["localhost", window.location.origin],
  });
}
