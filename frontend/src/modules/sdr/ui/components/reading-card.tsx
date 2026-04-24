import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { ActivityIcon, RadioTowerIcon } from 'lucide-react'
import type { SdrReading } from '../../types'

interface ReadingCardProps {
    reading: SdrReading
    onView?: (reading: SdrReading) => void
}

const formatDate = (ms: number) =>
    new Date(ms).toLocaleString(undefined, {
        dateStyle: 'medium',
        timeStyle: 'medium',
    })

const formatMHz = (hz: number | null) => (hz == null ? '—' : `${(hz / 1e6).toFixed(3)} MHz`)

const formatDbm = (dbm: number | null) => (dbm == null ? '—' : `${dbm.toFixed(1)} dBm`)

export const ReadingCard = ({ reading, onView }: ReadingCardProps): React.JSX.Element => {
    return (
        <Card
            className="cursor-pointer hover:border-primary transition-colors"
            onClick={() => onView?.(reading)}
        >
            <CardContent className="p-4 space-y-3">
                <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                        <RadioTowerIcon className="size-4 shrink-0 text-muted-foreground" />
                        <span className="font-medium truncate">{reading.controllerName}</span>
                    </div>
                    <Badge variant="secondary" className="shrink-0">
                        {reading.sampleCount} samples
                    </Badge>
                </div>

                <div className="text-xs text-muted-foreground">{formatDate(reading.createdAt)}</div>

                <div className="grid grid-cols-2 gap-2 text-xs">
                    <div>
                        <div className="text-muted-foreground">Peak</div>
                        <div className="font-mono">{formatDbm(reading.peakDbm)}</div>
                    </div>
                    <div>
                        <div className="text-muted-foreground">Floor</div>
                        <div className="font-mono">{formatDbm(reading.minDbm)}</div>
                    </div>
                    <div>
                        <div className="text-muted-foreground">From</div>
                        <div className="font-mono">{formatMHz(reading.minFrequencyHz)}</div>
                    </div>
                    <div>
                        <div className="text-muted-foreground">To</div>
                        <div className="font-mono">{formatMHz(reading.maxFrequencyHz)}</div>
                    </div>
                </div>

                <div className="flex items-center gap-1.5 text-xs text-muted-foreground pt-1 border-t">
                    <ActivityIcon className="size-3" />
                    <span className="font-mono truncate">scan: {reading.scanId}</span>
                </div>
            </CardContent>
        </Card>
    )
}
