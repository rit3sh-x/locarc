import { Loader2Icon } from 'lucide-react'
import { ToggleButton, ToggleButtonSkeleton } from '../components/toggle-button'
import { Suspense, lazy, useMemo } from 'react'
import { MapCursorProvider, useMapCursor } from '../../context/map'
import { useLocations } from '../../hooks/use-map'
import { useUserInfo } from '@/modules/dashboard/hooks/use-user'
import type { ControllerLocation, Location } from '../../types'

const SEED_LOCATION_LAT = 30.968083
const SEED_LOCATION_LNG = 76.473056

const LiveMap = lazy(() =>
    import('../components/live-map').then((m) => ({
        default: m.LiveMap,
    })),
)

const generateSeedLocationWithError = (): Location => {
    return {
        latitude: SEED_LOCATION_LAT,
        longitude: SEED_LOCATION_LNG,
    }
}

const averageControllerCenter = (controllers: ControllerLocation[]): Location | null => {
    if (controllers.length === 0) return generateSeedLocationWithError()
    const sum = controllers.reduce(
        (acc, c) => ({
            latitude: acc.latitude + c.coordinate.latitude,
            longitude: acc.longitude + c.coordinate.longitude,
        }),
        { latitude: 0, longitude: 0 },
    )
    return {
        latitude: sum.latitude / controllers.length,
        longitude: sum.longitude / controllers.length,
    }
}

export const MapView = (): React.JSX.Element => {
    const { profile, isLoading } = useUserInfo()
    const { locations, controllers } = useLocations()

    const fallbackCenter = useMemo(
        () => (locations.length === 0 ? averageControllerCenter(controllers) : null),
        [locations.length, controllers],
    )

    if (isLoading || !profile) return <MapViewSkeleton />

    return (
        <MapCursorProvider>
            <div className="relative h-[calc(100vh-4rem)] w-full overflow-hidden">
                <div className="z-10 relative w-full h-full">
                    <LiveMap
                        locations={locations}
                        controllers={controllers}
                        fallbackCenter={fallbackCenter}
                        seedLat={SEED_LOCATION_LAT}
                        seedLng={SEED_LOCATION_LNG}
                    />
                </div>
                <div className="pointer-events-none w-full h-full p-2 absolute top-0 left-0 z-50 flex flex-col justify-between items-center">
                    <Suspense fallback={<ToggleButtonSkeleton />}>
                        <ToggleButton started={profile.started} />
                    </Suspense>
                    <div className="w-full">
                        <MapCursorPosition />
                    </div>
                </div>
            </div>
        </MapCursorProvider>
    )
}

export const MapViewSkeleton = (): React.JSX.Element => {
    return (
        <div className="w-full h-full flex-1 flex items-center justify-center">
            <Loader2Icon className="text-muted-foreground animate-spin" />
        </div>
    )
}

export const MapCursorPosition = (): React.JSX.Element => {
    const { pos } = useMapCursor()

    if (!pos) return <></>

    return (
        <div className="pointer-events-none absolute bottom-2 left-2 z-50 rounded-md border bg-popover px-2 py-1 text-xs shadow">
            Lat: {pos.latitude.toFixed(6)}, Lng: {pos.longitude.toFixed(6)}
        </div>
    )
}
