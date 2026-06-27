import { defineApp } from "convex/server";
import betterAuth from "./betterAuth/convex.config";
import rateLimiter from "@convex-dev/rate-limiter/convex.config";

const app: ReturnType<typeof defineApp> = defineApp();
app.use(betterAuth);
app.use(rateLimiter);

export default app;
