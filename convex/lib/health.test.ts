import { describe, expect, test } from "bun:test";
import { healthyHeartbeat } from "@/scripts/sim/heartbeat";
import { displayedState, emptyBook, evaluate, type HealthInput } from "./health";
import type { Heartbeat } from "./heartbeat";

const NOW = 1_000_000_000;
const base = (o: Partial<HealthInput> = {}, hb: Partial<Heartbeat> = {}): HealthInput => ({
  status: "active",
  now: NOW,
  lastSeenAt: NOW - 1000,
  runActive: true,
  pausedByOperator: false,
  pinned: false,
  snapshot: healthyHeartbeat(hb),
  book: emptyBook(),
  configPendingSince: null,
  configRejected: null,
  ...o,
});
const usb = (o: Partial<Heartbeat["hackrf"]>): Partial<Heartbeat> => ({
  hackrf: {
    state: "streaming",
    serial: null,
    boardId: 2,
    firmware: "2023.01.1",
    ladder: 0,
    faults: {},
    detachedSince: null,
    ...o,
  },
});
const top = (h: HealthInput): (string | undefined)[] => {
  const r = evaluate(h);
  return [r.state, r.reasons[0]?.text];
};

describe("precedence", () => {
  test.each<[string, HealthInput, (string | undefined)[]]>([
    ["pending", base({ status: "pending" }), ["awaiting_pairing", undefined]],
    [
      "silent 12 min",
      base({ lastSeenAt: NOW - 12 * 60_000 }),
      ["offline", "no contact for 12 min"],
    ],
    ["never seen", base({ lastSeenAt: null }), ["offline", "no contact for never"]],
    ["healthy, scanning", base(), ["scanning", undefined]],
    ["healthy, stopped", base({ runActive: false }), ["idle", undefined]],
    [
      "replug beats everything below Offline",
      base({ pausedByOperator: true }, usb({ state: "needs_attention" })),
      ["needs_attention", "replug the HackRF"],
    ],
    [
      "paused beats degraded",
      base({ pausedByOperator: true }, { clock: { offsetMs: 0, uncertaintyMs: 900 } }),
      ["paused", "paused by an Operator"],
    ],
    [
      "self-pause",
      base({}, { selfPause: "battery", battery: 0.18 }),
      ["paused", "self-paused: battery low"],
    ],
  ])("%s", (_, input, expected) => expect(top(input)).toEqual(expected));
});

describe("every threshold's reason", () => {
  test.each<[string, HealthInput, string]>([
    ["permission", base({}, usb({ state: "needs_permission" })), "USB permission denied"],
    [
      "detached 6 min in a Run",
      base({}, usb({ state: "detached", detachedSince: NOW - 6 * 60_000 })),
      "HackRF detached 6 min",
    ],
    ["missed 2 Scans", base({ book: { ...emptyBook(), missed: 2 } }), "not reporting"],
    ["clock", base({}, { clock: { offsetMs: 5, uncertaintyMs: 501 } }), "clock ±501 ms"],
    [
      "firmware without sweep mode",
      base({}, usb({ state: "needs_attention", faults: { FIRMWARE_UNSUPPORTED: 1 } })),
      "update the HackRF firmware",
    ],
    [
      "partials",
      base({
        book: {
          ...emptyBook(),
          recentPartial: [true, false, true, false, false],
        },
      }),
      "2 of last 5 windows cut short",
    ],
    ["ladder", base({ book: { ...emptyBook(), ladderAt: NOW - 60_000 } }), "USB recovery L3+"],
    [
      "flapping",
      base({ book: { ...emptyBook(), flappingAt: NOW - 60_000 } }),
      "USB power unstable: use a powered OTG Y-cable",
    ],
    [
      "clipping",
      base({
        book: {
          ...emptyBook(),
          recentClipped: [false, false, true],
          clippedHz: 418.15e6,
        },
      }),
      "gain too high at 418.1500 MHz",
    ],
    [
      "backlog",
      base({}, { outbox: { depth: 9, oldestAgeS: 700, dropped: 0 } }),
      "upload backlog 12 min",
    ],
    [
      "dropped",
      base({}, { outbox: { depth: 0, oldestAgeS: 0, dropped: 3 } }),
      "3 Readings dropped",
    ],
    ["gps", base({}, { gpsAccuracyM: 80 }), "GPS ±80 m"],
    ["battery", base({}, { battery: 0.25, charging: false }), "battery 25%"],
    ["thermal", base({}, { thermal: "moderate" }), "phone hot (moderate)"],
    ["config pending", base({ configPendingSince: NOW - 11 * 60_000 }), "config pending 11 min"],
    [
      "config rejected",
      base({ configRejected: { v: 3, reason: "VGA out of range" } }),
      "config v3 rejected",
    ],
    ["moved", base({ pinned: true, book: { ...emptyBook(), moved: true } }), "Moved?"],
  ])("%s", (_, input, text) => {
    const r = evaluate(input);
    expect(r.reasons.map((x) => x.text)).toContain(text);
  });

  test("just inside the thresholds stays healthy", () => {
    const r = evaluate(
      base(
        {
          book: {
            ...emptyBook(),
            missed: 1,
            recentPartial: [true, false, false, false, false],
            recentClipped: [true, false, false, false],
          },
          configPendingSince: NOW - 9 * 60_000,
        },
        {
          clock: { offsetMs: 0, uncertaintyMs: 500 },
          gpsAccuracyM: 50,
          battery: 0.3,
          charging: false,
          thermal: "light",
        },
      ),
    );
    expect(r).toEqual({ state: "scanning", reasons: [] });
  });

  test("missed Scans only count while a Run is active; GPS accuracy is ignored when pinned", () => {
    expect(evaluate(base({ runActive: false, book: { ...emptyBook(), missed: 5 } })).state).toBe(
      "idle",
    );
    expect(evaluate(base({ pinned: true }, { gpsAccuracyM: 300 })).state).toBe("scanning");
  });
});

test("the browser re-ages Offline from lastSeenAt", () => {
  const r = {
    status: "active" as const,
    serverState: "scanning" as const,
    lastSeenAt: NOW,
  };
  expect(displayedState(r, NOW + 11 * 60_000)).toBe("scanning");
  expect(displayedState(r, NOW + 12 * 60_000)).toBe("offline");
  expect(displayedState({ ...r, status: "pending" }, NOW)).toBe("awaiting_pairing");
});
