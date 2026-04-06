import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export const jobStatusEnum = v.union(
    v.literal("PENDING"),
    v.literal("PROCESSING"),
    v.literal("COMPLETED"),
    v.literal("FAILED")
);

export default defineSchema({
    controller: defineTable({
        adminId: v.string(),
        userId: v.string(),
        name: v.string(),
        serialNumber: v.optional(v.string()),
        longitudeE6: v.number(),
        latitudeE6: v.number(),
        minFreqHz: v.number(),
        maxFreqHz: v.number(),
        sampleRate: v.number(),
        vgaGain: v.number(),
        lnaGain: v.number(),
        bufferSize: v.number(),
        updatedAt: v.number(),
    })
        .index("by_admin_id", ["adminId"])
        .index("by_user_id", ["userId"])
        .index("by_admin_and_user", ["adminId", "userId"])
        .searchIndex("search_name", {
            searchField: "name",
            filterFields: ["adminId"],
        })
        .index("by_serial_number", ["serialNumber"]),

    jobBatch: defineTable({
        adminId: v.string(),
        scanId: v.string(),
        status: jobStatusEnum,
        batchStartedAt: v.number(),
        batchEndedAt: v.optional(v.number()),
        expectedControllerCount: v.number(),
        receivedControllerCount: v.number(),
        processingStartedAt: v.optional(v.number()),
        processingCompletedAt: v.optional(v.number()),
        dispatchedAt: v.optional(v.number()),
    })
        .index("by_admin_id", ["adminId"])
        .index("by_status", ["status"])
        .index("by_scan_id", ["scanId"])
        .index("by_admin_and_scan", ["adminId", "scanId"])
        .index("by_admin_and_status", ["adminId", "status"]),

    jobControllerStatus: defineTable({
        jobBatchId: v.id("jobBatch"),
        controllerId: v.id("controller"),
        userId: v.string(),
        scanId: v.string(),
        received: v.boolean(),
        receivedAt: v.optional(v.number()),
        measurementCount: v.optional(v.number()),
    })
        .index("by_job_batch_id", ["jobBatchId"])
        .index("by_controller_id", ["controllerId"])
        .index("by_user_id", ["userId"])
        .index("by_scan_id", ["scanId"])
        .index("by_received", ["received"])
        .index("by_batch_and_controller", ["jobBatchId", "controllerId"]),

    sdrMeasurement: defineTable({
        jobBatchId: v.id("jobBatch"),
        controllerId: v.id("controller"),
        userId: v.string(),
        scanId: v.string(),
        samples: v.array(
            v.object({
                frequencyHz: v.number(),
                powerDbm: v.number(),
            })
        ),
    })
        .index("by_job_batch_id", ["jobBatchId"])
        .index("by_controller_id", ["controllerId"])
        .index("by_scan_id", ["scanId"]),

    location: defineTable({
        jobBatchId: v.id("jobBatch"),
        adminId: v.string(),
        scanId: v.string(),
        centerLongitudeE6: v.number(),
        centerLatitudeE6: v.number(),
        bounds: v.array(
            v.object({
                longitudeE6: v.number(),
                latitudeE6: v.number(),
            })
        ),
    })
        .index("by_job_batch_id", ["jobBatchId"])
        .index("by_admin_id", ["adminId"])
        .index("by_scan_id", ["scanId"]),

    settings: defineTable({
        orgSlug: v.string(),
        phase1: v.object({
            sigBwHz: v.number(),
            chSpacingHz: v.number(),
            perOlf: v.number(),
            numSamUseRatio: v.number(),
            maxTh: v.number(),
            kaiserBeta: v.number(),
            highpassOrder: v.number(),
            highpassCutoff: v.number(),
            noiseMinPeaks: v.number(),
            noiseMaxDiff: v.number(),
        }),
        phase2: v.object({
            requiredFs1Hz: v.number(),
            sigBwP1Hz: v.number(),
            perOlfP1: v.number(),
            numSamUseRatioP1: v.number(),
            maxThP1: v.number(),
            kaiserBetaP1: v.number(),
            lpfOrder: v.number(),
            lpfCutoff: v.number(),
            noiseMinPeaksP2: v.number(),
            noiseMaxDiffP2: v.number(),
        }),
        phase3: v.object({
            priorKnowledgeBwHz: v.number(),
            zoomFsPowerHz: v.number(),
            sigBwPowHz: v.number(),
            maxThPow: v.number(),
            kaiserBetaPow: v.number(),
            noiseMinPeaksPow: v.number(),
            noiseMaxDiffPow: v.number(),
        }),
        channelMapping: v.object({
            bandStartFreqHz: v.number(),
            bandEndFreqHz: v.number(),
            channelSpacingMapHz: v.number(),
        }),
        localization: v.object({
            algorithm: v.union(v.literal("fourCircle"), v.literal("annulus")),
            pathLossExponent: v.number(),
            ptSearchRangeMinDbm: v.number(),
            ptSearchRangeMaxDbm: v.number(),
            ptSearchStepDbm: v.number(),
            powerErrorRangeDb: v.number(),
        }),
    })
        .index("by_org_slug", ["orgSlug"]),
});
