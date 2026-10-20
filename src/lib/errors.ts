import { ConvexError } from "convex/values";
import type { ErrorCode, ErrorData } from "@/convex/lib/errors";

const MESSAGES: Partial<Record<ErrorCode, string>> = {
  UNAUTHENTICATED: "Your session has ended. Sign in again.",
  REVOKED: "Your access has been removed.",
  NOT_FOUND: "That no longer exists.",
  CONFIG_CONFLICT: "A teammate changed this since you opened it.",
  NAME_TAKEN: "That name is already taken.",
  BAND_INVALID:
    "That Sweep plan isn't valid: 1–16 segments within 1–6000 MHz, in order, not overlapping.",
  VALUE_OUT_OF_RANGE: "A value is out of range.",
  LAST_OPERATOR: "The last Operator can't be removed.",
  INVITE_INVALID: "This invite link is invalid or has expired.",
  CODE_INVALID: "That pairing code is invalid or has expired.",
  REFERENCE_MISSING: "Set the calibration reference frequency first.",
  TOO_FEW_RECEIVERS: "Pick at least two Receivers.",
  CHECKLIST_INCOMPLETE: "Tick every hardware checklist item first.",
  APP_TOO_OLD: "That Receiver's app is too old for this change.",
};

export function errorMessage(e: unknown): string {
  if (e instanceof ConvexError) {
    const data = e.data as ErrorData;
    return data.message ?? MESSAGES[data.code] ?? data.code;
  }
  return "Something went wrong. Try again.";
}
