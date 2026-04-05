import { ActivityIndicator, View } from 'react-native'
import { Text } from '@/components/ui/text'
import { Badge } from '@/components/ui/badge'

type HackrfStatus = 'idle' | 'waiting' | 'scanning' | 'submitting' | 'done' | 'error'

const STATUS_CONFIG: Record<
    HackrfStatus,
    {
        label: string
        color: string
        bg: string
        badge: 'default' | 'secondary' | 'destructive' | 'outline'
    }
> = {
    idle: {
        label: 'Idle',
        color: 'text-muted-foreground',
        bg: 'bg-muted',
        badge: 'secondary',
    },
    waiting: {
        label: 'Waiting for Job',
        color: 'text-yellow-600',
        bg: 'bg-yellow-500/10',
        badge: 'outline',
    },
    scanning: {
        label: 'Scanning',
        color: 'text-blue-500',
        bg: 'bg-blue-500/10',
        badge: 'default',
    },
    submitting: {
        label: 'Submitting',
        color: 'text-indigo-500',
        bg: 'bg-indigo-500/10',
        badge: 'default',
    },
    done: {
        label: 'Done',
        color: 'text-green-500',
        bg: 'bg-green-500/10',
        badge: 'secondary',
    },
    error: {
        label: 'Error',
        color: 'text-red-500',
        bg: 'bg-red-500/10',
        badge: 'destructive',
    },
}

export const StatusIndicator = ({
    status,
    error,
    lastJobId,
}: {
    status: HackrfStatus
    error: string | null
    lastJobId: string | null
}) => {
    const config = STATUS_CONFIG[status]
    const isActive = status === 'scanning' || status === 'submitting'

    return (
        <View className="items-center py-8 gap-4">
            <View className={`items-center justify-center rounded-full ${config.bg} h-28 w-28`}>
                {isActive ? (
                    <ActivityIndicator size="large" color="#3b82f6" />
                ) : (
                    <View
                        className={`h-5 w-5 rounded-full ${
                            status === 'done'
                                ? 'bg-green-500'
                                : status === 'error'
                                  ? 'bg-red-500'
                                  : 'bg-muted-foreground'
                        }`}
                    />
                )}
            </View>

            <Badge variant={config.badge}>
                <Text>{config.label}</Text>
            </Badge>

            {error && (
                <View className="bg-destructive/10 rounded-xl px-5 py-3 w-full">
                    <Text className="text-destructive text-center text-sm">{error}</Text>
                </View>
            )}

            {lastJobId && !error && (
                <Text className="text-muted-foreground text-xs">
                    Last job: {lastJobId.slice(0, 12)}...
                </Text>
            )}
        </View>
    )
}
