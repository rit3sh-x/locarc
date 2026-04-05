import { useMutation } from 'convex/react'
import { useQuery } from 'convex-helpers/react/cache'
import { api } from '@backend/api'
import { useState } from 'react'
import type { UpdateProfileInput } from '../types'
import { toast } from 'sonner'

export const useControllerInfo = () => {
    const controller = useQuery(api.public.controller.getController, {})

    return {
        controller,
        isLoading: controller === undefined,
    }
}

export const useUserInfo = () => {
    const profile = useQuery(api.private.user.getProfile, {})

    return {
        profile,
        isLoading: profile === undefined,
    }
}

export const useUpdateProfile = () => {
    const [isPending, setIsPending] = useState(false)
    const updateProfileMutation = useMutation(api.private.user.updateProfile)

    const updateProfile = async (input: UpdateProfileInput) => {
        setIsPending(true)
        try {
            await updateProfileMutation(input)
            toast.success('Updated profile')
        } catch {
            toast.error('Failed to update profile')
        } finally {
            setIsPending(false)
        }
    }

    return { updateProfile, isPending }
}
