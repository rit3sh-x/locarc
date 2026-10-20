// Seeds for the journeys. Each refuses unless the deployment's IS_TEST flag is set.
import { v } from "convex/values";
import { env, internalMutation } from "../_generated/server";
import { fail } from "../lib/errors";

function requireTestMode() {
  if (env.IS_TEST !== "1") fail("NOT_TEST_MODE");
}

export const expirePairingCodes = internalMutation({
  args: {},
  returns: v.number(),
  handler: async (ctx) => {
    requireTestMode();
    let n = 0;
    for (const code of await ctx.db.query("pairingCodes").take(500)) {
      if (code.usedAt === null) {
        await ctx.db.patch("pairingCodes", code._id, { expiresAt: Date.now() - 1 });
        n++;
      }
    }
    return n;
  },
});

/** Ends the 24 h learning window now, so New alerts can fire in a journey. */
export const backdateLearning = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    requireTestMode();
    const org = await ctx.db.query("organization").first();
    if (org)
      await ctx.db.patch("organization", org._id, {
        firstRunAt: Date.now() - 25 * 3_600_000,
        planChange: null,
      });
    return null;
  },
});
