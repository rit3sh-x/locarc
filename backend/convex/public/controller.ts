import { query, mutation } from "../_generated/server";
import { LOCATION_MULTIPLIER } from "../lib/constants";
import { requireAccess } from "../lib/utils";
import { ConvexError, v } from "convex/values";

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

        if (!controller) {
            throw new ConvexError({
                code: "NOT_FOUND",
                message: "Controller not found",
            });
        }

        return {
            started: user.started,
            name: user.name,
            serialNumber: controller.serialNumber,
            longitude: controller.longitudeE6 / LOCATION_MULTIPLIER,
            latitude: controller.latitudeE6 / LOCATION_MULTIPLIER,
            settings: {
                minFreq: controller.minFreqHz,
                maxFreq: controller.maxFreqHz,
                sampleRate: controller.sampleRate,
                vgaGain: controller.vgaGain,
                lnaGain: controller.lnaGain,
                bufferSize: controller.bufferSize,
            },
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
