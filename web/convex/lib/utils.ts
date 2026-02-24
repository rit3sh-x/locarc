import { APIError } from "better-auth/api";
import { GenericCtx } from "@convex-dev/better-auth";
import { DataModel } from "../_generated/dataModel";
import { PermissionRequest, ROLE_MAP } from "./roles";
import { components } from "../_generated/api";
import { Doc } from "../betterAuth/_generated/dataModel";

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

export async function hmacSign(
    secret: string,
    payload: string
): Promise<string> {
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
        "raw",
        encoder.encode(secret),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"]
    );
    const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(payload));
    return Array.from(new Uint8Array(sig))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
}

export function timingSafeEqual(a: string, b: string): boolean {
    if (a.length !== b.length) return false;
    let result = 0;
    for (let i = 0; i < a.length; i++) {
        result |= a.charCodeAt(i) ^ b.charCodeAt(i);
    }
    return result === 0;
}
