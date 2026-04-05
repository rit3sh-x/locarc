import { createContext } from 'react'
import type { Doc } from '@backend/authDataModel'

export interface AuthenticationContextValue {
    isLoading: boolean
    isAuthenticated: boolean
    hasUsername: boolean
    showAuth: boolean
    showHome: boolean
    user: Doc<'user'> | null
}

export const AuthenticationContext = createContext<AuthenticationContextValue | null>(null)
