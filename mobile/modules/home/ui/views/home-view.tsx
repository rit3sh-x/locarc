import { View, ActivityIndicator } from "react-native";
import { Text } from "@/components/ui/text";
import { ThemeToggle } from "../components/theme-toggle";
import { SignOut } from "../components/sign-out";
import { useHackrf } from "../../hooks/use-hackrf";

const STATUS_CONFIG: Record<
    string,
    { label: string; color: string; bg: string }
> = {
    idle: {
        label: "Idle",
        color: "text-muted-foreground",
        bg: "bg-muted",
    },
    waiting: {
        label: "Waiting for Job",
        color: "text-yellow-600",
        bg: "bg-yellow-500/10",
    },
    scanning: {
        label: "Scanning",
        color: "text-blue-500",
        bg: "bg-blue-500/10",
    },
    submitting: {
        label: "Submitting",
        color: "text-indigo-500",
        bg: "bg-indigo-500/10",
    },
    done: {
        label: "Done",
        color: "text-green-500",
        bg: "bg-green-500/10",
    },
    error: {
        label: "Error",
        color: "text-red-500",
        bg: "bg-red-500/10",
    },
};

export const HomeView = () => {
    const { status, error, lastJobId } = useHackrf();

    const config = STATUS_CONFIG[status] ?? STATUS_CONFIG.idle;
    const isActive = status === "scanning" || status === "submitting";

    return (
        <View className="flex-1 bg-background px-5 pt-16 pb-6">
            <View className="flex-1 items-center justify-center gap-6">
                <View
                    className={`items-center justify-center rounded-full ${config.bg} h-32 w-32`}
                >
                    {isActive ? (
                        <ActivityIndicator size="large" color="#3b82f6" />
                    ) : (
                        <View
                            className={`h-5 w-5 rounded-full ${
                                status === "done"
                                    ? "bg-green-500"
                                    : status === "error"
                                      ? "bg-red-500"
                                      : "bg-muted-foreground"
                            }`}
                        />
                    )}
                </View>

                <Text
                    className={`text-2xl font-bold tracking-tight ${config.color}`}
                >
                    {config.label}
                </Text>

                {error && (
                    <View className="bg-red-500/10 mt-2 rounded-xl px-5 py-3">
                        <Text className="text-red-500 text-center text-sm">
                            {error}
                        </Text>
                    </View>
                )}

                {lastJobId && !error && (
                    <Text className="text-muted-foreground text-xs">
                        Last job: {lastJobId.slice(0, 12)}…
                    </Text>
                )}
            </View>

            <View className="bg-card border-border flex-row items-center justify-between rounded-2xl border px-6 py-4 shadow-sm shadow-black/5">
                <ThemeToggle />
                <SignOut />
            </View>
        </View>
    );
};
