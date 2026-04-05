import { InfoCard } from './info-card'
import { InfoRow } from './info-row'

type HackrfStatus = 'idle' | 'waiting' | 'scanning' | 'submitting' | 'done' | 'error'

export const ConnectionCard = ({
    status,
    isConnected,
    started,
}: {
    status: HackrfStatus
    isConnected: boolean
    started: boolean
}) => (
    <InfoCard title="Connection">
        <InfoRow label="Server" value={isConnected ? 'Connected' : 'Disconnected'} />
        <InfoRow
            label="HackRF"
            value={status === 'scanning' ? 'Active' : isConnected ? 'Ready' : 'N/A'}
        />
        <InfoRow label="Scanning" value={started ? 'Enabled' : 'Disabled'} />
    </InfoCard>
)
