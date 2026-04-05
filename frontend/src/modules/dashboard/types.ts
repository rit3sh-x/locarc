import type { api } from '@backend/api'
import type { FunctionArgs } from 'convex/server'

export type UpdateProfileInput = FunctionArgs<typeof api.private.user.updateProfile>
