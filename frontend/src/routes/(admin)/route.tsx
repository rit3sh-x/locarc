import { DashboardLayout } from '@/modules/dashboard/ui/layouts/dashboard-layout'
import { createFileRoute, Outlet } from '@tanstack/react-router'

export const Route = createFileRoute('/(admin)')({
    component: RouteComponent,
})

function RouteComponent() {
    return (
        <DashboardLayout>
            <Outlet />
        </DashboardLayout>
    )
}
