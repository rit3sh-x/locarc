import { useConvexAuth } from 'convex/react'
import { useQuery } from 'convex-helpers/react/cache'
import { api } from '@backend/api'
import { AuthenticationContext } from './auth-context'
import type { ReactNode } from 'react'

export function AuthenticationProvider({ children }: { children: ReactNode }) {
    const { isAuthenticated, isLoading: isConvexLoading } = useConvexAuth()

    const user = useQuery(api.auth.user.getUser, isAuthenticated ? {} : 'skip')
    const isUserLoading = isAuthenticated && user === undefined

    const isLoading = isConvexLoading || isUserLoading

    const hasUsername = !!user?.username

    const showAuth = !isLoading && !isAuthenticated
    const showHome = !isLoading && isAuthenticated && hasUsername

    return (
        <AuthenticationContext.Provider
            value={{
                isLoading,
                isAuthenticated,
                hasUsername,
                showAuth,
                showHome,
                user: user ?? null,
            }}
        >
            {children}
        </AuthenticationContext.Provider>
    )
}
