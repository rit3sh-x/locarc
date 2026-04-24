import {
    internalAction,
    internalMutation,
    internalQuery,
} from "../_generated/server";
import { internal, components } from "../_generated/api";
import { nanoid } from "nanoid";
import { ConvexError, v } from "convex/values";
import {
    LOCATION_MULTIPLIER,
    DISPATCH_TIMEOUT_MS,
    STALE_BATCH_TTL_MS,
    STALE_SDR_TTL_MS,
    STALE_LOCATION_TTL_MS,
    LOCATION_STALE_AFTER_MS,
    CLEANUP_PAGE_SIZE,
    DEFAULT_CONTROLLER_LATITUDE,
    DEFAULT_CONTROLLER_LONGITUDE,
    SCAN_ID_LENGTH,
} from "../lib/constants";
import { PaginationResult } from "convex/server";
import { Doc } from "../betterAuth/_generated/dataModel";

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

        const admin: Doc<"user"> | null = await ctx.runQuery(
            components.betterAuth.adapter.findOne,
            {
                model: "user",
                where: [
                    { field: "_id", value: batch.adminId, operator: "eq" },
                ],
            }
        );

        let localizationConfig = null;
        if (admin?.organizationSlug) {
            const settings = await ctx.db
                .query("settings")
                .withIndex("by_org_slug", (q) =>
                    q.eq("orgSlug", admin.organizationSlug)
                )
                .unique();

            if (settings) {
                localizationConfig = settings.localization;
            }
        }

        return {
            batchId: batch._id,
            scanId: batch.scanId,
            localizationConfig,
            controllers: controllers.map((c) => ({
                controllerId: c!._id,
                latitude: c!.latitudeE6 / LOCATION_MULTIPLIER,
                longitude: c!.longitudeE6 / LOCATION_MULTIPLIER,
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
            internal.jobs.localization.getTimedOutBatches,
            { now }
        );

        for (const batchId of timedOut) {
            await ctx.runMutation(internal.jobs.localization.markBatchFailed, {
                batchId,
            });
            console.warn(`Batch ${batchId} timed out – marked FAILED`);
        }

        const batches = await ctx.runQuery(
            internal.jobs.localization.getDispatchableBatches
        );

        if (batches.length === 0) return;

        for (const batch of batches) {
            await ctx.runMutation(
                internal.jobs.localization.markDispatched,
                { batchId: batch._id, dispatchedAt: now }
            );
            await ctx.scheduler.runAfter(0, internal.jobs.compute.localize, {
                batchId: batch._id,
            });
            console.log(`Dispatched batch ${batch._id} to in-process compute`);
        }
    },
});

export const storeLocationResults = internalMutation({
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
                frequencyHz: v.optional(v.number()),
                controllerCount: v.optional(v.number()),
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

        const sameBatchLocations = await ctx.db
            .query("location")
            .withIndex("by_job_batch_id", (q) => q.eq("jobBatchId", args.batchId))
            .collect();
        for (const old of sameBatchLocations) {
            await ctx.db.delete(old._id);
        }

        const priorFresh = await ctx.db
            .query("location")
            .withIndex("by_admin_id", (q) => q.eq("adminId", batch.adminId))
            .filter((q) => q.neq(q.field("isStale"), true))
            .collect();
        for (const p of priorFresh) {
            if (p.jobBatchId !== args.batchId) {
                await ctx.db.patch(p._id, { isStale: true });
            }
        }

        const isValidLat = (v: number) =>
            Number.isFinite(v) && v >= -90 && v <= 90;
        const isValidLon = (v: number) =>
            Number.isFinite(v) && v >= -180 && v <= 180;

        let rejected = 0;
        for (const loc of args.locations) {
            if (
                !isValidLat(loc.centerLatitude) ||
                !isValidLon(loc.centerLongitude)
            ) {
                rejected++;
                console.warn(
                    `storeLocationResults: rejected invalid GPS (${loc.centerLatitude}, ${loc.centerLongitude}) for batch ${args.batchId}`
                );
                continue;
            }
            const validBounds = loc.bounds.filter(
                (b) => isValidLat(b.latitude) && isValidLon(b.longitude)
            );
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
                bounds: validBounds.map((b) => ({
                    longitudeE6: Math.round(b.longitude * LOCATION_MULTIPLIER),
                    latitudeE6: Math.round(b.latitude * LOCATION_MULTIPLIER),
                })),
                frequencyHz: loc.frequencyHz,
                controllerCount: loc.controllerCount,
                isStale: false,
            });
        }
        if (rejected > 0) {
            console.warn(
                `storeLocationResults batch=${args.batchId}: rejected ${rejected} invalid location(s)`
            );
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

        await ctx.db.delete(batchId);
    },
});

export const cleanupOldBatches = internalAction({
    args: {},
    handler: async (ctx) => {
        const cutoff = Date.now() - STALE_BATCH_TTL_MS;

        const staleIds = await ctx.runQuery(
            internal.jobs.localization.getStaleBatchIds,
            { cutoffTimestamp: cutoff }
        );

        if (staleIds.length === 0) return;

        let cleaned = 0;

        for (const batchId of staleIds) {
            try {
                await ctx.runMutation(
                    internal.jobs.localization.deleteBatchData,
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

export const getActiveAdmins = internalQuery({
    args: {},
    handler: async (ctx) => {
        const admins: PaginationResult<Doc<"user">> = await ctx.runQuery(
            components.betterAuth.adapter.findMany,
            {
                model: "user",
                where: [
                    { field: "role", operator: "eq", value: "ADMIN" },
                    { field: "started", operator: "eq", value: true },
                ],
                paginationOpts: { cursor: null, numItems: 1000 },
            }
        );
        return admins.page.map((a) => ({ adminId: a._id }));
    },
});

export const getEligibleControllers = internalQuery({
    args: { adminId: v.string() },
    handler: async (ctx, { adminId }) => {
        const controllers = await ctx.db
            .query("controller")
            .withIndex("by_admin_id", (q) => q.eq("adminId", adminId))
            .collect();

        return controllers.filter(
            (c) =>
                c.latitudeE6 !== DEFAULT_CONTROLLER_LATITUDE * LOCATION_MULTIPLIER ||
                c.longitudeE6 !== DEFAULT_CONTROLLER_LONGITUDE * LOCATION_MULTIPLIER
        );
    },
});

export const createBatchForAdmin = internalMutation({
    args: {
        adminId: v.string(),
        controllerIds: v.array(v.id("controller")),
        controllerUserIds: v.array(v.string()),
    },
    handler: async (
        ctx,
        { adminId, controllerIds, controllerUserIds }
    ) => {
        const now = Date.now();
        const scanId = nanoid(SCAN_ID_LENGTH);

        const batchId = await ctx.db.insert("jobBatch", {
            adminId,
            scanId,
            status: "PENDING",
            batchStartedAt: now,
            expectedControllerCount: controllerIds.length,
            receivedControllerCount: 0,
        });

        for (let i = 0; i < controllerIds.length; i++) {
            await ctx.db.insert("jobControllerStatus", {
                jobBatchId: batchId,
                controllerId: controllerIds[i],
                userId: controllerUserIds[i],
                scanId,
                received: false,
            });
        }

        return batchId;
    },
});

export const getOldSdrMeasurementIds = internalQuery({
    args: { cutoffTimestamp: v.number(), limit: v.number() },
    handler: async (ctx, { cutoffTimestamp, limit }) => {
        const rows = await ctx.db
            .query("sdrMeasurement")
            .order("asc")
            .take(limit);
        return rows
            .filter((r) => r._creationTime < cutoffTimestamp)
            .map((r) => r._id);
    },
});

export const deleteSdrMeasurements = internalMutation({
    args: { ids: v.array(v.id("sdrMeasurement")) },
    handler: async (ctx, { ids }) => {
        for (const id of ids) await ctx.db.delete(id);
    },
});

export const cleanupOldSdrMeasurements = internalAction({
    args: {},
    handler: async (ctx) => {
        const cutoff = Date.now() - STALE_SDR_TTL_MS;
        let removed = 0;
        for (let i = 0; i < 10; i++) {
            const ids = await ctx.runQuery(
                internal.jobs.localization.getOldSdrMeasurementIds,
                { cutoffTimestamp: cutoff, limit: CLEANUP_PAGE_SIZE }
            );
            if (ids.length === 0) break;
            await ctx.runMutation(
                internal.jobs.localization.deleteSdrMeasurements,
                { ids }
            );
            removed += ids.length;
            if (ids.length < CLEANUP_PAGE_SIZE) break;
        }
        if (removed > 0) {
            console.log(`Cleanup: removed ${removed} old SDR measurement(s)`);
        }
    },
});

export const getStaleableLocationIds = internalQuery({
    args: { cutoffTimestamp: v.number(), limit: v.number() },
    handler: async (ctx, { cutoffTimestamp, limit }) => {
        const rows = await ctx.db
            .query("location")
            .order("asc")
            .take(limit * 2);
        return rows
            .filter(
                (r) =>
                    r._creationTime < cutoffTimestamp && r.isStale !== true
            )
            .slice(0, limit)
            .map((r) => r._id);
    },
});

export const markLocationsStale = internalMutation({
    args: { ids: v.array(v.id("location")) },
    handler: async (ctx, { ids }) => {
        for (const id of ids) await ctx.db.patch(id, { isStale: true });
    },
});

export const getExpiredLocationIds = internalQuery({
    args: { cutoffTimestamp: v.number(), limit: v.number() },
    handler: async (ctx, { cutoffTimestamp, limit }) => {
        const rows = await ctx.db
            .query("location")
            .order("asc")
            .take(limit);
        return rows
            .filter((r) => r._creationTime < cutoffTimestamp)
            .map((r) => r._id);
    },
});

export const deleteLocations = internalMutation({
    args: { ids: v.array(v.id("location")) },
    handler: async (ctx, { ids }) => {
        for (const id of ids) await ctx.db.delete(id);
    },
});

export const cleanupOldLocations = internalAction({
    args: {},
    handler: async (ctx) => {
        const now = Date.now();
        const staleCutoff = now - LOCATION_STALE_AFTER_MS;
        const expireCutoff = now - STALE_LOCATION_TTL_MS;

        let marked = 0;
        for (let i = 0; i < 10; i++) {
            const ids = await ctx.runQuery(
                internal.jobs.localization.getStaleableLocationIds,
                { cutoffTimestamp: staleCutoff, limit: CLEANUP_PAGE_SIZE }
            );
            if (ids.length === 0) break;
            await ctx.runMutation(
                internal.jobs.localization.markLocationsStale,
                { ids }
            );
            marked += ids.length;
            if (ids.length < CLEANUP_PAGE_SIZE) break;
        }

        let removed = 0;
        for (let i = 0; i < 10; i++) {
            const ids = await ctx.runQuery(
                internal.jobs.localization.getExpiredLocationIds,
                { cutoffTimestamp: expireCutoff, limit: CLEANUP_PAGE_SIZE }
            );
            if (ids.length === 0) break;
            await ctx.runMutation(
                internal.jobs.localization.deleteLocations,
                { ids }
            );
            removed += ids.length;
            if (ids.length < CLEANUP_PAGE_SIZE) break;
        }

        if (marked > 0 || removed > 0) {
            console.log(
                `Cleanup: marked ${marked} location(s) stale, removed ${removed} expired location(s)`
            );
        }
    },
});

export const createBatchesForActiveAdmins = internalAction({
    args: {},
    handler: async (ctx) => {
        const activeAdmins = await ctx.runQuery(
            internal.jobs.localization.getActiveAdmins
        );

        if (activeAdmins.length === 0) return;

        let created = 0;

        for (const { adminId } of activeAdmins) {
            const controllers = await ctx.runQuery(
                internal.jobs.localization.getEligibleControllers,
                { adminId }
            );

            if (controllers.length === 0) {
                console.log(`Admin ${adminId}: no eligible controllers, skipping batch`);
                continue;
            }

            try {
                await ctx.runMutation(
                    internal.jobs.localization.createBatchForAdmin,
                    {
                        adminId,
                        controllerIds: controllers.map((c) => c._id),
                        controllerUserIds: controllers.map((c) => c.userId),
                    }
                );
                created++;
            } catch (error) {
                console.error(`Failed to create batch for admin ${adminId}:`, error);
            }
        }

        if (created > 0) {
            console.log(`Created ${created} batch(es) for ${activeAdmins.length} active admin(s)`);
        }
    },
});
