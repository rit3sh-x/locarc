import { createFileRoute, Outlet } from '@tanstack/react-router'
import { AuthLayout } from '@/modules/auth/ui/layouts/auth-layout'

export const Route = createFileRoute('/(auth)')({
    component: RouteComponent,
})

function RouteComponent() {
    return (
        <AuthLayout>
            <Outlet />
        </AuthLayout>
    )
}
