// convex-test under Bun: Bun.Glob module maps instead of Vite's import.meta.glob.
// (Two dots in the name keep the Convex bundler from pushing this file.)
import { join } from "node:path";
import type { UserIdentity } from "convex/server";
import { convexTest } from "convex-test";
import betterAuthSchema from "../../node_modules/@convex-dev/better-auth/dist/component/schema.js";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { type EmitterRecord, encodeReading, type Slice } from "../lib/readingCodec";
import schema from "../schema";

const SITE = process.env.CONVEX_SITE_URL ?? "";

function moduleMap(dir: string, pattern: string) {
  return Object.fromEntries(
    Array.from(new Bun.Glob(pattern).scanSync({ cwd: dir }), (f) => [
      `./${f}`,
      () => import(join(dir, f)),
    ]),
  );
}

// convex-test wants every module keyed from the functions root, one level up.
const CONVEX = join(import.meta.dir, "..");
const appModules = moduleMap(CONVEX, "**/*.{ts,js}");
const betterAuthModules = moduleMap(
  join(CONVEX, "../node_modules/@convex-dev/better-auth/dist/component"),
  "**/*.js",
);

export function makeTest() {
  const t = convexTest(schema, appModules);
  t.registerComponent("betterAuth", betterAuthSchema, betterAuthModules);
  return t;
}

export type T = ReturnType<typeof makeTest>;

export const OPERATOR_ISSUER = SITE;
export const RECEIVER_ISSUER = `${SITE}/receiver`;

/** Runs the real setup path and returns a client signed in as the first Operator. */
export async function setUp(t: T, email = "first@example.com") {
  await t.action(internal.setup.init, {
    orgName: "Test Org",
    name: "First Operator",
    email,
    password: "password-123",
  });
  return asOperator(t, email);
}

export async function asOperator(t: T, email: string) {
  const op = await t.run((ctx) =>
    ctx.db
      .query("operators")
      .withIndex("by_email", (q) => q.eq("email", email))
      .unique(),
  );
  if (!op) throw new Error(`no Operator ${email}`);
  return t.withIdentity({ issuer: OPERATOR_ISSUER, subject: op.userId } as Partial<UserIdentity>);
}

export async function expectCode(p: Promise<unknown>, code: string) {
  try {
    await p;
  } catch (e) {
    const data = (e as { data?: { code?: string } }).data;
    if (data?.code === code) return;
    throw new Error(`expected ${code}, got ${data?.code ?? String(e)}`);
  }
  throw new Error(`expected ${code}, but it succeeded`);
}

/** Moves fake time and lets every scheduled function that came due run to completion. */
export async function advance(t: T, ms: number) {
  const { jest } = await import("bun:test");
  jest.advanceTimersByTime(ms);
  for (let i = 0; i < 3; i++) {
    await t.finishInProgressScheduledFunctions();
    jest.advanceTimersByTime(0);
  }
}

export const asReceiver = (t: T, id: string) =>
  t.withIdentity({ issuer: RECEIVER_ISSUER, subject: id });

type PositionFix = { lat: number; lng: number; accuracyM: number; at: number };

/** A Reading v1 as a phone syncs it: a full 5-minute window unless overridden. */
export function testReading(
  runId: string,
  k: number,
  o: {
    emitters?: EmitterRecord[];
    slices?: Slice[];
    at?: PositionFix | null;
    stopReason?: string | null;
    clockUncertaintyMs?: number;
    fixPasses?: number;
  } = {},
) {
  return {
    runId: runId as Id<"runs">,
    k,
    appVersion: "1.0.0",
    lnaDb: 32,
    vgaDb: 30,
    amp: false,
    ppm: 0,
    windowMs: o.stopReason ? 30_000 : 297_000,
    passes: o.stopReason ? 200 : 1980,
    fixPasses: o.fixPasses ?? 66,
    stopReason: o.stopReason ?? null,
    start: o.at ?? null,
    end: o.at ?? null,
    clockUncertaintyMs: o.clockUncertaintyMs ?? 4,
    payload: encodeReading({ slices: o.slices ?? [], emitters: o.emitters ?? [] }).buffer,
  };
}

/** One Emitter record covering `freqHz`, heard at `powerDbm` through the Fix window. */
export function testRecord(
  freqHz: number,
  powerDbm: number | null,
  o: Partial<EmitterRecord> = {},
) {
  const ch = Math.round(freqHz / 12_500);
  return {
    firstCh: ch,
    widthCh: 1,
    strongestCh: ch,
    fixPowerDbm: powerDbm,
    peakDbm: (powerDbm ?? -70) + 3,
    passesOn: 1980,
    clippedFix: false,
    clippedLater: false,
    ...o,
  } satisfies EmitterRecord;
}
