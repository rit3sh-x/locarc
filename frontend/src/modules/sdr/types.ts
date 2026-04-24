import type { FunctionReturnType } from 'convex/server'
import type { api } from '@backend/api'

export type SdrListResult = FunctionReturnType<typeof api.private.sdr.list>

export type SdrReading = SdrListResult['page'][number]

export type SdrControllerOption = FunctionReturnType<typeof api.private.sdr.listControllers>[number]
