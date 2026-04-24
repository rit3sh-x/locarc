import { ReplayView } from '@/modules/replay/ui/views/replay-view'
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/(admin)/replay')({
    component: ReplayView,
})
