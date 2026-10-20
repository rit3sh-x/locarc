import { convexClient } from "@convex-dev/better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";
import { ConvexReactClient } from "convex/react";
import { env } from "../env";

export const convex = new ConvexReactClient(env.VITE_CONVEX_URL);

// Same-origin: the Worker (prod) or Vite (dev) proxies /api/auth to Convex.
export const authClient = createAuthClient({ plugins: [convexClient()] });

/** Only same-site paths survive the sign-in round trip. */
export function safeRedirect(target: string | undefined): string {
  return target?.startsWith("/") && !target.startsWith("//") ? target : "/";
}
