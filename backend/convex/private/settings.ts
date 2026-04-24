import { internalMutation, mutation, query } from "../_generated/server";
import { ConvexError, v } from "convex/values";
import { requireAccess } from "../lib/utils";

export const DEFAULT_SETTINGS = {
    phase1: {
        sigBwHz: 200_000,
        perOlf: 0,
        numSamUseRatio: 0.5,
        maxTh: 0.09,
        kaiserBeta: 36,
        highpassOrder: 1,
        highpassCutoff: 0.0001,
        noiseMinPeaks: 10,
        noiseMaxDiff: 10,
    },
    phase2: {
        requiredFs1Hz: 200_000,
        chSpacingHz: 10_000,
        perOlfP1: 0,
        numSamUseRatioP1: 0.5,
        maxThP1: 0.4,
        kaiserBetaP1: 60,
        lpfOrder: 2,
        lpfCutoff: 0.03,
        noiseMinPeaksP2: 25,
        noiseMaxDiffP2: 10,
        dcGuardHz: 12_500,
    },
    channelMapping: {
        bandStartFreqHz: 300_000_000,
        bandEndFreqHz: 500_000_000,
        channelSpacingMapHz: 12_500,
        powerCalOffsetDb: -90,
        sidelobeDedupHz: 150_000,
    },
    powerDetection: {
        priorKnowledgeBwHz: 10_000,
        zoomFsPowerHz: 50_000,
        sigBwPowHz: 5_000,
        maxThPow: 0.4,
        kaiserBetaPow: 60,
        noiseMinPeaksPow: 15,
        noiseMaxDiffPow: 10,
    },
    localization: {
        algorithm: "annulus" as const,
        pathLossExponent: 3.5,
        ptSearchRangeMinDbm: 20.0,
        ptSearchRangeMaxDbm: 43.0,
        ptSearchStepDbm: 0.5,
        powerErrorRangeDb: 3.0,
        channelToleranceHz: 150_000,
        channelMaxSpanHz: 400_000,
        minControllersPerChannel: 3,
        minPeakDbm: -110,
    },
};

export const createForOrg = internalMutation({
    args: {
        orgSlug: v.string(),
    },
    handler: async (ctx, { orgSlug }) => {
        const existing = await ctx.db
            .query("settings")
            .withIndex("by_org_slug", (q) => q.eq("orgSlug", orgSlug))
            .unique();

        if (existing) return existing._id;

        return await ctx.db.insert("settings", {
            orgSlug,
            ...DEFAULT_SETTINGS,
        });
    },
});

export const get = query({
    args: {},
    handler: async (ctx) => {
        const { user } = await requireAccess(ctx, {
            settings: ["read"],
        });

        const settings = await ctx.db
            .query("settings")
            .withIndex("by_org_slug", (q) =>
                q.eq("orgSlug", user.organizationSlug)
            )
            .unique();

        if (!settings) {
            throw new ConvexError("Settings not found for this organization.");
        }

        return settings;
    },
});

export const update = mutation({
    args: {
        phase1: v.optional(
            v.object({
                sigBwHz: v.optional(v.number()),
                perOlf: v.optional(v.number()),
                numSamUseRatio: v.optional(v.number()),
                maxTh: v.optional(v.number()),
                kaiserBeta: v.optional(v.number()),
                highpassOrder: v.optional(v.number()),
                highpassCutoff: v.optional(v.number()),
                noiseMinPeaks: v.optional(v.number()),
                noiseMaxDiff: v.optional(v.number()),
            })
        ),
        phase2: v.optional(
            v.object({
                requiredFs1Hz: v.optional(v.number()),
                chSpacingHz: v.optional(v.number()),
                perOlfP1: v.optional(v.number()),
                numSamUseRatioP1: v.optional(v.number()),
                maxThP1: v.optional(v.number()),
                kaiserBetaP1: v.optional(v.number()),
                lpfOrder: v.optional(v.number()),
                lpfCutoff: v.optional(v.number()),
                noiseMinPeaksP2: v.optional(v.number()),
                noiseMaxDiffP2: v.optional(v.number()),
                dcGuardHz: v.optional(v.number()),
            })
        ),
        channelMapping: v.optional(
            v.object({
                bandStartFreqHz: v.optional(v.number()),
                bandEndFreqHz: v.optional(v.number()),
                channelSpacingMapHz: v.optional(v.number()),
                powerCalOffsetDb: v.optional(v.number()),
                sidelobeDedupHz: v.optional(v.number()),
            })
        ),
        powerDetection: v.optional(
            v.object({
                priorKnowledgeBwHz: v.optional(v.number()),
                zoomFsPowerHz: v.optional(v.number()),
                sigBwPowHz: v.optional(v.number()),
                maxThPow: v.optional(v.number()),
                kaiserBetaPow: v.optional(v.number()),
                noiseMinPeaksPow: v.optional(v.number()),
                noiseMaxDiffPow: v.optional(v.number()),
            })
        ),
        localization: v.optional(
            v.object({
                algorithm: v.optional(
                    v.union(v.literal("fourCircle"), v.literal("annulus"))
                ),
                pathLossExponent: v.optional(v.number()),
                ptSearchRangeMinDbm: v.optional(v.number()),
                ptSearchRangeMaxDbm: v.optional(v.number()),
                ptSearchStepDbm: v.optional(v.number()),
                powerErrorRangeDb: v.optional(v.number()),
                channelToleranceHz: v.optional(v.number()),
                channelMaxSpanHz: v.optional(v.number()),
                minControllersPerChannel: v.optional(v.number()),
                minPeakDbm: v.optional(v.number()),
            })
        ),
    },
    handler: async (ctx, args) => {
        const { user } = await requireAccess(ctx, {
            settings: ["update"]
        });

        const settings = await ctx.db
            .query("settings")
            .withIndex("by_org_slug", (q) =>
                q.eq("orgSlug", user.organizationSlug)
            )
            .unique();

        if (!settings) {
            throw new ConvexError("Settings not found for this organization.");
        }

        await ctx.db.patch(settings._id, {
            ...(args.phase1 && {
                phase1: { ...settings.phase1, ...args.phase1 },
            }),
            ...(args.phase2 && {
                phase2: { ...settings.phase2, ...args.phase2 },
            }),
            ...(args.channelMapping && {
                channelMapping: {
                    ...settings.channelMapping,
                    ...args.channelMapping,
                },
            }),
            ...(args.powerDetection && {
                powerDetection: {
                    ...(settings.powerDetection ??
                        DEFAULT_SETTINGS.powerDetection),
                    ...args.powerDetection,
                },
            }),
            ...(args.localization && {
                localization: {
                    ...settings.localization,
                    ...args.localization,
                },
            }),
        });
    },
});

export const reset = mutation({
    args: {},
    handler: async (ctx) => {
        const { user } = await requireAccess(ctx, {
            settings: ["update"]
        });

        const settings = await ctx.db
            .query("settings")
            .withIndex("by_org_slug", (q) =>
                q.eq("orgSlug", user.organizationSlug)
            )
            .unique();

        if (!settings) {
            throw new ConvexError("Settings not found for this organization.");
        }

        await ctx.db.patch(settings._id, DEFAULT_SETTINGS);
    },
});
