import { ConvexError } from "convex/values";
import { api } from "@/convex/_generated/api";
import { fingerprint, redact, sampleStack } from "@/convex/lib/errorFingerprint";
import { errorCode } from "@/convex/lib/errors";
import { env } from "../env";
import { convex } from "./auth";

const ONCE_PER_MS = 10 * 60_000;
const sent = new Map<string, number>();

/**
 * Reports one of the website's own errors to Diagnostics: redacted here (the server redacts
 * again), and at most once per fingerprint per tab every 10 minutes. Expected endings (a revoked
 * session) and business errors (ConvexError codes, which the UI explains) aren't bugs.
 */
export function reportError(error: unknown, context = location.pathname) {
  if (error instanceof ConvexError || errorCode(error)) return;
  const e = error instanceof Error ? error : new Error(String(error));
  const kind = e.name || "Error";
  const fp = fingerprint({ source: "web", kind, message: e.message, stack: e.stack });
  const now = Date.now();
  if ((sent.get(fp) ?? 0) > now - ONCE_PER_MS) return;
  sent.set(fp, now);
  void convex
    .mutation(api.errors.report, {
      kind,
      message: redact(e.message).slice(0, 500),
      stack: sampleStack(e.stack),
      version: env.VITE_WEB_VERSION,
      context: redact(context),
    })
    .catch(() => {});
}

export function installErrorReporting() {
  window.addEventListener("error", (event) => reportError(event.error ?? event.message));
  window.addEventListener("unhandledrejection", (event) => reportError(event.reason));
}
