import type { api } from '@backend/api'
import type { FunctionArgs } from 'convex/server'

export type UpdateSettingsInput = FunctionArgs<typeof api.private.settings.update>

export type ResetSettingsInput = FunctionArgs<typeof api.private.settings.reset>
