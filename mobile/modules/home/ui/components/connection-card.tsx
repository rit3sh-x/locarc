import { InfoCard } from './info-card'
import { InfoRow } from './info-row'

type HackrfStatus = 'idle' | 'waiting' | 'scanning' | 'submitting' | 'done' | 'error'

export const ConnectionCard = ({
    status,
    isConnected,
    hackrfConnected,
    started,
}: {
    status: HackrfStatus
    isConnected: boolean
    hackrfConnected: boolean
    started: boolean
}) => (
    <InfoCard title="Connection">
        <InfoRow label="Server" value={isConnected ? 'Connected' : 'Disconnected'} />
        <InfoRow
            label="HackRF"
            value={
                status === 'scanning'
                    ? 'Active'
                    : hackrfConnected
                      ? 'Ready'
                      : 'Not detected'
            }
        />
        <InfoRow label="Scanning" value={started ? 'Enabled' : 'Disabled'} />
    </InfoCard>
)
