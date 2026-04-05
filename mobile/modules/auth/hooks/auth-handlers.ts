import { authClient } from '@/lib/auth-client'

export const signInWithUsername = async ({
    password,
    username,
    fetchOptions,
}: {
    username: string
    password: string
    fetchOptions?: {
        onSuccess?: () => void
        onError?: ({ error }: { error: unknown }) => void
    }
}) => {
    return await authClient.signIn.username(
        {
            username,
            password,
        },
        {
            ...fetchOptions,
        },
    )
}
