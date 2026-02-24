import { Stack } from "expo-router/stack";
import { View } from "react-native";
import { useColorScheme } from "@/hooks/use-color-scheme";

export default function AuthLayout() {
    const colorScheme = useColorScheme();
    const isDark = colorScheme === "dark";

    return (
        <View className={`flex-1 bg-background ${isDark ? "dark" : ""}`}>
            <Stack
                screenOptions={{
                    headerShown: false,
                    contentStyle: { backgroundColor: "transparent" },
                    animation: "fade",
                }}
            />
        </View>
    );
}
