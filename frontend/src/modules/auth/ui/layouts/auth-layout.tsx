import { useLocation } from '@tanstack/react-router'
import { useEffect } from 'react'

import { useAuthLayoutContext } from '../../hooks/use-auth-layout-context'
import { AuthProvider } from '../../context/auth-layout-provider'
import { Watchers } from '../components/watchers'
import { CollegeInfo } from '../components/college-info'

interface AuthLayoutInnerProps {
    children: React.ReactNode
}

interface AuthLayoutProps {
    children: React.ReactNode
}

export const AuthLayoutInner = ({ children }: AuthLayoutInnerProps): React.JSX.Element => {
    const { isTyping, passwordExist, showPassword, reset } = useAuthLayoutContext()

    const pathname = useLocation({
        select: (location) => location.pathname,
    })

    useEffect(() => {
        reset()
    }, [pathname, reset])

    return (
        <div className="h-full w-full grid grid-cols-1 lg:grid-cols-2 p-6 bg-neutral-900">
            <div className="hidden lg:flex items-center justify-center bg-neutral-300 rounded-md h-full w-full overflow-hidden relative">
                <div className="absolute top-4 left-4 z-20">
                    <CollegeInfo />
                </div>

                <Watchers
                    isTyping={isTyping}
                    passwordExist={passwordExist}
                    showPassword={showPassword}
                />
            </div>

            <div className="flex items-center justify-center p-6 h-full w-full">{children}</div>
        </div>
    )
}

export const AuthLayout = ({ children }: AuthLayoutProps): React.JSX.Element => {
    return (
        <AuthProvider>
            <AuthLayoutInner>{children}</AuthLayoutInner>
        </AuthProvider>
    )
}
