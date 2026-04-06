import { useMutation } from 'convex/react'
import { useQuery } from 'convex-helpers/react/cache'
import { api } from '@backend/api'
import { useState } from 'react'
import type { ResetSettingsInput, UpdateSettingsInput } from '../types'
import { toast } from 'sonner'

export const useSettings = () => {
    const settings = useQuery(api.private.settings.get, {})

    return {
        settings,
        isLoading: settings === undefined,
    }
}

export const useUpdateSettings = () => {
    const [isPending, setIsPending] = useState(false)
    const updateSettingsMutation = useMutation(api.private.settings.update)

    const updateSettings = async (input: UpdateSettingsInput) => {
        setIsPending(true)
        try {
            await updateSettingsMutation(input)
            toast.success('Updated profile')
        } catch {
            toast.error('Failed to update profile')
        } finally {
            setIsPending(false)
        }
    }

    return { updateSettings, isPending }
}

export const useResetSettings = () => {
    const [isPending, setIsPending] = useState(false)
    const resetSettingsMutation = useMutation(api.private.settings.reset)

    const resetSettings = async (input: ResetSettingsInput) => {
        setIsPending(true)
        try {
            await resetSettingsMutation(input)
            toast.success('Updated profile')
        } catch {
            toast.error('Failed to update profile')
        } finally {
            setIsPending(false)
        }
    }

    return { resetSettings, isPending }
}
