import type { ReactNode } from 'react'
import { useCallback, useState } from 'react'
import { AuthLayoutContext } from './auth-layout-context'
import type { AuthLayoutContextValue } from './auth-layout-context'

export const AuthProvider = ({ children }: { children: ReactNode }) => {
    const [showPassword, setShowPassword] = useState<boolean>(false)
    const [isTyping, setIsTyping] = useState<boolean>(false)
    const [passwordExist, setPasswordExist] = useState<boolean>(false)

    const reset = useCallback(() => {
        setIsTyping(false)
        setPasswordExist(false)
        setShowPassword(false)
    }, [])

    const value: AuthLayoutContextValue = {
        showPassword,
        setShowPassword,
        isTyping,
        setIsTyping,
        passwordExist,
        setPasswordExist,
        reset,
    }

    return <AuthLayoutContext.Provider value={value}>{children}</AuthLayoutContext.Provider>
}
