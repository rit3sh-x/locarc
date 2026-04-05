import { authClient } from '@/lib/auth-client'
import { toDisplayUsername } from '@/lib/formatters'
import { toast } from 'sonner'

export async function loginWithPassword({
    email,
    password,
    fetchOptions,
}: {
    email: string
    password: string
    fetchOptions?: {
        onSuccess?: () => void
        onError?: ({ error }: { error: unknown }) => void
    }
}) {
    return authClient.signIn.email(
        { email, password },
        {
            ...fetchOptions,
            onError: ({ error }) => {
                toast.error(error.message)
                fetchOptions?.onError?.({ error })
            },
        },
    )
}

export async function signUpWithEmail({
    email,
    password,
    username,
    name,
    organizationSlug,
    fetchOptions,
}: {
    email: string
    password: string
    username: string
    name: string
    organizationSlug: string
    fetchOptions?: {
        onSuccess?: () => void
        onError?: ({ error }: { error: unknown }) => void
    }
}) {
    return authClient.signUp.email(
        {
            email,
            name,
            organizationSlug,
            password,
            username,
            displayUsername: toDisplayUsername(username),
        },
        {
            ...fetchOptions,
            onError: ({ error }) => {
                toast.error(error.message)
                fetchOptions?.onError?.({ error })
            },
        },
    )
}
