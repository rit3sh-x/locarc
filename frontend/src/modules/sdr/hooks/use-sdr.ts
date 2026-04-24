import { usePaginatedQuery } from 'convex/react'
import { useQuery } from 'convex-helpers/react/cache'
import { api } from '@backend/api'
import type { Id } from '@backend/dataModel'
import { SDR_PAGE_SIZE } from '../constants'

export const useSdrReadings = (controllerId: Id<'controller'> | undefined) => {
    return usePaginatedQuery(
        api.private.sdr.list,
        { controllerId },
        { initialNumItems: SDR_PAGE_SIZE },
    )
}

export const useSdrControllers = () => {
    const controllers = useQuery(api.private.sdr.listControllers, {})
    return { controllers: controllers ?? [], isLoading: controllers === undefined }
}
