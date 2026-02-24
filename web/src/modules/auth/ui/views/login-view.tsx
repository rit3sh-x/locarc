"use client";

import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { loginWithPassword } from "../../utils/auth-handlers";
import { LoginForm, type LoginFormValues } from "../components/login-form";

export const LoginView = (): React.JSX.Element => {
    const router = useRouter();

    const handleLogin = async ({ email, password }: LoginFormValues) => {
        try {
            await loginWithPassword({
                email,
                password,
                fetchOptions: {
                    onSuccess: () => {
                        router.push("/");
                    },
                },
            });
        } catch (error) {
            toast.error("Login failed", {
                description:
                    error instanceof Error
                        ? error.message
                        : "Please check your credentials",
            });
        }
    };

    return (
        <div className="w-full h-full flex items-center justify-center relative overflow-hidden">
            <LoginForm onSubmit={handleLogin} />
        </div>
    );
};
