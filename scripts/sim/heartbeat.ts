import type { Heartbeat } from "@/convex/lib/heartbeat";

/** A healthy phone: charging, HackRF streaming, empty outbox, tight clock, good GPS. */
export function healthyHeartbeat(overrides: Partial<Heartbeat> = {}): Heartbeat {
  return {
    appVersion: "1.0.0",
    appVersionCode: 100,
    battery: 0.95,
    charging: true,
    thermal: "none",
    selfPause: null,
    hackrf: {
      state: "streaming",
      serial: null,
      boardId: 2,
      firmware: "2023.01.1",
      ladder: 0,
      faults: {},
      detachedSince: null,
    },
    clippedHz: [],
    window: { mode: "full", reason: null },
    setupGaps: [],
    outbox: { depth: 0, oldestAgeS: 0, dropped: 0 },
    clock: { offsetMs: 3, uncertaintyMs: 4 },
    gpsAccuracyM: 6,
    appliedConfigV: null,
    rejectedConfig: null,
    lastError: null,
    ...overrides,
  };
}
