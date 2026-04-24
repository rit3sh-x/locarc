import { MapContainer, Marker, Polygon, useMap, useMapEvents } from 'react-leaflet'
import { Fragment, useEffect } from 'react'
import L from 'leaflet'
import { TileController } from '@/modules/map/ui/components/tile-controller'
import { controllerIcon, locationIcon } from '@/modules/map/ui/components/leaflet-icons'
import { useMapCursor } from '@/modules/map/context/map'
import { REPLAY_TRAIL_MS } from '../../constants'
import type { ReplayController, ReplayLocation } from '../../types'

function MapCursorTracker() {
    const { setPos } = useMapCursor()
    useMapEvents({
        mousemove(e) {
            setPos({ latitude: e.latlng.lat, longitude: e.latlng.lng })
        },
        mouseout() {
            setPos(null)
        },
    })
    return null
}

function MapInit() {
    const map = useMap()

    useEffect(() => {
        const container = map.getContainer()
        map.setMaxBounds(L.latLngBounds(L.latLng(-90, -180), L.latLng(90, 180)))
        map.options.maxBoundsViscosity = 1.0

        const setMinZoom = () => {
            const containerPx = Math.max(container.clientWidth, container.clientHeight)
            const minZoom = Math.ceil(Math.log2(containerPx / 256))
            map.setMinZoom(minZoom)
        }

        const resizeObserver = new ResizeObserver(() => {
            map.invalidateSize({ animate: false })
            setMinZoom()
        })

        resizeObserver.observe(container)
        setMinZoom()

        return () => resizeObserver.disconnect()
    }, [map])

    return null
}

function computeOpacity(age: number): number {
    if (age <= 0) return 1
    const ratio = 1 - age / REPLAY_TRAIL_MS
    return Math.max(0.15, Math.min(1, ratio))
}

function ReplayMarkers({ points, currentMs }: { points: ReplayLocation[]; currentMs: number }) {
    return (
        <>
            {points.map((p) => {
                const age = currentMs - p.createdAt
                const opacity = computeOpacity(age)
                return (
                    <Fragment key={p.id}>
                        <Marker
                            position={[p.center.latitude, p.center.longitude]}
                            icon={locationIcon}
                            opacity={opacity}
                        />
                        {p.bounds.length > 2 && (
                            <Polygon
                                positions={p.bounds.map((b) => [b.latitude, b.longitude])}
                                pathOptions={{
                                    weight: 1,
                                    opacity: opacity * 0.9,
                                    fillOpacity: opacity * 0.2,
                                    color: '#3b82f6',
                                    fillColor: '#3b82f6',
                                }}
                            />
                        )}
                    </Fragment>
                )
            })}
        </>
    )
}

function ControllerMarkers({ points }: { points: ReplayController[] }) {
    return (
        <>
            {points.map((p) => (
                <Marker
                    key={p.id}
                    position={[p.coordinate.latitude, p.coordinate.longitude]}
                    icon={controllerIcon}
                />
            ))}
        </>
    )
}

interface ReplayMapProps {
    visibleLocations: ReplayLocation[]
    controllers: ReplayController[]
    currentMs: number
}

export const ReplayMap = ({
    visibleLocations,
    controllers,
    currentMs,
}: ReplayMapProps): React.JSX.Element => {
    return (
        <MapContainer
            className="w-full h-full overflow-hidden"
            style={{ width: '100%', height: '100%', overflow: 'hidden' }}
            center={[20, 78]}
            zoom={5}
            zoomControl={true}
            scrollWheelZoom={true}
            worldCopyJump={false}
            maxBoundsViscosity={1.0}
            attributionControl={false}
        >
            <MapInit />
            <TileController />
            <MapCursorTracker />
            <ReplayMarkers points={visibleLocations} currentMs={currentMs} />
            <ControllerMarkers points={controllers} />
        </MapContainer>
    )
}
