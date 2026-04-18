import { Suspense } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'

import { useSettings, useUpdateSettings, useResetSettings } from '../../hooks/use-settings'
import { SettingsForm } from '../components/settings-form'

function SettingsFormSkeleton() {
    return (
        <div className="space-y-4">
            {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="flex items-center justify-between py-4 border-b">
                    <div className="space-y-2">
                        <Skeleton className="h-4 w-32" />
                        <Skeleton className="h-3 w-56" />
                    </div>
                    <Skeleton className="h-4 w-4" />
                </div>
            ))}
        </div>
    )
}

function SettingsContent() {
    const { settings } = useSettings()
    const { updateSettings, isPending } = useUpdateSettings()
    const { resetSettings, isPending: isResetPending } = useResetSettings()

    if (!settings) return <SettingsFormSkeleton />

    return (
        <SettingsForm
            initialValues={{
                phase1: settings.phase1,
                phase2: settings.phase2,
                powerDetection: settings.powerDetection,
                channelMapping: settings.channelMapping,
                localization: settings.localization,
            }}
            onSubmit={updateSettings}
            onReset={() => resetSettings({})}
            isPending={isPending}
            isResetPending={isResetPending}
        />
    )
}

export const SettingsView = () => (
    <div className="flex flex-col w-full h-full max-w-3xl gap-4 py-4 md:gap-6 md:py-6 px-4 lg:px-6 overflow-y-auto">
        <div className="space-y-1">
            <h2 className="text-lg font-semibold tracking-tight">Algorithm Settings</h2>
            <p className="text-sm text-muted-foreground">
                Configure signal detection, power measurement, and localization parameters
            </p>
        </div>

        <Card>
            <CardContent className="pt-2">
                <Suspense fallback={<SettingsFormSkeleton />}>
                    <SettingsContent />
                </Suspense>
            </CardContent>
        </Card>
    </div>
)
