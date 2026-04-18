import { InfoCard } from './info-card'
import { InfoRow } from './info-row'
import type { ScanSettings } from '~/native'

export const RfSettingsCard = ({ settings }: { settings: ScanSettings }) => (
    <InfoCard title="RF Settings">
        <InfoRow label="Min Freq" value={`${(settings.minFrequencyHz / 1e6).toFixed(1)} MHz`} />
        <InfoRow label="Max Freq" value={`${(settings.maxFrequencyHz / 1e6).toFixed(1)} MHz`} />
        <InfoRow label="Sample Rate" value={`${(settings.sampleRateHz / 1e6).toFixed(1)} MS/s`} />
        <InfoRow label="VGA Gain" value={`${settings.vgaGainDb} dB`} />
        <InfoRow label="LNA Gain" value={`${settings.lnaGainDb} dB`} />
        <InfoRow label="Buffer Size" value={`${settings.bufferSizeKb} KB`} />
    </InfoCard>
)
