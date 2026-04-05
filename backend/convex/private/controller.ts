import { mutation, query } from "../_generated/server";
import { requireAccess } from "../lib/utils";
import { ConvexError, v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import { LOCATION_MULTIPLIER } from "../lib/constants";
import { hashPassword } from "better-auth/crypto";
import { components } from "../_generated/api";
import { Doc, Id } from "../betterAuth/_generated/dataModel";
import type { PaginationResult } from "convex/server";

export const create = mutation({
    args: {
        name: v.string(),
        username: v.string(),
        password: v.string(),
        latitude: v.number(),
        longitude: v.number(),
        settings: v.object({
            minFreqHz: v.number(),
            maxFreqHz: v.number(),
            sampleRate: v.number(),
            vgaGain: v.number(),
            lnaGain: v.number(),
            bufferSize: v.number(),
        }),
    },
    handler: async (ctx, input) => {
        const { user: admin } = await requireAccess(ctx, {
            controller: ["create"],
        });

        const { latitude, longitude, name, password, settings, username } =
            input;

        if (name.length < 3)
            throw new ConvexError({
                code: "BAD_REQUEST",
                message: "Name must be at least 3 characters",
            });
        if (username.length < 3)
            throw new ConvexError({
                code: "BAD_REQUEST",
                message: "Username must be at least 3 characters",
            });
        if (password.length < 8)
            throw new ConvexError({
                code: "BAD_REQUEST",
                message: "Password must be at least 8 characters",
            });
        if (latitude < -90 || latitude > 90)
            throw new ConvexError({
                code: "BAD_REQUEST",
                message: "Latitude must be between -90 and 90",
            });
        if (longitude < -180 || longitude > 180)
            throw new ConvexError({
                code: "BAD_REQUEST",
                message: "Longitude must be between -180 and 180",
            });
        if (settings.minFreqHz <= 0)
            throw new ConvexError({
                code: "BAD_REQUEST",
                message: "minFreqHz must be positive",
            });
        if (settings.maxFreqHz <= 0)
            throw new ConvexError({
                code: "BAD_REQUEST",
                message: "maxFreqHz must be positive",
            });
        if (settings.sampleRate <= 0)
            throw new ConvexError({
                code: "BAD_REQUEST",
                message: "sampleRate must be positive",
            });
        if (settings.vgaGain < 0 || settings.vgaGain > 62)
            throw new ConvexError({
                code: "BAD_REQUEST",
                message: "vgaGain must be between 0 and 62",
            });
        if (settings.bufferSize <= 0)
            throw new ConvexError({
                code: "BAD_REQUEST",
                message: "bufferSize must be positive",
            });

        const user: Doc<"user"> = await ctx.runMutation(
            components.betterAuth.adapter.create,
            {
                input: {
                    model: "user",
                    data: {
                        email: `${username}-${admin.organizationSlug}@locarc.internal`,
                        emailVerified: true,
                        name,
                        organizationSlug: admin.organizationSlug,
                        role: "USER",
                        started: admin.started,
                        createdAt: Date.now(),
                        updatedAt: Date.now(),
                        username,
                    },
                },
            }
        );

        if (!user) {
            throw new ConvexError({
                code: "FORBIDDEN",
                message: "User already exists",
            });
        }

        const hashedPassword = await hashPassword(password);

        await ctx.runMutation(components.betterAuth.adapter.create, {
            input: {
                model: "account",
                data: {
                    accountId: user._id,
                    providerId: "credential",
                    userId: user._id,
                    password: hashedPassword,
                    createdAt: Date.now(),
                    updatedAt: Date.now(),
                },
            },
        });

        const controllerId = await ctx.db.insert("controller", {
            adminId: admin._id,
            userId: user._id,
            latitudeE6: Math.round(latitude * LOCATION_MULTIPLIER),
            longitudeE6: Math.round(longitude * LOCATION_MULTIPLIER),
            minFreqHz: settings.minFreqHz,
            maxFreqHz: settings.maxFreqHz,
            sampleRate: settings.sampleRate,
            vgaGain: settings.vgaGain,
            lnaGain: settings.lnaGain,
            bufferSize: settings.bufferSize,
            updatedAt: Date.now(),
            name,
        });

        return { controllerId };
    },
});

export const update = mutation({
    args: {
        controllerId: v.id("controller"),
        name: v.optional(v.string()),
        password: v.optional(v.string()),
        latitude: v.optional(v.number()),
        longitude: v.optional(v.number()),
        username: v.optional(v.string()),
        settings: v.optional(
            v.object({
                minFreqHz: v.optional(v.number()),
                maxFreqHz: v.optional(v.number()),
                sampleRate: v.optional(v.number()),
                vgaGain: v.optional(v.number()),
                lnaGain: v.optional(v.number()),
                bufferSize: v.optional(v.number()),
            })
        ),
    },
    handler: async (ctx, args) => {
        const { user: admin } = await requireAccess(ctx, {
            controller: ["update"],
        });

        const {
            controllerId,
            latitude,
            longitude,
            name,
            password,
            settings,
            username,
        } = args;

        if (name !== undefined && name.length < 3)
            throw new ConvexError({
                code: "BAD_REQUEST",
                message: "Name must be at least 3 characters",
            });
        if (username !== undefined && username.length < 3)
            throw new ConvexError({
                code: "BAD_REQUEST",
                message: "Username must be at least 3 characters",
            });
        if (password !== undefined && password.length < 8)
            throw new ConvexError({
                code: "BAD_REQUEST",
                message: "Password must be at least 8 characters",
            });
        if (latitude !== undefined && (latitude < -90 || latitude > 90))
            throw new ConvexError({
                code: "BAD_REQUEST",
                message: "Latitude must be between -90 and 90",
            });
        if (longitude !== undefined && (longitude < -180 || longitude > 180))
            throw new ConvexError({
                code: "BAD_REQUEST",
                message: "Longitude must be between -180 and 180",
            });
        if (settings?.minFreqHz !== undefined && settings.minFreqHz <= 0)
            throw new ConvexError({
                code: "BAD_REQUEST",
                message: "minFreqHz must be positive",
            });
        if (settings?.maxFreqHz !== undefined && settings.maxFreqHz <= 0)
            throw new ConvexError({
                code: "BAD_REQUEST",
                message: "maxFreqHz must be positive",
            });
        if (settings?.sampleRate !== undefined && settings.sampleRate <= 0)
            throw new ConvexError({
                code: "BAD_REQUEST",
                message: "sampleRate must be positive",
            });
        if (
            settings?.vgaGain !== undefined &&
            (settings.vgaGain < 0 || settings.vgaGain > 62)
        )
            throw new ConvexError({
                code: "BAD_REQUEST",
                message: "vgaGain must be between 0 and 62",
            });
        if (settings?.bufferSize !== undefined && settings.bufferSize <= 0)
            throw new ConvexError({
                code: "BAD_REQUEST",
                message: "bufferSize must be positive",
            });

        const existing = await ctx.db.get(controllerId);

        if (!existing || existing.adminId !== admin._id) {
            throw new ConvexError({
                code: "NOT_FOUND",
                message: "Controller not found",
            });
        }

        const controller = await ctx.db.get(controllerId);

        if (!controller) {
            throw new ConvexError({
                code: "NOT_FOUND",
                message: "Controller not found.",
            });
        }

        const user: Doc<"user"> = await ctx.runQuery(
            components.betterAuth.adapter.findOne,
            {
                model: "user",
                where: [
                    {
                        field: "_id",
                        value: controller.userId,
                        operator: "eq",
                    },
                ],
            }
        );

        if (username !== undefined) {
            await ctx.runMutation(components.betterAuth.adapter.updateOne, {
                input: {
                    model: "user",
                    where: [
                        {
                            field: "_id",
                            value: user._id,
                            operator: "eq",
                        },
                    ],
                    update: {
                        username: username,
                    },
                },
            });
        }

        if (password != null) {
            const hashedPassword = await hashPassword(password);
            await ctx.runMutation(components.betterAuth.adapter.updateOne, {
                input: {
                    model: "account",
                    where: [
                        {
                            field: "userId",
                            value: user._id,
                            operator: "eq",
                        },
                    ],
                    update: {
                        password: hashedPassword,
                    },
                },
            });
        }

        await ctx.db.patch(controllerId, {
            ...(latitude !== undefined && {
                latitudeE6: latitude * LOCATION_MULTIPLIER,
            }),
            ...(longitude !== undefined && {
                longitudeE6: longitude * LOCATION_MULTIPLIER,
            }),
            ...(name !== undefined && { name }),
            ...settings,
            updatedAt: Date.now(),
        });
    },
});

export const remove = mutation({
    args: {
        controllerId: v.id("controller"),
    },
    handler: async (ctx, args) => {
        const { user } = await requireAccess(ctx, {
            controller: ["delete"],
        });

        const { controllerId } = args;

        const existing = await ctx.db.get(controllerId);

        if (!existing || existing.adminId !== user._id) {
            throw new Error("Controller not found");
        }

        await ctx.db.delete(controllerId);
    },
});

export const getMany = query({
    args: {
        paginationOpts: paginationOptsValidator,
        search: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        const { user } = await requireAccess(ctx, {
            controller: ["list"],
        });

        const { paginationOpts, search } = args;

        let resultsQuery;

        const searchValue = search;

        if (!!searchValue) {
            resultsQuery = ctx.db
                .query("controller")
                .withSearchIndex("search_name", (q) =>
                    q.search("name", searchValue).eq("adminId", user._id)
                );
        } else {
            resultsQuery = ctx.db
                .query("controller")
                .withIndex("by_admin_id", (q) => q.eq("adminId", user._id))
                .order("desc");
        }

        const results = await resultsQuery.paginate(paginationOpts);

        const userIds: Id<"user">[] = results.page.map(
            (c) => c.userId as Id<"user">
        );

        const users: PaginationResult<Doc<"user">> = await ctx.runQuery(
            components.betterAuth.adapter.findMany,
            {
                model: "user",
                where: [
                    {
                        field: "_id",
                        value: userIds,
                        operator: "in",
                    },
                ],
                paginationOpts: {
                    cursor: null,
                    numItems: userIds.length,
                },
            }
        );

        const userMap = new Map(users.page.map((u) => [u._id, u.username]));

        return {
            ...results,
            page: results.page
                .filter((c) => userMap.has(c.userId as Id<"user">))
                .map((controller) => ({
                    id: controller._id,
                    createdAt: controller._creationTime,
                    updatedAt: controller.updatedAt,
                    name: controller.name,
                    username: userMap.get(controller.userId as Id<"user">)!,
                    latitude: controller.latitudeE6 / LOCATION_MULTIPLIER,
                    longitude: controller.longitudeE6 / LOCATION_MULTIPLIER,
                    settings: {
                        minFreqHz: controller.minFreqHz,
                        maxFreqHz: controller.maxFreqHz,
                        sampleRate: controller.sampleRate,
                        vgaGain: controller.vgaGain,
                        lnaGain: controller.lnaGain,
                        bufferSize: controller.bufferSize,
                    },
                })),
        };
    },
});
