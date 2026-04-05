import { useEffect } from 'react'
import { useMatches, useRouter } from '@tanstack/react-router'
import { useAuthentication } from './use-authentication'
import type { Route } from '@/types'

type AuthState = 'auth' | 'home'

const AUTH_ROUTE: Route = '/signin'

const HOME_ROUTE_BY_ROLE = {
    ADMIN: '/controllers',
    USER: '/details',
} as const satisfies Record<'ADMIN' | 'USER', Route>

const ALLOWED_GROUPS: Record<AuthState, string[]> = {
    auth: ['/(auth)'],
    home: ['/(admin)', '/(user)'],
}

function resolveAuthState(flags: { showAuth: boolean; showHome: boolean }): AuthState | null {
    if (flags.showAuth) return 'auth'
    if (flags.showHome) return 'home'
    return null
}

export function useAuthRedirect() {
    const { isLoading, showAuth, showHome, user } = useAuthentication()
    const router = useRouter()
    const matches = useMatches()

    const role = user?.role

    useEffect(() => {
        if (isLoading) return

        const authState = resolveAuthState({
            showAuth,
            showHome,
        })

        if (!authState) return

        const allowedPatterns = ALLOWED_GROUPS[authState]
        const isInAllowedGroup = matches.some((m) =>
            allowedPatterns.some((pattern) => m.routeId.includes(pattern)),
        )

        if (isInAllowedGroup) return

        if (authState === 'auth') {
            router.navigate({ to: AUTH_ROUTE, replace: true })
            return
        }

        if (role === 'ADMIN') {
            router.navigate({ to: HOME_ROUTE_BY_ROLE.ADMIN, replace: true })
            return
        }

        if (role === 'USER') {
            router.navigate({ to: HOME_ROUTE_BY_ROLE.USER, replace: true })
            return
        }

        router.navigate({ to: AUTH_ROUTE, replace: true })
    }, [isLoading, showAuth, showHome, role, matches, router])

    return { isLoading }
}
