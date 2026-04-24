import type { FunctionReturnType } from 'convex/server'
import type { api } from '@backend/api'

export type ReplayResult = NonNullable<FunctionReturnType<typeof api.private.localization.replay>>

export type ReplayLocation = ReplayResult['locations'][number]

export type ReplayController = ReplayResult['controllers'][number]

export type DateRange = {
    from: Date | undefined
    to: Date | undefined
}
