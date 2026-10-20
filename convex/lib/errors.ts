import { ConvexError } from "convex/values";

export type ErrorCode =
  | "UNAUTHENTICATED"
  | "WRONG_ISSUER"
  | "REVOKED"
  | "NOT_FOUND"
  | "CONFIG_CONFLICT"
  | "NAME_TAKEN"
  | "BAND_INVALID"
  | "VALUE_OUT_OF_RANGE"
  | "LAST_OPERATOR"
  | "INVITE_INVALID"
  | "CODE_INVALID"
  | "REFERENCE_MISSING"
  | "TOO_FEW_RECEIVERS"
  | "CHECKLIST_INCOMPLETE"
  | "APP_TOO_OLD"
  | "NOT_TEST_MODE"
  | "ALREADY_SET_UP";

export type ErrorData = { code: ErrorCode; message?: string };

export function fail(code: ErrorCode, message?: string): never {
  throw new ConvexError<ErrorData>(message === undefined ? { code } : { code, message });
}

export function errorCode(e: unknown): ErrorCode | null {
  if (e instanceof ConvexError && typeof e.data === "object" && e.data && "code" in e.data) {
    return (e.data as ErrorData).code;
  }
  return null;
}
