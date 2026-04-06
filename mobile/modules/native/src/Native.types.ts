import { Doc } from '@backend/dataModel'

type Settings = Doc<'settings'>

export type ScanSettings = {
    minFrequencyHz: number
    maxFrequencyHz: number
    sampleRateHz?: number
    lnaGainDb?: number
    vgaGainDb?: number
    bufferSizeKb?: number
    chunksPerStep?: number
}

export type AlgoPhase1 = Settings['phase1']

export type AlgoPhase2 = Settings['phase2']

export type AlgoPhase3 = Settings['phase3']

export type AlgoChannelMapping = Settings['channelMapping']

export type AlgoSettings = {
    phase1: AlgoPhase1
    phase2: AlgoPhase2
    phase3: AlgoPhase3
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
