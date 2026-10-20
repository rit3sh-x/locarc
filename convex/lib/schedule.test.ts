import { expect, test } from "bun:test";
import { channelOf, formatMHz, snapToRaster } from "./channelMath";
import {
  passesInFixWindow,
  passMs,
  SWEEP_PRESETS,
  sliceOf,
  slices,
  tuneCount,
  validateSegments,
} from "./config";
import {
  burstLengthMs,
  closeDeadline,
  describeCadence,
  listeningWindowMs,
  nextRunStart,
  periodMs,
  revertCadence,
  scanIndexAt,
} from "./schedule";

const at = (hms: string) => Date.parse(`2026-10-18T${hms}Z`);

test("channel numbers count rasters from 0 Hz", () => {
  expect(channelOf(433.925e6, 12_500)).toBe(34_714);
  expect(channelOf(433.925e6, 25_000)).toBe(17_357);
  expect(snapToRaster(433.9301e6, 12_500)).toBe(433.925e6);
  expect(formatMHz(433.925e6)).toBe("433.9250 MHz");
});

test("a pass: 2.7 ms per 20 MHz tune, as measured", () => {
  const bug = { segments: [...SWEEP_PRESETS.bugBands.segments] };
  const full = { segments: [...SWEEP_PRESETS.fullSpan.segments] };
  expect(tuneCount(bug)).toBe(56);
  expect(passMs(bug)).toBeCloseTo(151, 0);
  expect(passMs(full)).toBeCloseTo(810, 0);
  expect(passesInFixWindow(bug)).toBe(66);
  expect(passesInFixWindow(full)).toBe(12);
});

test("5 MHz slices per segment, the last one shorter", () => {
  const plan = {
    segments: [
      { startHz: 30e6, endHz: 42e6 },
      { startHz: 88e6, endHz: 98e6 },
    ],
  };
  expect(slices(plan)).toEqual([
    { startHz: 30e6, endHz: 35e6 },
    { startHz: 35e6, endHz: 40e6 },
    { startHz: 40e6, endHz: 42e6 },
    { startHz: 88e6, endHz: 93e6 },
    { startHz: 93e6, endHz: 98e6 },
  ]);
  expect(sliceOf(plan, 41e6)).toBe(2);
  expect(sliceOf(plan, 95e6)).toBe(4);
  expect(sliceOf(plan, 60e6)).toBe(-1);
  expect(slices({ segments: [...SWEEP_PRESETS.bugBands.segments] })).toHaveLength(218);
});

test("segments: 1–16 within 1–6000 MHz, in order, not overlapping", () => {
  const ok = (segments: { startHz: number; endHz: number }[]) =>
    validateSegments(segments) === null;
  expect(ok([...SWEEP_PRESETS.bugBands.segments])).toBe(true);
  expect(ok([...SWEEP_PRESETS.fullSpan.segments])).toBe(true);
  expect(ok([])).toBe(false);
  expect(ok([{ startHz: 0.5e6, endHz: 10e6 }])).toBe(false);
  expect(ok([{ startHz: 440e6, endHz: 400e6 }])).toBe(false);
  expect(
    ok([
      { startHz: 400e6, endHz: 440e6 },
      { startHz: 430e6, endHz: 450e6 },
    ]),
  ).toBe(false);
  expect(
    ok([
      { startHz: 400e6, endHz: 440e6 },
      { startHz: 440e6, endHz: 450e6 },
    ]),
  ).toBe(true);
  expect(
    ok(
      Array.from({ length: 17 }, (_, i) => ({
        startHz: (i + 1) * 100e6,
        endHz: (i + 1) * 100e6 + 1e6,
      })),
    ),
  ).toBe(false);
});

test("Runs start at the next whole minute with at least 10 s lead", () => {
  expect(nextRunStart(at("12:00:30"))).toBe(at("12:01:00"));
  expect(nextRunStart(at("12:00:55"))).toBe(at("12:02:00"));
  expect(nextRunStart(at("12:00:00"))).toBe(at("12:01:00"));
});

test("cadence periods, bursts and reverts", () => {
  expect(periodMs({ kind: "steady", minutes: 5 })).toBe(300_000);
  expect(periodMs({ kind: "oneMinute", hours: 1, revertMinutes: 5 })).toBe(60_000);
  expect(periodMs({ kind: "continuous", minutes: 15, revertMinutes: 5 })).toBe(15_000);
  expect(listeningWindowMs(300_000)).toBe(297_000);
  expect(listeningWindowMs(15_000)).toBe(12_000);
  expect(burstLengthMs({ kind: "oneMinute", hours: 2, revertMinutes: 15 })).toBe(7_200_000);
  expect(burstLengthMs({ kind: "steady", minutes: 15 })).toBeNull();
  expect(revertCadence({ kind: "continuous", minutes: 30, revertMinutes: 15 })).toEqual({
    kind: "steady",
    minutes: 15,
  });
  expect(describeCadence({ kind: "oneMinute", hours: 1, revertMinutes: 5 })).toBe(
    "1-min burst for 1 h, then every 5 min",
  );
});

test("boundaries and close deadlines", () => {
  const start = at("12:01:00");
  expect(scanIndexAt(start, 60_000, at("12:03:59"))).toBe(2);
  expect(scanIndexAt(start, 60_000, at("12:00:59"))).toBe(-1);
  // Receivers upload just before the next boundary; the close waits 30 s past it.
  expect(closeDeadline(start, 60_000)).toBe(start + 90_000);
});
