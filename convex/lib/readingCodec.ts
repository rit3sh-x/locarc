// Packed Reading payload, version 1, encoded in little-endian format.
// The Kotlin encoder must match `wire/reading.golden.json` byte for byte.
//
// Header:
//   u8  version (1)
//   u16 sliceCount
//
// Per 5 MHz slice of the Sweep plan, in plan order:
//   i16 noise floor (0.1 dBm; averaged over the Fix window)
//   u8  flags:
//         bit 0: clipped during the Fix window
//         bit 1: clipped after the Fix window
//         bit 2: noise anomaly detected
//
//   u16 emitterCount
//
// Per Emitter, sorted by ascending first Channel:
//   u32 first Channel (absolute, measured from 0 Hz)
//   u16 width in Channels
//   u16 strongest Channel (offset from the first Channel)
//   i16 Fix-window power (0.1 dBm; -32768 = active only after the Fix window)
//   i16 peak power (0.1 dBm)
//   u16 number of passes in which the Emitter was active
//   u8  flags:
//         bit 0: clipped during the Fix window
//         bit 1: clipped after the Fix window

export const CODEC_VERSION = 1;
/** A phone keeps its strongest Emitters, so a Reading always fits one sync. */
export const MAX_EMITTERS = 4000;
const NONE = -0x8000;

export type Slice = {
  floorDbm: number;
  clippedFix: boolean;
  clippedLater: boolean;
  anomaly: boolean;
};

export type EmitterRecord = {
  firstCh: number;
  widthCh: number;
  /** Absolute channel number of its strongest Channel. */
  strongestCh: number;
  /** Total power over its span, averaged over the Fix window; null when on only later. */
  fixPowerDbm: number | null;
  /** The strongest single Channel in any single pass. */
  peakDbm: number;
  /** Occupancy = passesOn ÷ the Reading's passes. */
  passesOn: number;
  clippedFix: boolean;
  clippedLater: boolean;
};

export type ReadingPayload = { slices: Slice[]; emitters: EmitterRecord[] };

const tenths = (x: number) => Math.min(0x7fff, Math.max(-0x7fff, Math.round(x * 10)));
const u16 = (x: number) => Math.min(0xffff, Math.max(0, Math.round(x)));

export function encodeReading(p: ReadingPayload): Uint8Array<ArrayBuffer> {
  if (p.emitters.length > MAX_EMITTERS) throw new Error(`more than ${MAX_EMITTERS} Emitters`);
  if (p.slices.length > 0xffff) throw new Error("too many slices");
  const view = new DataView(new ArrayBuffer(5 + 3 * p.slices.length + 15 * p.emitters.length));
  let o = 0;
  view.setUint8(o, CODEC_VERSION);
  view.setUint16(o + 1, p.slices.length, true);
  o += 3;
  for (const s of p.slices) {
    view.setInt16(o, tenths(s.floorDbm), true);
    view.setUint8(o + 2, (s.clippedFix ? 1 : 0) | (s.clippedLater ? 2 : 0) | (s.anomaly ? 4 : 0));
    o += 3;
  }
  view.setUint16(o, p.emitters.length, true);
  o += 2;
  for (const e of [...p.emitters].sort((a, b) => a.firstCh - b.firstCh)) {
    view.setUint32(o, e.firstCh, true);
    view.setUint16(o + 4, u16(e.widthCh), true);
    view.setUint16(o + 6, u16(e.strongestCh - e.firstCh), true);
    view.setInt16(o + 8, e.fixPowerDbm === null ? NONE : tenths(e.fixPowerDbm), true);
    view.setInt16(o + 10, tenths(e.peakDbm), true);
    view.setUint16(o + 12, u16(e.passesOn), true);
    view.setUint8(o + 14, (e.clippedFix ? 1 : 0) | (e.clippedLater ? 2 : 0));
    o += 15;
  }
  return new Uint8Array(view.buffer);
}

export function decodeReading(payload: ArrayBuffer | Uint8Array): ReadingPayload {
  const bytes = payload instanceof Uint8Array ? payload : new Uint8Array(payload);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const version = view.getUint8(0);
  if (version !== CODEC_VERSION) throw new Error(`unsupported Reading codec version ${version}`);
  const slices: Slice[] = [];
  let o = 3;
  for (let i = view.getUint16(1, true); i > 0; i--) {
    const flags = view.getUint8(o + 2);
    slices.push({
      floorDbm: view.getInt16(o, true) / 10,
      clippedFix: (flags & 1) !== 0,
      clippedLater: (flags & 2) !== 0,
      anomaly: (flags & 4) !== 0,
    });
    o += 3;
  }
  const emitters: EmitterRecord[] = [];
  const count = view.getUint16(o, true);
  o += 2;
  for (let i = 0; i < count; i++) {
    const firstCh = view.getUint32(o, true);
    const fix = view.getInt16(o + 8, true);
    const flags = view.getUint8(o + 14);
    emitters.push({
      firstCh,
      widthCh: view.getUint16(o + 4, true),
      strongestCh: firstCh + view.getUint16(o + 6, true),
      fixPowerDbm: fix === NONE ? null : fix / 10,
      peakDbm: view.getInt16(o + 10, true) / 10,
      passesOn: view.getUint16(o + 12, true),
      clippedFix: (flags & 1) !== 0,
      clippedLater: (flags & 2) !== 0,
    });
    o += 15;
  }
  if (o !== bytes.byteLength) throw new Error("Reading payload has trailing bytes");
  return { slices, emitters };
}

export const toHex = (bytes: Uint8Array) =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");

export const fromHex = (hex: string) =>
  Uint8Array.from(hex.match(/../g) ?? [], (h) => Number.parseInt(h, 16));
