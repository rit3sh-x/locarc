import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native'
import { Stack } from 'expo-router/stack'
import { StatusBar } from 'expo-status-bar'
import 'react-native-reanimated'
import { ConvexReactClient, useConvexAuth } from 'convex/react'
import type { AuthClient } from '@convex-dev/better-auth/react'
import { PortalHost } from '@rn-primitives/portal'
import { ConvexBetterAuthProvider } from '@convex-dev/better-auth/react'
import { authClient } from '@/lib/auth-client'
import { useColorScheme } from '@/hooks/use-color-scheme'
import { View, ActivityIndicator } from 'react-native'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { SystemBars } from 'react-native-edge-to-edge'
import { cn } from '@/lib/utils'
import './globals.css'

const convex = new ConvexReactClient(process.env.EXPO_PUBLIC_CONVEX_URL!, {
    expectAuth: true,
    unsavedChangesWarning: false,
})

function AuthGate() {
    const colorScheme = useColorScheme()
    const isDark = colorScheme === 'dark'
    const { isAuthenticated, isLoading } = useConvexAuth()

    if (isLoading) {
        return (
            <View
                className={cn('flex-1 items-center justify-center bg-background', isDark && 'dark')}
            >
                <ActivityIndicator className="text-primary" size="large" />
            </View>
        )
    }

    return (
        <ThemeProvider value={isDark ? DarkTheme : DefaultTheme}>
            <View className={`flex-1 ${isDark ? 'dark' : ''}`}>
                <Stack screenOptions={{ headerShown: false }}>
                    <Stack.Screen name="(auth)" redirect={isAuthenticated} />
                    <Stack.Screen name="(home)" redirect={!isAuthenticated} />
                </Stack>
                <StatusBar style={isDark ? 'light' : 'dark'} />
                <SystemBars hidden style="auto" />
                <PortalHost />
            </View>
        </ThemeProvider>
    )
}

export default function RootLayout() {
    return (
        <SafeAreaProvider>
            <ConvexBetterAuthProvider
                client={convex}
                authClient={authClient as unknown as AuthClient}
            >
                <AuthGate />
            </ConvexBetterAuthProvider>
        </SafeAreaProvider>
    )
}
