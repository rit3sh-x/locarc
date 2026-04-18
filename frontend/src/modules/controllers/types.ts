import type { FunctionReturnType, FunctionArgs } from 'convex/server'
import type { api } from '@backend/api'

export type ControllersOutput = FunctionReturnType<typeof api.private.controller.getMany>

export type AddControllerInput = FunctionArgs<typeof api.private.controller.create>

export type ModifyControllerInput = FunctionArgs<typeof api.private.controller.update>

export type Controller = ControllersOutput['page'][number]

export type RemoveControllerInput = FunctionArgs<typeof api.private.controller.remove>