import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth-client";
import { useRouter } from "expo-router";
import { LogOutIcon } from "lucide-react-native";
import { useState } from "react";

export const SignOut = () => {
    const router = useRouter();
    const [loading, setLoading] = useState(false);

    const handleSignout = async () => {
        setLoading(true);
        await authClient.signOut({
            fetchOptions: {
                onSuccess: () => router.replace("/(auth)/login"),
                onError: () => setLoading(false),
            },
        });
        setLoading(false);
    };

    return (
        <Button onPress={handleSignout} disabled={loading}>
            <LogOutIcon />
        </Button>
    );
};
