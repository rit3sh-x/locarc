import { query, mutation } from "../_generated/server";
import {
    DEFAULT_CONTROLLER_LATITUDE,
    DEFAULT_CONTROLLER_LONGITUDE,
    LOCATION_MULTIPLIER,
} from "../lib/constants";
import { requireAccess } from "../lib/utils";
import { ConvexError, v } from "convex/values";
import { components } from "../_generated/api";
import type { Doc } from "../betterAuth/_generated/dataModel";

const LOCATION_UPDATE_RADIUS_METERS = 20;

const toRadians = (degrees: number) => (degrees * Math.PI) / 180;

const distanceInMeters = (
    fromLatitude: number,
    fromLongitude: number,
    toLatitude: number,
    toLongitude: number
) => {
    const earthRadiusMeters = 6371000;
    const dLat = toRadians(toLatitude - fromLatitude);
    const dLon = toRadians(toLongitude - fromLongitude);
    const lat1 = toRadians(fromLatitude);
    const lat2 = toRadians(toLatitude);

    const a =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return earthRadiusMeters * c;
};

export const getController = query({
    args: {},
    handler: async (ctx) => {
        const { user } = await requireAccess(ctx, {
            controller: ["getOne"],
        });

        const controller = await ctx.db
            .query("controller")
            .withIndex("by_user_id", (q) => q.eq("userId", user._id))
            .unique();

        if (!controller) {
            throw new ConvexError({
                code: "NOT_FOUND",
                message: "Controller not found",
            });
        }

        const admin: Doc<"user"> | null = await ctx.runQuery(
            components.betterAuth.adapter.findOne,
            {
                model: "user",
                where: [
                    {
                        field: "_id",
                        value: controller.adminId,
                        operator: "eq",
                    },
                ],
            }
        );

        if (!admin) {
            throw new ConvexError({
                code: "NOT_FOUND",
                message: "Admin not found for this controller",
            });
        }

        const algoSettings = await ctx.db
            .query("settings")
            .withIndex("by_org_slug", (q) =>
                q.eq("orgSlug", admin.organizationSlug)
            )
            .unique();

        return {
            started: user.started,
            name: user.name,
            serialNumber: controller.serialNumber,
            longitude: controller.longitudeE6 / LOCATION_MULTIPLIER,
            latitude: controller.latitudeE6 / LOCATION_MULTIPLIER,
            rfSettings: {
                minFreq: controller.minFreqHz,
                maxFreq: controller.maxFreqHz,
                sampleRate: controller.sampleRate,
                vgaGain: controller.vgaGain,
                lnaGain: controller.lnaGain,
                bufferSize: controller.bufferSize,
            },
            algoSettings: algoSettings
                ? {
                      phase1: algoSettings.phase1,
                      phase2: algoSettings.phase2,
                      phase3:
                          controller.powerCalOffsetDbOverride !== undefined
                              ? {
                                    ...algoSettings.phase3,
                                    powerCalOffsetDb:
                                        controller.powerCalOffsetDbOverride,
                                }
                              : algoSettings.phase3,
                      channelMapping: algoSettings.channelMapping,
                  }
                : null,
        };
    },
});

export const getLatestJob = query({
    args: {},
    handler: async (ctx) => {
        const { user } = await requireAccess(ctx, {
            job: ["get"],
        });

        const controller = await ctx.db
            .query("controller")
            .withIndex("by_user_id", (q) => q.eq("userId", user._id))
            .unique();

        if (!controller) {
            throw new ConvexError({
                code: "NOT_FOUND",
                message: "No active controller assigned",
            });
        }

        const latestBatch = await ctx.db
            .query("jobBatch")
            .withIndex("by_admin_and_status", (q) =>
                q.eq("adminId", controller.adminId).eq("status", "PENDING")
            )
            .order("desc")
            .first();

        if (!latestBatch) {
            return {
                hasJob: false,
                message: "No pending jobs available",
            };
        }

        const controllerStatus = await ctx.db
            .query("jobControllerStatus")
            .withIndex("by_batch_and_controller", (q) =>
                q
                    .eq("jobBatchId", latestBatch._id)
                    .eq("controllerId", controller._id)
            )
            .unique();

        if (!controllerStatus) {
            return {
                hasJob: false,
                message: "Controller not assigned to current batch",
            };
        }

        return {
            hasJob: true,
            job: {
                batchId: latestBatch._id,
                scanId: latestBatch.scanId,
                batchStartedAt: latestBatch.batchStartedAt,
                status: latestBatch.status,
                alreadySubmitted: controllerStatus.received,
                submittedAt: controllerStatus.receivedAt,
            },
        };
    },
});

export const submitLocation = mutation({
    args: {
        longitude: v.number(),
        latitude: v.number(),
    },
    handler: async (ctx, { latitude, longitude }) => {
        const { user } = await requireAccess(ctx, {
            controller: ["location"],
        });

        if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
            throw new ConvexError({
                code: "INVALID_INPUT",
                message: "Latitude or longitude out of range",
            });
        }

        const controller = await ctx.db
            .query("controller")
            .withIndex("by_user_id", (q) => q.eq("userId", user._id))
            .unique();

        if (!controller) {
            throw new ConvexError({
                code: "NOT_FOUND",
                message: "No active controller assigned",
            });
        }

        const previousLatitude = controller.latitudeE6 / LOCATION_MULTIPLIER;
        const previousLongitude = controller.longitudeE6 / LOCATION_MULTIPLIER;

        const movedDistanceMeters = distanceInMeters(
            previousLatitude,
            previousLongitude,
            latitude,
            longitude
        );

        const isDefaultStoredLocation =
            previousLatitude === DEFAULT_CONTROLLER_LATITUDE &&
            previousLongitude === DEFAULT_CONTROLLER_LONGITUDE;

        if (isDefaultStoredLocation || movedDistanceMeters > LOCATION_UPDATE_RADIUS_METERS) {
            const now = Date.now();
            const latitudeE6 = Math.round(latitude * LOCATION_MULTIPLIER);
            const longitudeE6 = Math.round(longitude * LOCATION_MULTIPLIER);

            await ctx.db.patch(controller._id, {
                latitudeE6,
                longitudeE6,
                updatedAt: now,
            });
        }
    },
});

export const submitMeasurements = mutation({
    args: {
        jobBatchId: v.id("jobBatch"),
        measurements: v.array(
            v.object({
                frequencyHz: v.number(),
                powerDbm: v.number(),
            })
        ),
    },
    handler: async (ctx, args) => {
        const { user } = await requireAccess(ctx, {
            measurement: ["create"],
        });

        const now = Date.now();

        if (args.measurements.length === 0) {
            throw new ConvexError({
                code: "INVALID_INPUT",
                message: "No measurements provided",
            });
        }

        const controller = await ctx.db
            .query("controller")
            .withIndex("by_user_id", (q) => q.eq("userId", user._id))
            .unique();

        if (!controller) {
            throw new ConvexError({
                code: "NOT_FOUND",
                message: "No active controller assigned",
            });
        }

        const jobBatch = await ctx.db.get(args.jobBatchId);
        if (!jobBatch) {
            throw new ConvexError({
                code: "NOT_FOUND",
                message: "Job batch not found",
            });
        }

        if (jobBatch.status !== "PENDING") {
            throw new ConvexError({
                code: "INVALID_STATE",
                message: `Cannot submit to batch with status: ${jobBatch.status}`,
            });
        }

        const controllerStatus = await ctx.db
            .query("jobControllerStatus")
            .withIndex("by_batch_and_controller", (q) =>
                q
                    .eq("jobBatchId", args.jobBatchId)
                    .eq("controllerId", controller._id)
            )
            .unique();

        if (!controllerStatus) {
            throw new ConvexError({
                code: "FORBIDDEN",
                message: "Controller not assigned to this batch",
            });
        }

        if (controllerStatus.received) {
            throw new ConvexError({
                code: "CONFLICT",
                message: "Measurements already submitted for this batch",
            });
        }

        const scanId = await ctx.db.insert("sdrMeasurement", {
            jobBatchId: args.jobBatchId,
            controllerId: controller._id,
            userId: user._id,
            scanId: jobBatch.scanId,
            samples: args.measurements,
        });

        await ctx.db.patch(controllerStatus._id, {
            received: true,
            receivedAt: now,
            measurementCount: args.measurements.length,
        });

        await ctx.db.patch(controller._id, {
            updatedAt: now,
        });

        await ctx.db.patch(args.jobBatchId, {
            receivedControllerCount: jobBatch.receivedControllerCount + 1,
        });

        const allReceived =
            jobBatch.receivedControllerCount + 1 >=
            jobBatch.expectedControllerCount;

        if (allReceived) {
            await ctx.db.patch(args.jobBatchId, {
                status: "PROCESSING",
                processingStartedAt: now,
            });
        }

        return {
            success: true,
            measurementCount: args.measurements.length,
            scanId,
            batchStatus: allReceived ? "PROCESSING" : "PENDING",
            receivedCount: jobBatch.receivedControllerCount + 1,
            expectedCount: jobBatch.expectedControllerCount,
        };
    },
});
