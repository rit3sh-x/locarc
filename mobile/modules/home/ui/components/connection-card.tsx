import { InfoCard } from './info-card'
import { InfoRow } from './info-row'
import type { HackrfStatus } from '../../types'

const hackrfLabel = (status: HackrfStatus, connected: boolean): string => {
    if (status === 'scanning') return 'Active'
    return connected ? 'Ready' : 'Not detected'
}

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
        <InfoRow label="HackRF" value={hackrfLabel(status, hackrfConnected)} />
        <InfoRow label="Scanning" value={started ? 'Enabled' : 'Disabled'} />
    </InfoCard>
)
