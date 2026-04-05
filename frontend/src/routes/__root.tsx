import { createRootRoute, Outlet } from '@tanstack/react-router'
import { TanStackRouterDevtoolsPanel } from '@tanstack/react-router-devtools'
import { TanStackDevtools } from '@tanstack/react-devtools'
import { useAuthRedirect } from '@/modules/auth/hooks/use-auth-redirect'

import { ErrorUI } from '@/components/error-ui'

export const Route = createRootRoute({
    component: Root,
    errorComponent: ErrorUI,
})

function Root() {
    const { isLoading } = useAuthRedirect();

    if (isLoading) {
        return <div className="h-dvh bg-background" />;
    }

    return (
        <div className="h-full w-full">
            <Outlet />
            <TanStackDevtools
                plugins={[
                    {
                        name: 'Tanstack Router',
                        render: <TanStackRouterDevtoolsPanel />,
                    },
                ]}
            />
        </div>
    )
}