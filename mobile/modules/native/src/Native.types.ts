export type ScanSettings = {
    minFrequencyHz: number
    maxFrequencyHz: number
    sampleRateHz: number
    lnaGainDb: number
    vgaGainDb: number
    bufferSizeKb: number
}

export type AlgoPhase1 = {
    sigBwHz: number
    perOlf: number
    numSamUseRatio: number
    maxTh: number
    kaiserBeta: number
    highpassOrder: number
    highpassCutoff: number
    noiseMinPeaks: number
    noiseMaxDiff: number
}

export type AlgoPhase2 = {
    requiredFs1Hz: number
    chSpacingHz: number
    perOlfP1: number
    numSamUseRatioP1: number
    maxThP1: number
    kaiserBetaP1: number
    lpfOrder: number
    lpfCutoff: number
    noiseMinPeaksP2: number
    noiseMaxDiffP2: number
    dcGuardHz: number
}

export type AlgoChannelMapping = {
    bandStartFreqHz: number
    bandEndFreqHz: number
    channelSpacingMapHz: number
    powerCalOffsetDb: number
    sidelobeDedupHz: number
}

export type AlgoSettings = {
    phase1: AlgoPhase1
    phase2: AlgoPhase2
    channelMapping: AlgoChannelMapping
}

export type PowerMeasurement = {
    frequency: number
    powerDbm: number
}

export type PingResult = {
    status: string
    module: string
    version: number
}
