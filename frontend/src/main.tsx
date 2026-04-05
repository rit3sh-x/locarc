import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from '@tanstack/react-router'
import { getRouter } from './router'
import { ConvexQueryCacheProvider } from 'convex-helpers/react/cache'
import { NuqsAdapter } from 'nuqs/adapters/react'
import { ConvexReactClient } from 'convex/react'
import { authClient } from '@/lib/auth-client'
import { ConvexBetterAuthProvider } from '@convex-dev/better-auth/react'
import type { AuthClient } from '@convex-dev/better-auth/react'
import { ThemeProvider } from '@/components/theme-provider'
import { ENV } from 'varlock/env'
import 'leaflet/dist/leaflet.css'
import './styles.css'

import { AuthenticationProvider } from '@/modules/auth/context/auth-provider'
import { TooltipProvider } from '@/components/ui/tooltip'
import { Toaster } from '@/components/ui/sonner'

const router = getRouter()
const rootElement = document.getElementById('app')

const convex = new ConvexReactClient(ENV.VITE_CONVEX_URL, {
    expectAuth: true,
})

if (rootElement && !rootElement.innerHTML) {
    const root = createRoot(rootElement)

    root.render(
        <StrictMode>
            <TooltipProvider>
                <ThemeProvider>
                    <ConvexBetterAuthProvider
                        client={convex}
                        authClient={authClient as unknown as AuthClient}
                    >
                        <ConvexQueryCacheProvider>
                            <NuqsAdapter>
                                <AuthenticationProvider>
                                    <RouterProvider router={router} />
                                    <Toaster />
                                </AuthenticationProvider>
                            </NuqsAdapter>
                        </ConvexQueryCacheProvider>
                    </ConvexBetterAuthProvider>
                </ThemeProvider>
            </TooltipProvider>
        </StrictMode>,
    )
}
