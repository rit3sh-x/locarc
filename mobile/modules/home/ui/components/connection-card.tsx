import { View } from 'react-native'
import { Text } from '@/components/ui/text'
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
        {!hackrfConnected && (
            <View className="pt-2">
                <Text className="text-muted-foreground text-xs">
                    HackRF not detected. Plug in the device or tap reset.
                </Text>
            </View>
        )}
    </InfoCard>
)
