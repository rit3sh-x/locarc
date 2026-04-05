import { useMutation, usePaginatedQuery } from 'convex/react'
import { useControllersParams } from './use-controllers-params'
import { toast } from 'sonner'
import { api } from '@backend/api'
import { CONTROLLERS_PAGE_SIZE } from '../constants'
import { useState } from 'react'
import type { AddControllerInput, ModifyControllerInput, RemoveControllerInput } from '../types'

export const useAddController = () => {
    const [isPending, setIsPending] = useState(false)
    const addControllerMutation = useMutation(api.private.controller.create)

    const addController = async (input: AddControllerInput) => {
        setIsPending(true)
        try {
            await addControllerMutation(input)
            toast.success(`Controller "${input.name}" created successfully`)
        } catch {
            toast.error('Failed to create controller.')
        } finally {
            setIsPending(false)
        }
    }

    return { addController, isPending }
}

export const useModifyController = () => {
    const [isPending, setIsPending] = useState(false)
    const modifyControllerMutation = useMutation(api.private.controller.update)

    const modifyController = async (input: ModifyControllerInput) => {
        setIsPending(true)
        try {
            await modifyControllerMutation(input)
            toast.success(`Controller updated successfully`)
        } catch {
            toast.error('Failed to update controller.')
        } finally {
            setIsPending(false)
        }
    }

    return { modifyController, isPending }
}

export const useRemoveController = () => {
    const [isPending, setIsPending] = useState(false)
    const removeControllerMutation = useMutation(api.private.controller.remove)

    const removeController = async (input: RemoveControllerInput) => {
        setIsPending(true)
        try {
            await removeControllerMutation(input)
            toast.success(`Controller deleted successfully`)
        } catch {
            toast.error('Failed to delete controller.')
        } finally {
            setIsPending(false)
        }
    }

    return { removeController, isPending }
}

export const useGetControllers = () => {
    const [{ search }] = useControllersParams()

    return usePaginatedQuery(
        api.private.controller.getMany,
        { search },
        { initialNumItems: CONTROLLERS_PAGE_SIZE },
    )
}
