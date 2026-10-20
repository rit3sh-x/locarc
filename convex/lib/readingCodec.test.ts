import { expect, test } from "bun:test";
import { decodeBoard, encodeBoard } from "./boardCodec";
import {
  decodeReading,
  encodeReading,
  fromHex,
  MAX_EMITTERS,
  type ReadingPayload,
  toHex,
} from "./readingCodec";
import board from "./wire/board.golden.json";
import reading from "./wire/reading.golden.json";

test("Reading golden vector: the committed bytes encode and decode exactly", () => {
  const payload = reading.payload as ReadingPayload;
  expect(toHex(encodeReading(payload))).toBe(reading.hex);
  expect(decodeReading(fromHex(reading.hex))).toEqual(payload);
});

test("Reading v1: 3 bytes per slice and 15 per Emitter after a 5-byte frame", () => {
  const payload = reading.payload as ReadingPayload;
  expect(encodeReading(payload).byteLength).toBe(5 + 3 * 3 + 15 * 3);
});

test("Emitters are written by ascending first Channel; values clamp at 0.1 dB", () => {
  const e = (firstCh: number) => ({
    firstCh,
    widthCh: 2,
    strongestCh: firstCh + 1,
    fixPowerDbm: -55.55,
    peakDbm: -4000,
    passesOn: 70_000,
    clippedFix: false,
    clippedLater: false,
  });
  const out = decodeReading(encodeReading({ slices: [], emitters: [e(900), e(100)] }));
  expect(out.emitters.map((x) => x.firstCh)).toEqual([100, 900]);
  expect(out.emitters[0]).toMatchObject({
    fixPowerDbm: -55.5,
    peakDbm: -3276.7,
    passesOn: 0xffff,
  });
});

test("rejects unknown versions, trailing bytes and too many Emitters", () => {
  expect(() => decodeReading(Uint8Array.of(2, 0, 0, 0, 0))).toThrow(/version 2/);
  expect(() =>
    decodeReading(Uint8Array.of(...encodeReading({ slices: [], emitters: [] }), 0)),
  ).toThrow(/trailing/);
  const many = Array.from({ length: MAX_EMITTERS + 1 }, (_, i) => ({
    firstCh: i,
    widthCh: 1,
    strongestCh: i,
    fixPowerDbm: -90,
    peakDbm: -88,
    passesOn: 1,
    clippedFix: false,
    clippedLater: false,
  }));
  expect(() => encodeReading({ slices: [], emitters: many })).toThrow(/4000/);
});

test("board golden vector: 50 bytes an item, exact round trip", () => {
  const items = board.items as ReturnType<typeof decodeBoard>;
  expect(toHex(encodeBoard(items))).toBe(board.hex);
  expect(decodeBoard(fromHex(board.hex))).toEqual(items);
  expect(encodeBoard(items).byteLength).toBe(3 + 50 * items.length);
});
