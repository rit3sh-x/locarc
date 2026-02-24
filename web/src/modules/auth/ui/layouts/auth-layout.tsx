"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { ErrorBoundary } from "react-error-boundary";

import { AuthProvider, useAuthLayoutContext } from "../../context/auth-context";
import { Watchers } from "../components/watchers";
import { CollegeInfo } from "../components/college-info";
import { ErrorUI } from "@/components/error-ui";

interface AuthLayoutInnerProps {
    children: React.ReactNode;
}

interface AuthLayoutProps {
    children: React.ReactNode;
}

export const AuthLayoutInner = ({
    children,
}: AuthLayoutInnerProps): React.JSX.Element => {
    const { isTyping, passwordExist, showPassword, reset } =
        useAuthLayoutContext();

    const pathname = usePathname();

    useEffect(() => {
        reset();
    }, [pathname, reset]);

    return (
        <div className="min-h-screen w-full grid grid-cols-1 lg:grid-cols-2 p-6 bg-neutral-900">
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

            <div className="flex items-center justify-center p-6 h-full w-full">
                {children}
            </div>
        </div>
    );
};

export const AuthLayout = ({
    children,
}: AuthLayoutProps): React.JSX.Element => {
    return (
        <ErrorBoundary fallback={<ErrorUI />}>
            <AuthProvider>
                <AuthLayoutInner>{children}</AuthLayoutInner>
            </AuthProvider>
        </ErrorBoundary>
    );
};
