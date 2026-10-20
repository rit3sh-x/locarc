import { ConvexBetterAuthProvider } from "@convex-dev/better-auth/react";
import { RouterProvider } from "@tanstack/react-router";
import { useConvexAuth } from "convex/react";
import { StrictMode, useEffect, useRef } from "react";
import { createRoot } from "react-dom/client";
import { errorCode } from "@/convex/lib/errors";
import { Toaster } from "./components/ui/toast";
import { authClient, convex } from "./lib/auth";
import { installErrorReporting, reportError } from "./lib/report";
import { router } from "./router";
import "./styles.css";

function App() {
  const auth = useConvexAuth();
  const ready = useRef(false);
  if (!auth.isLoading) ready.current = true;

  // biome-ignore lint/correctness/useExhaustiveDependencies: re-run route guards when auth flips
  useEffect(() => {
    void router.invalidate();
  }, [auth.isAuthenticated]);

  // Only the first auth check blocks rendering; later token refreshes keep the page mounted.
  if (!ready.current) return null;
  return <RouterProvider router={router} context={{ auth }} />;
}

installErrorReporting();
const rootEl = document.getElementById("root");

if (!rootEl) throw new Error("#root missing");
createRoot(rootEl, {
  // A revoked or expired session is an expected ending (the boundary signs out), not a bug.
  onCaughtError: (error, info) => {
    const code = errorCode(error);
    if (code === "REVOKED" || code === "UNAUTHENTICATED") return;
    console.error(error, info.componentStack);
    reportError(error);
  },
}).render(
  <StrictMode>
    {/* 0.12.5's AuthClient type infers `never` session data under TS 7; the runtime shape matches. */}
    <ConvexBetterAuthProvider client={convex} authClient={authClient as never}>
      <App />
      <Toaster />
    </ConvexBetterAuthProvider>
  </StrictMode>,
);
