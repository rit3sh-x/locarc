import { type ErrorComponentProps, useRouter } from "@tanstack/react-router";
import { useEffect } from "react";
import { errorCode } from "@/convex/lib/errors";
import { authClient } from "../lib/auth";
import { errorMessage } from "../lib/errors";
import { reportError } from "../lib/report";

import { Button } from "./ui/button";

/** A revoked or expired session ends at sign-in; anything else offers a retry. */
export function RouteError({ error, reset }: ErrorComponentProps) {
  const router = useRouter();
  const code = errorCode(error);
  const signedOut = code === "REVOKED" || code === "UNAUTHENTICATED";

  useEffect(() => {
    if (signedOut) void authClient.signOut().finally(() => router.navigate({ to: "/sign-in" }));
    else reportError(error);
  }, [signedOut, router, error]);

  if (signedOut) return null;
  return (
    <div
      role="alert"
      className="grid justify-items-start gap-3 rounded-lg border border-crit/40 bg-surface p-6"
    >
      <h1 className="text-base">Something went wrong</h1>
      <p className="text-muted">{errorMessage(error)}</p>
      <Button
        onClick={() => {
          reset();
          void router.invalidate();
        }}
      >
        Try again
      </Button>
    </div>
  );
}
