import { components } from "../_generated/api";
import { query, mutation } from "../_generated/server";
import { authComponent, createAuth } from "../betterAuth/auth";
import { requireAccess } from "../lib/utils";
import { ConvexError, v } from "convex/values";

export const getProfile = query({
    args: {},
    handler: async (ctx) => {
        const { user } = await requireAccess(ctx, {
            profile: ["get"],
        });

        const { name, organizationSlug, username, started } = user;

        if (!username) {
            throw new ConvexError({
                code: "INTERNAL_SERVER_ERROR",
                message: "No username exists for user",
            });
        }

        return {
            name,
            organizationSlug,
            username,
            started,
        };
    },
});

export const updateProfile = mutation({
    args: {
        name: v.optional(v.string()),
        username: v.optional(v.string()),
        organizationSlug: v.optional(v.string()),
    },
    handler: async (ctx, input) => {
        const { user } = await requireAccess(ctx, {
            profile: ["update"],
        });

        const currentOrg = user.organizationSlug;
        const { name, username, organizationSlug: newOrgSlug } = input;

        if (newOrgSlug && newOrgSlug !== currentOrg) {
            await ctx.runMutation(components.betterAuth.adapter.updateMany, {
                input: {
                    model: "user",
                    update: { organizationSlug: newOrgSlug },
                    where: [
                        {
                            field: "organizationSlug",
                            operator: "eq",
                            value: currentOrg,
                        },
                    ],
                },
                paginationOpts: { cursor: null, numItems: 1000 },
            });
        }

        const { auth, headers } = await authComponent.getAuth(createAuth, ctx);

        await auth.api.updateUser({
            body: { name, username },
            headers,
        });
    },
});
