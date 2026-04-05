import { ControllerView } from '@/modules/controllers/ui/views/controllers-view'
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/(admin)/controllers')({
    component: ControllerView,
})
