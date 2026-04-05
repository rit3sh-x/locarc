import { Stack } from 'expo-router/stack'
import { View } from 'react-native'

export default function AuthLayout() {
    return (
        <View className="flex-1">
            <Stack
                screenOptions={{
                    headerShown: false,
                    animation: 'fade',
                }}
            />
        </View>
    )
}
