import { NativeModule, requireNativeModule } from 'expo'
import type { ScanSettings, AlgoSettings, PowerMeasurement, PingResult } from './Native.types'

export type HackrfAttachedEvent = {
    deviceName: string
    vendorId: number
    productId: number
}

export type HackrfDetachedEvent = {
    deviceName: string
}

type HackrfModuleEvents = {
    onHackrfAttached: (event: HackrfAttachedEvent) => void
    onHackrfDetached: (event: HackrfDetachedEvent) => void
}

declare class HackrfNativeModule extends NativeModule<HackrfModuleEvents> {
    ping(): Promise<PingResult>
    isConnected(): Promise<boolean>
    getDeviceName(): Promise<string | null>
    initDevice(): Promise<boolean>
    runFullScan(settings: ScanSettings, algoSettings: AlgoSettings): Promise<PowerMeasurement[]>
    closeDevice(): Promise<boolean>
    resetDevice(): Promise<number>
}

export default requireNativeModule<HackrfNativeModule>('Hackrf')
