import type { Dispatch, SetStateAction } from 'react'
import { createContext } from 'react'

export type AuthLayoutContextValue = {
    showPassword: boolean
    setShowPassword: Dispatch<SetStateAction<boolean>>
    isTyping: boolean
    setIsTyping: Dispatch<SetStateAction<boolean>>
    passwordExist: boolean
    setPasswordExist: Dispatch<SetStateAction<boolean>>
    reset: () => void
}

export const AuthLayoutContext = createContext<AuthLayoutContextValue | undefined>(undefined)
