import { APIError } from "better-auth/api";
import { GenericCtx } from "@convex-dev/better-auth";
import { DataModel } from "../_generated/dataModel";
import { PermissionRequest, ROLE_MAP } from "./roles";
import { components } from "../_generated/api";
import { Doc } from "../betterAuth/_generated/dataModel";
import { MutationCtx } from "../_generated/server";
import { rateLimiter, RateLimitName } from "./rateLimiter";
import { ConvexError } from "convex/values";

export async function requireAccess(
    ctx: GenericCtx<DataModel>,
    permission: PermissionRequest
) {
    const identity = await ctx.auth.getUserIdentity();

    if (!identity) {
        throw new APIError("UNAUTHORIZED", {
            message: "Please sign in to continue.",
        });
    }

    const userId = identity.subject;

    const user: Doc<"user"> = await ctx.runQuery(
        components.betterAuth.adapter.findOne,
        {
            model: "user",
            where: [
                {
                    field: "_id",
                    value: userId,
                    operator: "eq",
                },
            ],
        }
    );

    const role = user.role;
    if (!role || !ROLE_MAP[role]) {
        throw new APIError("FORBIDDEN", {
            message: "User has no valid role assigned.",
        });
    }

    const { success } = ROLE_MAP[role].authorize(permission);
    if (!success) {
        throw new APIError("FORBIDDEN", {
            message: "Insufficient permissions",
        });
    }

    if (user.banned) {
        throw new APIError("FORBIDDEN", {
            message: "You are banned",
        });
    }

    return {
        user,
    };
}

export async function rateLimit(
    ctx: MutationCtx,
    name: RateLimitName,
    userId: string
) {
    const { ok, retryAfter } = await rateLimiter.limit(ctx, name, {
        key: userId,
    });

    if (!ok) {
        throw new ConvexError({
            code: "RATE_LIMITED",
            message: `Too many requests. Try again in ${Math.ceil(retryAfter / 1000)}s.`,
            retryAfter,
        });
    }
}
