export type ScanSettings = {
    minFrequencyHz: number
    maxFrequencyHz: number
    sampleRateHz?: number
    lnaGainDb?: number
    vgaGainDb?: number
    bufferSizeKb?: number
    chunksPerStep?: number
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
