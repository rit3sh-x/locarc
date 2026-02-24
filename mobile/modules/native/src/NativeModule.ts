import { NativeModule, requireNativeModule } from "expo";
import type {
    ScanSettings,
    PowerMeasurement,
    PingResult,
} from "./Native.types";

declare class HackrfNativeModule extends NativeModule {
    ping(): Promise<PingResult>;
    isConnected(): Promise<boolean>;
    getDeviceName(): Promise<string | null>;
    initDevice(): Promise<boolean>;
    runFullScan(settings: ScanSettings): Promise<PowerMeasurement[]>;
    closeDevice(): Promise<boolean>;
}

export default requireNativeModule<HackrfNativeModule>("Hackrf");
