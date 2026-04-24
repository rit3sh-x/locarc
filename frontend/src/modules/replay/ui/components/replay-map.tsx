import { MapContainer, Marker, Polygon, useMap, useMapEvents } from 'react-leaflet'
import { Fragment, useEffect } from 'react'
import L from 'leaflet'
import { TileController } from '@/modules/map/ui/components/tile-controller'
import { controllerIcon, locationIcon } from '@/modules/map/ui/components/leaflet-icons'
import { useMapCursor } from '@/modules/map/context/map'
import type { ReplayController, ReplayFrameLocation } from '../../types'

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

function FrameMarkers({ points }: { points: ReplayFrameLocation[] }) {
    return (
        <>
            {points.map((p) => (
                <Fragment key={p.id}>
                    <Marker
                        position={[p.center.latitude, p.center.longitude]}
                        icon={locationIcon}
                    />
                    {p.bounds.length > 2 && (
                        <Polygon
                            positions={p.bounds.map((b) => [b.latitude, b.longitude])}
                            pathOptions={{
                                weight: 1,
                                opacity: 0.9,
                                fillOpacity: 0.2,
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
    locations: ReplayFrameLocation[]
    controllers: ReplayController[]
}

export const ReplayMap = ({ locations, controllers }: ReplayMapProps): React.JSX.Element => {
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
            <FrameMarkers points={locations} />
            <ControllerMarkers points={controllers} />
        </MapContainer>
    )
}
