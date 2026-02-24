"use client";

import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { signUpWithEmail } from "../../utils/auth-handlers";
import { SignUpForm, type SignUpFormValues } from "../components/sign-up-form";

export const SignUpView = (): React.JSX.Element => {
    const router = useRouter();

    const handleSignup = async ({
        email,
        name,
        organizationSlug,
        password,
        username,
    }: SignUpFormValues) => {
        try {
            await signUpWithEmail({
                email,
                password,
                username,
                name,
                organizationSlug,
                fetchOptions: {
                    onSuccess: () => {
                        router.push("/");
                    },
                },
            });
        } catch (error) {
            toast.error("Signup failed", {
                description:
                    error instanceof Error
                        ? error.message
                        : "Please check your details",
            });
        }
    };

    return (
        <div className="w-full h-full flex items-center justify-center relative overflow-hidden">
            <SignUpForm onSubmit={handleSignup} />
        </div>
    );
};
