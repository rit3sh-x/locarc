import { View } from "react-native";
import { LoginForm, type LoginFormValues } from "../components/login-form";
import { signInWithUsername } from "../../hooks/auth-handlers";
import { useRouter } from "expo-router";

export const LoginView = () => {
    const router = useRouter();

    const handleLogin = async (values: LoginFormValues) => {
        await signInWithUsername({
            username: values.username,
            password: values.password,
            fetchOptions: {
                onSuccess: () => {
                    router.replace("/(home)");
                },
            },
        });
    };

    return (
        <View className="flex-1 bg-background items-center justify-center px-4 py-8">
            <LoginForm onSubmit={handleLogin} />
        </View>
    );
};
