import { mutation, query } from "../_generated/server";
import { requireAccess } from "../lib/utils";
import { components } from "../_generated/api";
import {
    DEFAULT_CONTROLLER_LATITUDE,
    DEFAULT_CONTROLLER_LONGITUDE,
    LOCATION_MULTIPLIER,
} from "../lib/constants";
import { Id } from "../_generated/dataModel";
import { v } from "convex/values";

export const toggle = mutation({
    args: {},
    handler: async (ctx) => {
        const { user: admin } = await requireAccess(ctx, {
            localization: ["toggle"],
        });

        const newStartedStatus = !admin.started;

        await ctx.runMutation(components.betterAuth.adapter.updateMany, {
            input: {
                model: "user",
                where: [
                    {
                        field: "organizationSlug",
                        operator: "eq",
                        value: admin.organizationSlug,
                    },
                ],
                update: {
                    started: newStartedStatus,
                },
            },
            paginationOpts: {
                numItems: Infinity,
                cursor: null,
            },
        });
    },
});

type StreamResult = {
    locations: {
        id: Id<"location">;
        center: {
            longitude: number;
            latitude: number;
        };
        bounds: {
            longitude: number;
            latitude: number;
        }[];
        frequencyHz?: number;
        controllerCount?: number;
    }[];
    controllers: {
        id: Id<"controller">;
        coordinate: {
            longitude: number;
            latitude: number;
        };
    }[];
};

export const stream = query({
    args: {},
    handler: async (ctx): Promise<StreamResult> => {
        const { user: admin } = await requireAccess(ctx, {
            localization: ["stream"],
        });

        const controllers = await ctx.db
            .query("controller")
            .withIndex("by_admin_id", (q) => q.eq("adminId", admin._id))
            .filter((q) =>
                q.or(
                    q.neq(
                        q.field("latitudeE6"),
                        DEFAULT_CONTROLLER_LATITUDE * LOCATION_MULTIPLIER
                    ),
                    q.neq(
                        q.field("longitudeE6"),
                        DEFAULT_CONTROLLER_LONGITUDE * LOCATION_MULTIPLIER
                    )
                )
            )
            .collect();

        const controllersResult = controllers
            .map((controller) => ({
                id: controller._id,
                coordinate: {
                    longitude: controller.longitudeE6 / LOCATION_MULTIPLIER,
                    latitude: controller.latitudeE6 / LOCATION_MULTIPLIER,
                },
            }));

        const locations = await ctx.db
            .query("location")
            .withIndex("by_admin_id", (q) => q.eq("adminId", admin._id))
            .filter((q) => q.neq(q.field("isStale"), true))
            .collect();

        return {
            locations: locations.map((location) => ({
                id: location._id,
                center: {
                    longitude: location.centerLongitudeE6 / LOCATION_MULTIPLIER,
                    latitude: location.centerLatitudeE6 / LOCATION_MULTIPLIER,
                },
                bounds: location.bounds.map((bound) => ({
                    longitude: bound.longitudeE6 / LOCATION_MULTIPLIER,
                    latitude: bound.latitudeE6 / LOCATION_MULTIPLIER,
                })),
                frequencyHz: location.frequencyHz,
                controllerCount: location.controllerCount,
            })),
            controllers: controllersResult,
        };
    },
});

type ReplayFrameLocation = {
    id: Id<"location">;
    center: {
        longitude: number;
        latitude: number;
    };
    bounds: {
        longitude: number;
        latitude: number;
    }[];
    frequencyHz?: number;
    controllerCount?: number;
};

type ReplayFrame = {
    batchId: Id<"jobBatch">;
    timestampMs: number;
    locations: ReplayFrameLocation[];
};

type ReplayResult = {
    frames: ReplayFrame[];
    controllers: {
        id: Id<"controller">;
        coordinate: {
            longitude: number;
            latitude: number;
        };
    }[];
};

export const replay = query({
    args: {
        startMs: v.number(),
        endMs: v.number(),
    },
    handler: async (ctx, { startMs, endMs }): Promise<ReplayResult> => {
        const { user: admin } = await requireAccess(ctx, {
            localization: ["replay"],
        });

        if (endMs < startMs) {
            return { frames: [], controllers: [] };
        }

        const controllers = await ctx.db
            .query("controller")
            .withIndex("by_admin_id", (q) => q.eq("adminId", admin._id))
            .filter((q) =>
                q.or(
                    q.neq(
                        q.field("latitudeE6"),
                        DEFAULT_CONTROLLER_LATITUDE * LOCATION_MULTIPLIER
                    ),
                    q.neq(
                        q.field("longitudeE6"),
                        DEFAULT_CONTROLLER_LONGITUDE * LOCATION_MULTIPLIER
                    )
                )
            )
            .collect();

        const locations = await ctx.db
            .query("location")
            .withIndex("by_admin_id", (q) => q.eq("adminId", admin._id))
            .filter((q) =>
                q.and(
                    q.gte(q.field("_creationTime"), startMs),
                    q.lte(q.field("_creationTime"), endMs)
                )
            )
            .collect();

        const grouped = new Map<Id<"jobBatch">, typeof locations>();
        for (const loc of locations) {
            const arr = grouped.get(loc.jobBatchId);
            if (arr) arr.push(loc);
            else grouped.set(loc.jobBatchId, [loc]);
        }

        const frames: ReplayFrame[] = [];
        for (const [batchId, rows] of grouped) {
            const timestampMs = Math.min(...rows.map((r) => r._creationTime));
            frames.push({
                batchId,
                timestampMs,
                locations: rows.map((location) => ({
                    id: location._id,
                    center: {
                        longitude: location.centerLongitudeE6 / LOCATION_MULTIPLIER,
                        latitude: location.centerLatitudeE6 / LOCATION_MULTIPLIER,
                    },
                    bounds: location.bounds.map((bound) => ({
                        longitude: bound.longitudeE6 / LOCATION_MULTIPLIER,
                        latitude: bound.latitudeE6 / LOCATION_MULTIPLIER,
                    })),
                    frequencyHz: location.frequencyHz,
                    controllerCount: location.controllerCount,
                })),
            });
        }
        frames.sort((a, b) => a.timestampMs - b.timestampMs);

        return {
            frames,
            controllers: controllers.map((controller) => ({
                id: controller._id,
                coordinate: {
                    longitude: controller.longitudeE6 / LOCATION_MULTIPLIER,
                    latitude: controller.latitudeE6 / LOCATION_MULTIPLIER,
                },
            })),
        };
    },
});
