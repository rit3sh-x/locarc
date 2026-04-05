import { ScrollView, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Text } from '@/components/ui/text'
import { SignOut } from '../components/sign-out'
import { StatusIndicator } from '../components/status-indicator'
import { ConnectionCard } from '../components/connection-card'
import { RfSettingsCard } from '../components/rf-settings-card'
import { LocationCard } from '../components/location-card'
import { useHackrf } from '../../hooks/use-hackrf'
import { useLocation } from '../../hooks/use-location'

export const HomeView = () => {
    const { status, error, lastJobId, controller } = useHackrf()
    useLocation()
    const insets = useSafeAreaInsets()

    const isConnected = controller !== undefined

    return (
        <View className="flex-1 bg-background" style={{ paddingTop: insets.top }}>
            <View className="flex-row items-center justify-between px-5 py-3">
                <Text className="text-foreground text-lg font-semibold" numberOfLines={1}>
                    {controller?.name ?? 'Loading...'}
                </Text>
                <SignOut />
            </View>

            <ScrollView
                className="flex-1 px-5"
                contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
                showsVerticalScrollIndicator={false}
            >
                <StatusIndicator status={status} error={error} lastJobId={lastJobId} />

                <ConnectionCard
                    status={status}
                    isConnected={isConnected}
                    started={controller?.started ?? false}
                />

                {controller && <RfSettingsCard settings={controller.settings} />}

                {controller && (
                    <LocationCard latitude={controller.latitude} longitude={controller.longitude} />
                )}
            </ScrollView>
        </View>
    )
}
