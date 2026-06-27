import { RateLimiter, MINUTE } from "@convex-dev/rate-limiter";
import { components } from "../_generated/api";

const rateLimits = {
    submitLocation: { kind: "token bucket", rate: 12, period: MINUTE, capacity: 12 },
    submitMeasurements: { kind: "token bucket", rate: 6, period: MINUTE, capacity: 6 },
} as const;

export type RateLimitName = keyof typeof rateLimits;

export const rateLimiter = new RateLimiter(components.rateLimiter, rateLimits);
