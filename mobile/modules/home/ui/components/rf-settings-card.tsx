import { InfoCard } from './info-card'
import { InfoRow } from './info-row'

export const RfSettingsCard = ({
    settings,
}: {
    settings: {
        minFreq: number
        maxFreq: number
        sampleRate: number
        vgaGain: number
        lnaGain: number
        bufferSize: number
    }
}) => (
    <InfoCard title="RF Settings">
        <InfoRow label="Min Freq" value={`${(settings.minFreq / 1e6).toFixed(1)} MHz`} />
        <InfoRow label="Max Freq" value={`${(settings.maxFreq / 1e6).toFixed(1)} MHz`} />
        <InfoRow label="Sample Rate" value={`${(settings.sampleRate / 1e6).toFixed(1)} MS/s`} />
        <InfoRow label="VGA Gain" value={`${settings.vgaGain} dB`} />
        <InfoRow label="LNA Gain" value={`${settings.lnaGain} dB`} />
        <InfoRow label="Buffer Size" value={`${settings.bufferSize} KB`} />
    </InfoCard>
)
