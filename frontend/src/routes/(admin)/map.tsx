import { MapView } from '@/modules/map/ui/views/map-view'
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/(admin)/map')({
    component: MapView,
})
