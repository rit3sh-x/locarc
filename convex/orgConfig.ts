import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { type MutationCtx, mutation, type QueryCtx, query } from "./_generated/server";
import {
  orgConfigDiff,
  orgConfigValidator,
  sameSegments,
  segmentValidator,
  startsNewRun,
  validateOrgConfig,
} from "./lib/config";
import { fail } from "./lib/errors";
import { requireOperator } from "./lib/guards";
import { openRun } from "./runs";

export async function getOrg(ctx: QueryCtx): Promise<Doc<"organization">> {
  const org = await ctx.db.query("organization").first();
  if (!org) fail("NOT_FOUND", "Run `bun run setup` first.");
  return org;
}

export async function configVersion(ctx: QueryCtx, v: number) {
  const version = await ctx.db
    .query("orgConfigVersions")
    .withIndex("by_v", (q) => q.eq("v", v))
    .unique();
  if (!version) fail("NOT_FOUND", `Config version ${v} is missing.`);
  return version;
}

export async function currentConfig(ctx: QueryCtx) {
  const org = await getOrg(ctx);
  return { org, version: await configVersion(ctx, org.configV) };
}

/** Appends an immutable version; callers apply its effects (a new Run, n from the next Scan). */
export async function writeOrgConfig(
  ctx: MutationCtx,
  org: Doc<"organization">,
  values: Doc<"orgConfigVersions">["values"],
  author: string,
  diff: string[],
) {
  const v = org.configV + 1;
  await ctx.db.insert("orgConfigVersions", { v, author, at: Date.now(), values, diff });
  await ctx.db.patch("organization", org._id, { configV: v });
  return { ...org, configV: v };
}

/** Rare subscription: the Organization config the website edits and the Scan control reads. */
export const current = query({
  args: {},
  returns: v.object({
    v: v.number(),
    values: orgConfigValidator,
    firstRunAt: v.union(v.number(), v.null()),
    planChange: v.union(
      v.null(),
      v.object({ at: v.number(), previousSegments: v.array(segmentValidator) }),
    ),
  }),
  handler: async (ctx) => {
    await requireOperator(ctx);
    const { org, version } = await currentConfig(ctx);
    return {
      v: version.v,
      values: version.values,
      firstRunAt: org.firstRunAt,
      planChange: org.planChange,
    };
  },
});

export async function saveValues(
  ctx: MutationCtx,
  author: string,
  expectedV: number,
  values: Doc<"orgConfigVersions">["values"],
  extraDiff: string[] = [],
) {
  const { org, version } = await currentConfig(ctx);
  if (expectedV !== org.configV) fail("CONFIG_CONFLICT");
  const problem = validateOrgConfig(values);
  if (problem) fail(problem.code, problem.message);
  const diff = [...extraDiff, ...orgConfigDiff(version.values, values)];
  if (diff.length === extraDiff.length) return { v: org.configV, runNumber: null };
  let saved = await writeOrgConfig(ctx, org, values, author, diff);
  const before = version.values;
  if (!sameSegments(before.segments, values.segments)) {
    const planChange = { at: Date.now(), previousSegments: before.segments };
    await ctx.db.patch("organization", org._id, { planChange });
    saved = { ...saved, planChange };
  }
  // n applies from the next Scan's close on its own; the sweep plan and cadence need a new Run.
  if (saved.run && startsNewRun(before, values)) {
    const run = await openRun(ctx, author, `Config v${saved.configV} by ${author}`);
    return { v: saved.configV, runNumber: run.number };
  }
  return { v: saved.configV, runNumber: null };
}

const saved = v.object({ v: v.number(), runNumber: v.union(v.number(), v.null()) });

/** Every save names the version it was based on; a teammate's newer save wins and this is refused. */
export const save = mutation({
  args: { expectedV: v.number(), values: orgConfigValidator },
  returns: saved,
  handler: async (ctx, { expectedV, values }) => {
    const operator = await requireOperator(ctx);
    return await saveValues(ctx, operator.name, expectedV, values);
  },
});

/** History only grows: restoring writes a new version equal to the old one. */
export const restore = mutation({
  args: { v: v.number(), expectedV: v.number() },
  returns: saved,
  handler: async (ctx, args) => {
    const operator = await requireOperator(ctx);
    const old = await configVersion(ctx, args.v);
    return await saveValues(ctx, operator.name, args.expectedV, old.values, [
      `Restored v${args.v}`,
    ]);
  },
});

/** Newest first; the website subscribes to the first 20 and reads older pages one-shot. */
export const versions = query({
  args: { paginationOpts: paginationOptsValidator },
  handler: async (ctx, { paginationOpts }) => {
    await requireOperator(ctx);
    const page = await ctx.db
      .query("orgConfigVersions")
      .withIndex("by_v")
      .order("desc")
      .paginate(paginationOpts);
    return {
      ...page,
      page: await Promise.all(
        page.page.map(async (version) => ({
          ...version,
          startedRuns: (
            await ctx.db
              .query("runs")
              .withIndex("by_configV", (q) => q.eq("configV", version.v))
              .take(5)
          ).map((r) => r.number),
        })),
      ),
    };
  },
});
