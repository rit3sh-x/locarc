import { useContext } from 'react'
import { AuthLayoutContext } from '../context/auth-layout-context'
import type { AuthLayoutContextValue } from '../context/auth-layout-context'

export const useAuthLayoutContext = (): AuthLayoutContextValue => {
    const context = useContext(AuthLayoutContext)
    if (!context) {
        throw new Error('useAuthLayoutContext must be used within an AuthProvider')
    }
    return context
}
