import { MapContainer, Marker, Polygon, useMap, useMapEvents } from 'react-leaflet'
import type { LocationWithBounds, ControllerLocation } from '../../types'
import { TileController } from './tile-controller'
import { controllerIcon, locationIcon } from './leaflet-icons'
import { useEffect, Fragment } from 'react'
import { useMapCursor } from '../../context/map'
import L from 'leaflet'

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
}

export const LiveMap = ({ locations, controllers }: LiveMapProps): React.JSX.Element => {
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
            <MovingMarkers points={locations} />
            <ControllerMarkers points={controllers} />
        </MapContainer>
    )
}
