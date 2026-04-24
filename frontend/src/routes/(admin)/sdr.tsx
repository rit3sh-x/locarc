import { SdrView } from '@/modules/sdr/ui/views/sdr-view'
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/(admin)/sdr')({
    component: SdrView,
})
