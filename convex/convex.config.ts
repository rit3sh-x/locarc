import betterAuth from "@convex-dev/better-auth/convex.config";
import { defineApp } from "convex/server";
import { v } from "convex/values";

const app = defineApp({
  env: {
    SITE_URL: v.string(),
    BETTER_AUTH_SECRET: v.string(),
    RECEIVER_JWT_PRIVATE_KEY: v.string(),
    RECEIVER_JWT_PUBLIC_JWK: v.string(),
    VAPID_PUBLIC_KEY: v.string(),
    VAPID_PRIVATE_KEY: v.string(),
    VAPID_SUBJECT: v.string(),
    IS_TEST: v.optional(v.string()),
  },
});
app.use(betterAuth);

export default app;
