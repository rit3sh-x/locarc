import { UserView } from '@/modules/dashboard/ui/views/user-view'
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/(user)/details')({
    component: UserView,
})
