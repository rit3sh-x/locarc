import {
    internalAction,
    internalMutation,
    internalQuery,
} from "../_generated/server";
import { internal } from "../_generated/api";
import { ConvexError, v } from "convex/values";
import {
    LOCATION_MULTIPLIER,
    DISPATCH_TIMEOUT_MS,
    STALE_BATCH_TTL_MS,
} from "../lib/constants";
import { hmacSign } from "../lib/utils";

const computeUrl = process.env.COMPUTE_SERVICE_URL!;
const convexSiteUrl = process.env.CONVEX_SITE_URL!;
const webhookSecret = process.env.WEBHOOK_SECRET!;

export const getDispatchableBatches = internalQuery({
    args: {},
    handler: async (ctx) => {
        const processingBatches = await ctx.db
            .query("jobBatch")
            .withIndex("by_status", (q) => q.eq("status", "PROCESSING"))
            .collect();

        return processingBatches.filter((b) => !b.dispatchedAt);
    },
});

export const getTimedOutBatches = internalQuery({
    args: { now: v.number() },
    handler: async (ctx, { now }) => {
        const processingBatches = await ctx.db
            .query("jobBatch")
            .withIndex("by_status", (q) => q.eq("status", "PROCESSING"))
            .collect();

        return processingBatches
            .filter(
                (b) =>
                    b.dispatchedAt !== undefined &&
                    b.dispatchedAt + DISPATCH_TIMEOUT_MS < now
            )
            .map((b) => b._id);
    },
});

export const getBatchPayload = internalQuery({
    args: { batchId: v.id("jobBatch") },
    handler: async (ctx, { batchId }) => {
        const batch = await ctx.db.get(batchId);
        if (!batch) return null;

        const measurements = await ctx.db
            .query("sdrMeasurement")
            .withIndex("by_job_batch_id", (q) => q.eq("jobBatchId", batchId))
            .collect();

        const controllerIds = [
            ...new Set(measurements.map((m) => m.controllerId)),
        ];

        const controllers = (
            await Promise.all(controllerIds.map((id) => ctx.db.get(id)))
        ).filter(Boolean);

        return {
            batchId: batch._id,
            scanId: batch.scanId,
            controllers: controllers.map((c) => ({
                controllerId: c!._id,
                latitude: c!.latitudeE6 / LOCATION_MULTIPLIER,
                longitude: c!.longitudeE6 / LOCATION_MULTIPLIER,
                settings: {
                    minFreqHz: c!.minFreqHz,
                    maxFreqHz: c!.maxFreqHz,
                    sampleRate: c!.sampleRate,
                    vgaGain: c!.vgaGain,
                    lnaGain: c!.lnaGain,
                    bufferSize: c!.bufferSize,
                },
            })),
            measurements: measurements.map((m) => ({
                controllerId: m.controllerId,
                samples: m.samples,
            })),
        };
    },
});

export const markDispatched = internalMutation({
    args: { batchId: v.id("jobBatch"), dispatchedAt: v.number() },
    handler: async (ctx, { batchId, dispatchedAt }) => {
        await ctx.db.patch(batchId, { dispatchedAt });
    },
});

export const markBatchFailed = internalMutation({
    args: { batchId: v.id("jobBatch") },
    handler: async (ctx, { batchId }) => {
        const now = Date.now();
        await ctx.db.patch(batchId, {
            status: "FAILED",
            batchEndedAt: now,
        });
    },
});

export const dispatchPendingBatches = internalAction({
    args: {},
    handler: async (ctx) => {
        const now = Date.now();

        const timedOut = await ctx.runQuery(
            internal.jobs.localiation.getTimedOutBatches,
            { now }
        );

        for (const batchId of timedOut) {
            await ctx.runMutation(internal.jobs.localiation.markBatchFailed, {
                batchId,
            });
            console.warn(`Batch ${batchId} timed out – marked FAILED`);
        }

        const batches = await ctx.runQuery(
            internal.jobs.localiation.getDispatchableBatches
        );

        if (batches.length === 0) return;

        if (!computeUrl || !convexSiteUrl || !webhookSecret) {
            console.error(
                "Missing required env vars: COMPUTER_SERVICE_URL, CONVEX_SITE_URL, WEBHOOK_SECRET"
            );
            return;
        }

        for (const batch of batches) {
            const payload = await ctx.runQuery(
                internal.jobs.localiation.getBatchPayload,
                { batchId: batch._id }
            );

            if (!payload) {
                console.warn(`Batch ${batch._id} has no payload – skipping`);
                continue;
            }

            try {
                const body = JSON.stringify({
                    ...payload,
                    callbackUrl: `${convexSiteUrl}/api/webhook/localization`,
                });

                const signature = await hmacSign(webhookSecret, body);

                const response = await fetch(computeUrl, {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        "X-Webhook-Secret": webhookSecret,
                        "X-Signature-256": signature,
                    },
                    body,
                });

                if (!response.ok) {
                    console.error(
                        `Dispatch failed for batch ${batch._id}: HTTP ${response.status}`
                    );
                    continue;
                }

                await ctx.runMutation(
                    internal.jobs.localiation.markDispatched,
                    { batchId: batch._id, dispatchedAt: now }
                );
            } catch (error) {
                console.error(`Error dispatching batch ${batch._id}:`, error);
            }
        }
    },
});

export const processWebhookResults = internalMutation({
    args: {
        batchId: v.id("jobBatch"),
        scanId: v.string(),
        locations: v.array(
            v.object({
                centerLongitude: v.number(),
                centerLatitude: v.number(),
                bounds: v.array(
                    v.object({
                        longitude: v.number(),
                        latitude: v.number(),
                    })
                ),
            })
        ),
    },
    handler: async (ctx, args) => {
        const batch = await ctx.db.get(args.batchId);

        if (!batch) {
            throw new ConvexError({
                code: "NOT_FOUND",
                message: "Batch not found",
            });
        }

        if (batch.status !== "PROCESSING") {
            throw new ConvexError({
                code: "INVALID_STATE",
                message: `Batch status is ${batch.status}, expected PROCESSING`,
            });
        }

        if (batch.scanId !== args.scanId) {
            throw new ConvexError({
                code: "INVALID_INPUT",
                message: "Scan ID mismatch",
            });
        }

        const now = Date.now();

        const oldLocations = await ctx.db
            .query("location")
            .withIndex("by_admin_id", (q) => q.eq("adminId", batch.adminId))
            .collect();
        for (const old of oldLocations) {
            await ctx.db.delete(old._id);
        }

        for (const loc of args.locations) {
            await ctx.db.insert("location", {
                jobBatchId: args.batchId,
                adminId: batch.adminId,
                scanId: args.scanId,
                centerLongitudeE6: Math.round(
                    loc.centerLongitude * LOCATION_MULTIPLIER
                ),
                centerLatitudeE6: Math.round(
                    loc.centerLatitude * LOCATION_MULTIPLIER
                ),
                bounds: loc.bounds.map((b) => ({
                    longitudeE6: Math.round(b.longitude * LOCATION_MULTIPLIER),
                    latitudeE6: Math.round(b.latitude * LOCATION_MULTIPLIER),
                })),
            });
        }

        await ctx.db.patch(args.batchId, {
            status: "COMPLETED",
            processingCompletedAt: now,
            batchEndedAt: now,
        });
    },
});

export const getStaleBatchIds = internalQuery({
    args: { cutoffTimestamp: v.number() },
    handler: async (ctx, { cutoffTimestamp }) => {
        const completed = await ctx.db
            .query("jobBatch")
            .withIndex("by_status", (q) => q.eq("status", "COMPLETED"))
            .collect();

        const failed = await ctx.db
            .query("jobBatch")
            .withIndex("by_status", (q) => q.eq("status", "FAILED"))
            .collect();

        return [...completed, ...failed]
            .filter(
                (b) => (b.batchEndedAt ?? b.batchStartedAt) < cutoffTimestamp
            )
            .map((b) => b._id);
    },
});

export const deleteBatchData = internalMutation({
    args: { batchId: v.id("jobBatch") },
    handler: async (ctx, { batchId }) => {
        const statuses = await ctx.db
            .query("jobControllerStatus")
            .withIndex("by_job_batch_id", (q) => q.eq("jobBatchId", batchId))
            .collect();
        for (const row of statuses) {
            await ctx.db.delete(row._id);
        }

        const measurements = await ctx.db
            .query("sdrMeasurement")
            .withIndex("by_job_batch_id", (q) => q.eq("jobBatchId", batchId))
            .collect();
        for (const row of measurements) {
            await ctx.db.delete(row._id);
        }

        const locations = await ctx.db
            .query("location")
            .withIndex("by_job_batch_id", (q) => q.eq("jobBatchId", batchId))
            .collect();
        for (const row of locations) {
            await ctx.db.delete(row._id);
        }

        await ctx.db.delete(batchId);
    },
});

export const cleanupOldBatches = internalAction({
    args: {},
    handler: async (ctx) => {
        const cutoff = Date.now() - STALE_BATCH_TTL_MS;

        const staleIds = await ctx.runQuery(
            internal.jobs.localiation.getStaleBatchIds,
            { cutoffTimestamp: cutoff }
        );

        if (staleIds.length === 0) return;

        let cleaned = 0;

        for (const batchId of staleIds) {
            try {
                await ctx.runMutation(
                    internal.jobs.localiation.deleteBatchData,
                    { batchId }
                );
                cleaned++;
            } catch (error) {
                console.error(`Failed to cleanup batch ${batchId}:`, error);
            }
        }

        console.log(
            `Cleanup: removed ${cleaned}/${staleIds.length} stale batch(es)`
        );
    },
});
