import { useControllerInfo } from '../../hooks/use-user'
import { Skeleton } from '@/components/ui/skeleton'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { Label } from '@/components/ui/label'

export const ControllerInfo = (): React.JSX.Element => {
    const { controller, isLoading } = useControllerInfo()

    if (isLoading || controller === undefined) {
        return <ControllerInfoSkeleton />
    }

    return (
        <Card className="w-full">
            <CardHeader>
                <div className="flex items-center justify-between">
                    <div>
                        <CardTitle>{controller.name}</CardTitle>
                        <CardDescription>
                            {controller.serialNumber || 'No serial number'}
                        </CardDescription>
                    </div>
                    <Badge variant={controller.started ? 'default' : 'secondary'}>
                        {controller.started ? 'Running' : 'Stopped'}
                    </Badge>
                </div>
            </CardHeader>

            <CardContent className="space-y-6">
                <div className="space-y-3">
                    <h3 className="text-sm font-medium">Location</h3>
                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-1">
                            <Label className="text-muted-foreground text-xs">Latitude</Label>
                            <p className="text-sm font-medium">{controller.latitude.toFixed(6)}°</p>
                        </div>
                        <div className="space-y-1">
                            <Label className="text-muted-foreground text-xs">Longitude</Label>
                            <p className="text-sm font-medium">
                                {controller.longitude.toFixed(6)}°
                            </p>
                        </div>
                    </div>
                </div>

                <Separator />

                <div className="space-y-3">
                    <h3 className="text-sm font-medium">Settings</h3>
                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-1">
                            <Label className="text-muted-foreground text-xs">VGA Gain</Label>
                            <p className="text-sm font-medium">
                                {controller.rfSettings.vgaGainDb} dB
                            </p>
                        </div>
                        <div className="space-y-1">
                            <Label className="text-muted-foreground text-xs">LNA Gain</Label>
                            <p className="text-sm font-medium">
                                {controller.rfSettings.lnaGainDb} dB
                            </p>
                        </div>
                        <div className="space-y-1">
                            <Label className="text-muted-foreground text-xs">Buffer Size</Label>
                            <p className="text-sm font-medium">
                                {controller.rfSettings.bufferSizeKb.toLocaleString()} KB
                            </p>
                        </div>
                    </div>
                </div>
            </CardContent>
        </Card>
    )
}

export const ControllerInfoSkeleton = (): React.JSX.Element => {
    return (
        <Card className="w-full">
            <CardHeader>
                <div className="flex items-center justify-between">
                    <div className="space-y-2 flex-1">
                        <Skeleton className="h-6 w-48" />
                        <Skeleton className="h-4 w-32" />
                    </div>
                    <Skeleton className="h-6 w-20" />
                </div>
            </CardHeader>

            <CardContent className="space-y-6">
                <div className="space-y-3">
                    <Skeleton className="h-4 w-20" />
                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <Skeleton className="h-3 w-16" />
                            <Skeleton className="h-4 w-24" />
                        </div>
                        <div className="space-y-2">
                            <Skeleton className="h-3 w-16" />
                            <Skeleton className="h-4 w-24" />
                        </div>
                    </div>
                </div>

                <Separator />

                <div className="space-y-3">
                    <Skeleton className="h-4 w-20" />
                    <div className="grid grid-cols-2 gap-4">
                        {[...Array(6)].map((_, i) => (
                            <div key={i} className="space-y-2">
                                <Skeleton className="h-3 w-20" />
                                <Skeleton className="h-4 w-16" />
                            </div>
                        ))}
                    </div>
                </div>
            </CardContent>
        </Card>
    )
}
