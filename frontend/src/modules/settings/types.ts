import type { api } from '@backend/api'
import type { FunctionArgs, FunctionReturnType } from 'convex/server'

export type ResetSettingsInput = FunctionArgs<typeof api.private.settings.reset>

export type UpdateSettingsInput = FunctionArgs<typeof api.private.settings.update>

export type SettingsOutput = NonNullable<FunctionReturnType<typeof api.private.settings.get>>

export type Phase1Settings = SettingsOutput['phase1']
export type Phase2Settings = SettingsOutput['phase2']
export type ChannelMappingSettings = SettingsOutput['channelMapping']
export type LocalizationSettings = SettingsOutput['localization']
export type PowerDetectionSettings = NonNullable<SettingsOutput['powerDetection']>
