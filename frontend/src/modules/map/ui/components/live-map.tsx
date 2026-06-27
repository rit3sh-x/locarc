import { Circle, MapContainer, Marker, Polygon, useMap, useMapEvents } from 'react-leaflet'
import type { LocationWithBounds, ControllerLocation, Location } from '../../types'
import { TileController } from './tile-controller'
import { controllerIcon, locationIcon } from './leaflet-icons'
import { useEffect, useState, Fragment } from 'react'
import { useMapCursor } from '../../context/map'
import L from 'leaflet'

const FALLBACK_RANGE_MIN_M = 2000
const FALLBACK_RANGE_MAX_M = 6000

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
            const size = map.getSize()
            const containerPx = Math.max(size.x, size.y)
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

function MapCenterController({ fallbackCenter, seedLat, seedLng }: { fallbackCenter: Location | null | undefined; seedLat?: number; seedLng?: number }) {
    const map = useMap()

    useEffect(() => {
        if (fallbackCenter) {
            const lat = seedLat ?? fallbackCenter.latitude
            const lng = seedLng ?? fallbackCenter.longitude
            map.setView([lat, lng], 14, { animate: true, duration: 0.5 })
        }
    }, [map, seedLat, seedLng, fallbackCenter?.latitude, fallbackCenter?.longitude])

    return null
}

function MovingMarkers({ points }: { points: LocationWithBounds[] }) {
    return (
        <>
            {points.map((p) => (
                <Fragment key={p.id}>
                    <Marker
                        position={[p.center.latitude, p.center.longitude]}
                        icon={locationIcon}
                    />
                    {p.bounds.length > 0 && (
                        <Polygon
                            positions={p.bounds.map((b) => [b.latitude, b.longitude])}
                            pathOptions={{
                                fillOpacity: 0.3,
                                opacity: 0.5,
                                color: '#3b82f6',
                                fillColor: '#3b82f6',
                            }}
                        />
                    )}
                </Fragment>
            ))}
        </>
    )
}

function ControllerMarkers({ points }: { points: ControllerLocation[] }) {
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

interface LiveMapProps {
    locations: LocationWithBounds[]
    controllers: ControllerLocation[]
    fallbackCenter?: Location | null
    seedLat?: number
    seedLng?: number
}

export const LiveMap = ({ locations, controllers, fallbackCenter, seedLat, seedLng }: LiveMapProps): React.JSX.Element => {
    const [fallbackRangeM, setFallbackRangeM] = useState<number | null>(null)

    useEffect(() => {
        if (!fallbackCenter) {
            setFallbackRangeM(null)
            return
        }

        const generateRange = () =>
            FALLBACK_RANGE_MIN_M +
            Math.random() * (FALLBACK_RANGE_MAX_M - FALLBACK_RANGE_MIN_M)

        setFallbackRangeM(generateRange())
        const intervalId = window.setInterval(() => {
            setFallbackRangeM(generateRange())
        }, 30_000)

        return () => window.clearInterval(intervalId)
    }, [fallbackCenter?.latitude, fallbackCenter?.longitude])

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
            <MapCenterController fallbackCenter={fallbackCenter} seedLat={seedLat} seedLng={seedLng} />
            <TileController />
            <MapCursorTracker />
            <MovingMarkers points={locations} />
            <ControllerMarkers points={controllers} />
            {!locations.length && fallbackCenter && (
                <>
                    {fallbackRangeM !== null && (
                        <Circle
                            center={[seedLat ?? fallbackCenter.latitude, seedLng ?? fallbackCenter.longitude]}
                            radius={fallbackRangeM}
                            pathOptions={{
                                fillOpacity: 0.2,
                                opacity: 0.5,
                                color: '#3b82f6',
                                fillColor: '#3b82f6',
                            }}
                        />
                    )}
                    <Marker
                        position={[seedLat ?? fallbackCenter.latitude, seedLng ?? fallbackCenter.longitude]}
                        icon={locationIcon}
                    />
                </>
            )}
        </MapContainer>
    )
}
