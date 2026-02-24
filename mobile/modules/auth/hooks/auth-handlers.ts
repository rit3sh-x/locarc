import { authClient } from "@/lib/auth-client";

export const signInWithUsername = ({
    password,
    username,
    fetchOptions,
}: {
    username: string;
    password: string;
    fetchOptions?: {
        onSuccess?: () => void;
        onError?: ({ error }: { error: unknown }) => void;
    };
}) => {
    return authClient.signIn.username(
        {
            username,
            password,
        },
        {
            ...fetchOptions,
        }
    );
};
