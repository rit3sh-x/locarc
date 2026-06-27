import { mutation, query } from "../_generated/server";
import { requireAccess } from "../lib/utils";
import { ConvexError, v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import {
    CONTROLLER_EMAIL_SUFFIX,
    DEFAULT_CONTROLLER_LATITUDE,
    DEFAULT_CONTROLLER_LONGITUDE,
    LOCATION_MULTIPLIER,
} from "../lib/constants";
import { hashPassword } from "better-auth/crypto";
import { components } from "../_generated/api";
import { Doc, Id } from "../betterAuth/_generated/dataModel";
import type { PaginationResult } from "convex/server";

export const create = mutation({
    args: {
        name: v.string(),
        username: v.string(),
        password: v.string(),
        settings: v.object({
            minFrequencyHz: v.number(),
            maxFrequencyHz: v.number(),
            sampleRateHz: v.number(),
            lnaGainDb: v.number(),
            vgaGainDb: v.number(),
            bufferSizeKb: v.number(),
            powerCalOffsetDbOverride: v.optional(v.number()),
        }),
    },
    handler: async (ctx, input) => {
        const { user: admin } = await requireAccess(ctx, {
            controller: ["create"],
        });

        const { name, password, settings, username } = input;

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
        if (!/^[a-z0-9_-]+$/i.test(username)) {
            throw new ConvexError({
                code: "BAD_REQUEST",
                message: "Username may only contain letters, digits, underscore, hyphen",
            });
        }
        if (password.length < 8)
            throw new ConvexError({
                code: "BAD_REQUEST",
                message: "Password must be at least 8 characters",
            });
        if (settings.vgaGainDb < 0 || settings.vgaGainDb > 62)
            throw new ConvexError({
                code: "BAD_REQUEST",
                message: "vgaGainDb must be between 0 and 62",
            });
        if (settings.bufferSizeKb <= 0)
            throw new ConvexError({
                code: "BAD_REQUEST",
                message: "bufferSizeKb must be positive",
            });
        if (settings.lnaGainDb < 0 || settings.lnaGainDb > 40)
            throw new ConvexError({
                code: "BAD_REQUEST",
                message: "lnaGainDb must be between 0 and 40",
            });
        if (settings.sampleRateHz <= 0)
            throw new ConvexError({
                code: "BAD_REQUEST",
                message: "sampleRateHz must be positive",
            });
        if (settings.minFrequencyHz <= 0 || settings.maxFrequencyHz <= 0)
            throw new ConvexError({
                code: "BAD_REQUEST",
                message: "frequency bounds must be positive",
            });
        if (settings.minFrequencyHz >= settings.maxFrequencyHz)
            throw new ConvexError({
                code: "BAD_REQUEST",
                message: "minFrequencyHz must be less than maxFrequencyHz",
            });

        const user: Doc<"user"> = await ctx.runMutation(
            components.betterAuth.adapter.create,
            {
                input: {
                    model: "user",
                    data: {
                        email: `${username}-${admin.organizationSlug}${CONTROLLER_EMAIL_SUFFIX}`,
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
            organizationSlug: admin.organizationSlug,
            latitudeE6: DEFAULT_CONTROLLER_LATITUDE * LOCATION_MULTIPLIER,
            longitudeE6: DEFAULT_CONTROLLER_LONGITUDE * LOCATION_MULTIPLIER,
            minFrequencyHz: settings.minFrequencyHz,
            maxFrequencyHz: settings.maxFrequencyHz,
            sampleRateHz: settings.sampleRateHz,
            lnaGainDb: settings.lnaGainDb,
            vgaGainDb: settings.vgaGainDb,
            bufferSizeKb: settings.bufferSizeKb,
            powerCalOffsetDbOverride: settings.powerCalOffsetDbOverride,
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
        username: v.optional(v.string()),
        settings: v.optional(
            v.object({
                minFrequencyHz: v.optional(v.number()),
                maxFrequencyHz: v.optional(v.number()),
                sampleRateHz: v.optional(v.number()),
                lnaGainDb: v.optional(v.number()),
                vgaGainDb: v.optional(v.number()),
                bufferSizeKb: v.optional(v.number()),
                powerCalOffsetDbOverride: v.optional(v.number()),
            })
        ),
    },
    handler: async (ctx, args) => {
        const { user: admin } = await requireAccess(ctx, {
            controller: ["update"],
        });

        const {
            controllerId,
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
        if (username !== undefined && !/^[a-z0-9_-]+$/i.test(username)) {
            throw new ConvexError({
                code: "BAD_REQUEST",
                message: "Username may only contain letters, digits, underscore, hyphen",
            });
        }
        if (password !== undefined && password.length < 8)
            throw new ConvexError({
                code: "BAD_REQUEST",
                message: "Password must be at least 8 characters",
            });
        if (
            settings?.vgaGainDb !== undefined &&
            (settings.vgaGainDb < 0 || settings.vgaGainDb > 62)
        )
            throw new ConvexError({
                code: "BAD_REQUEST",
                message: "vgaGainDb must be between 0 and 62",
            });
        if (settings?.bufferSizeKb !== undefined && settings.bufferSizeKb <= 0)
            throw new ConvexError({
                code: "BAD_REQUEST",
                message: "bufferSizeKb must be positive",
            });
        if (
            settings?.lnaGainDb !== undefined &&
            (settings.lnaGainDb < 0 || settings.lnaGainDb > 40)
        )
            throw new ConvexError({
                code: "BAD_REQUEST",
                message: "lnaGainDb must be between 0 and 40",
            });
        if (
            settings?.sampleRateHz !== undefined &&
            settings.sampleRateHz <= 0
        )
            throw new ConvexError({
                code: "BAD_REQUEST",
                message: "sampleRateHz must be positive",
            });
        if (
            settings?.minFrequencyHz !== undefined &&
            settings.minFrequencyHz <= 0
        )
            throw new ConvexError({
                code: "BAD_REQUEST",
                message: "minFrequencyHz must be positive",
            });
        if (
            settings?.maxFrequencyHz !== undefined &&
            settings.maxFrequencyHz <= 0
        )
            throw new ConvexError({
                code: "BAD_REQUEST",
                message: "maxFrequencyHz must be positive",
            });
        if (
            settings?.minFrequencyHz !== undefined &&
            settings?.maxFrequencyHz !== undefined &&
            settings.minFrequencyHz >= settings.maxFrequencyHz
        )
            throw new ConvexError({
                code: "BAD_REQUEST",
                message: "minFrequencyHz must be less than maxFrequencyHz",
            });

        const controller = await ctx.db.get(controllerId);

        if (!controller || controller.adminId !== admin._id) {
            throw new ConvexError({
                code: "NOT_FOUND",
                message: "Controller not found",
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
            throw new ConvexError({
                code: "NOT_FOUND",
                message: "Controller not found",
            });
        }

        const statuses = await ctx.db
            .query("jobControllerStatus")
            .withIndex("by_controller_id", (q) => q.eq("controllerId", controllerId))
            .collect();
        for (const status of statuses) {
            await ctx.db.delete(status._id);
        }

        const measurements = await ctx.db
            .query("sdrMeasurement")
            .withIndex("by_controller_id", (q) => q.eq("controllerId", controllerId))
            .collect();
        for (const measurement of measurements) {
            await ctx.db.delete(measurement._id);
        }

        await ctx.runMutation(components.betterAuth.adapter.deleteMany, {
            input: {
                model: "session",
                where: [
                    { field: "userId", operator: "eq", value: existing.userId },
                ],
            },
            paginationOpts: { cursor: null, numItems: 1000 },
        });

        await ctx.runMutation(components.betterAuth.adapter.deleteMany, {
            input: {
                model: "account",
                where: [
                    { field: "userId", operator: "eq", value: existing.userId },
                ],
            },
            paginationOpts: { cursor: null, numItems: 1000 },
        });

        await ctx.runMutation(components.betterAuth.adapter.deleteOne, {
            input: {
                model: "user",
                where: [
                    { field: "_id", operator: "eq", value: existing.userId },
                ],
            },
        });

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
                        minFrequencyHz: controller.minFrequencyHz,
                        maxFrequencyHz: controller.maxFrequencyHz,
                        sampleRateHz: controller.sampleRateHz,
                        lnaGainDb: controller.lnaGainDb,
                        vgaGainDb: controller.vgaGainDb,
                        bufferSizeKb: controller.bufferSizeKb,
                        powerCalOffsetDbOverride:
                            controller.powerCalOffsetDbOverride,
                    },
                })),
        };
    },
});
