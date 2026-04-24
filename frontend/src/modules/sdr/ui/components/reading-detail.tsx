import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog'
import { Badge } from '@/components/ui/badge'
import type { SdrReading } from '../../types'

interface ReadingDetailProps {
    reading: SdrReading | null
    open: boolean
    onOpenChange: (open: boolean) => void
}

const MAX_ROWS = 200

const formatDate = (ms: number) =>
    new Date(ms).toLocaleString(undefined, {
        dateStyle: 'medium',
        timeStyle: 'medium',
    })

export const ReadingDetail = ({
    reading,
    open,
    onOpenChange,
}: ReadingDetailProps): React.JSX.Element => {
    if (!reading) {
        return (
            <Dialog open={open} onOpenChange={onOpenChange}>
                <DialogContent />
            </Dialog>
        )
    }

    const topSamples = [...reading.samples]
        .sort((a, b) => b.powerDbm - a.powerDbm)
        .slice(0, MAX_ROWS)

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-2xl max-h-[80vh] overflow-hidden flex flex-col">
                <DialogHeader>
                    <DialogTitle>{reading.controllerName}</DialogTitle>
                    <DialogDescription>
                        {formatDate(reading.createdAt)} · scan {reading.scanId}
                    </DialogDescription>
                </DialogHeader>

                <div className="flex flex-wrap gap-2">
                    <Badge variant="secondary">{reading.sampleCount} samples</Badge>
                    {reading.peakDbm != null && (
                        <Badge variant="secondary">Peak {reading.peakDbm.toFixed(1)} dBm</Badge>
                    )}
                    {reading.minFrequencyHz != null && reading.maxFrequencyHz != null && (
                        <Badge variant="secondary">
                            {(reading.minFrequencyHz / 1e6).toFixed(3)}–
                            {(reading.maxFrequencyHz / 1e6).toFixed(3)} MHz
                        </Badge>
                    )}
                </div>

                <div className="flex-1 overflow-auto border rounded-md">
                    <table className="w-full text-xs font-mono">
                        <thead className="sticky top-0 bg-muted">
                            <tr>
                                <th className="text-left px-3 py-2">#</th>
                                <th className="text-left px-3 py-2">Frequency (MHz)</th>
                                <th className="text-left px-3 py-2">Power (dBm)</th>
                            </tr>
                        </thead>
                        <tbody>
                            {topSamples.map((s, i) => (
                                <tr key={i} className="border-t hover:bg-muted/50">
                                    <td className="px-3 py-1.5 text-muted-foreground">{i + 1}</td>
                                    <td className="px-3 py-1.5">
                                        {(s.frequencyHz / 1e6).toFixed(4)}
                                    </td>
                                    <td className="px-3 py-1.5">{s.powerDbm.toFixed(2)}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>

                {reading.sampleCount > MAX_ROWS && (
                    <div className="text-xs text-muted-foreground">
                        Showing top {MAX_ROWS} of {reading.sampleCount} samples by power.
                    </div>
                )}
            </DialogContent>
        </Dialog>
    )
}
