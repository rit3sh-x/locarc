// A Channel is identified by its centre frequency; its number counts rasters from 0 Hz, so it
// survives band changes (433.925 MHz at 12.5 kHz = ch 34714).

export const channelOf = (freqHz: number, rasterHz: number) => Math.round(freqHz / rasterHz);
export const centreOf = (ch: number, rasterHz: number) => ch * rasterHz;
/** Re-matches a frequency to the raster, e.g. after a raster change. */
export const snapToRaster = (freqHz: number, rasterHz: number) =>
  centreOf(channelOf(freqHz, rasterHz), rasterHz);

export const formatMHz = (hz: number) => `${(hz / 1e6).toFixed(4)} MHz`;
export const formatChannel = (freqHz: number, rasterHz: number) =>
  `ch ${channelOf(freqHz, rasterHz)}`;
