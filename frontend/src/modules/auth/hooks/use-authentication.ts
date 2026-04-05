import { useContext } from 'react'
import { AuthenticationContext } from '../context/auth-context'
import type { AuthenticationContextValue } from '../context/auth-context'

export const useAuthentication = () => {
    const ctx = useContext(AuthenticationContext)
    if (!ctx) throw new Error('useAuthentication must be used within AuthenticationProvider')
    return ctx
}

type AuthenticatedUser = Omit<NonNullable<AuthenticationContextValue['user']>, 'username'> & {
    username: string
}

export const useAuthenticatedUser = (): AuthenticationContextValue & {
    user: AuthenticatedUser
} => {
    const ctx = useAuthentication()
    if (!ctx.user) throw new Error('useAuthenticatedUser must be used in an authenticated route')
    return ctx as AuthenticationContextValue & { user: AuthenticatedUser }
}
