import { useState } from 'react'
import { DownloadIcon, Loader2Icon } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useSdrExport } from '../../hooks/use-sdr'
import type { Id } from '@backend/dataModel'

interface ExportButtonProps {
    controllerId: Id<'controller'> | undefined
}

const toDatetimeLocal = (ms: number): string => {
    const d = new Date(ms)
    const pad = (n: number) => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

const fromDatetimeLocal = (value: string): number | undefined => {
    if (!value) return undefined
    const ms = new Date(value).getTime()
    return Number.isFinite(ms) ? ms : undefined
}

export const ExportButton = ({ controllerId }: ExportButtonProps): React.JSX.Element => {
    const [open, setOpen] = useState(false)
    const [fromValue, setFromValue] = useState('')
    const [toValue, setToValue] = useState(toDatetimeLocal(Date.now()))
    const { exportCsv, isExporting } = useSdrExport()

    const handleDownload = async () => {
        const fromMs = fromDatetimeLocal(fromValue)
        const toMs = fromDatetimeLocal(toValue)

        if (fromMs !== undefined && toMs !== undefined && fromMs > toMs) {
            toast.error('"From" must be earlier than "To"')
            return
        }

        try {
            const result = await exportCsv({ fromMs, toMs, controllerId })
            if (result.measurementCount === 0) {
                toast.warning('No readings in selected range')
                return
            }
            const note = result.truncated ? ' (truncated to limit)' : ''
            toast.success(
                `Exported ${result.measurementCount} scans · ${result.sampleCount} samples${note}`,
            )
            setOpen(false)
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e)
            toast.error(`Export failed: ${msg}`)
        }
    }

    const handleReset = () => {
        setFromValue('')
        setToValue(toDatetimeLocal(Date.now()))
    }

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
                <Button variant="outline" size="sm" className="gap-2">
                    <DownloadIcon className="size-4" />
                    Download CSV
                </Button>
            </DialogTrigger>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Export SDR readings</DialogTitle>
                    <DialogDescription>
                        Download a CSV of raw power samples for the selected range.
                        {controllerId
                            ? ' Filtered to the currently selected controller.'
                            : ' Includes all controllers.'}
                    </DialogDescription>
                </DialogHeader>

                <div className="grid gap-4 py-2">
                    <div className="grid gap-2">
                        <Label htmlFor="export-from">From</Label>
                        <Input
                            id="export-from"
                            type="datetime-local"
                            value={fromValue}
                            onChange={(e) => setFromValue(e.target.value)}
                            placeholder="(beginning)"
                        />
                        <p className="text-xs text-muted-foreground">
                            Leave empty to start from the earliest record.
                        </p>
                    </div>
                    <div className="grid gap-2">
                        <Label htmlFor="export-to">To</Label>
                        <Input
                            id="export-to"
                            type="datetime-local"
                            value={toValue}
                            onChange={(e) => setToValue(e.target.value)}
                        />
                        <p className="text-xs text-muted-foreground">Defaults to now.</p>
                    </div>
                </div>

                <DialogFooter>
                    <Button variant="ghost" onClick={handleReset} disabled={isExporting}>
                        Reset
                    </Button>
                    <Button onClick={handleDownload} disabled={isExporting} className="gap-2">
                        {isExporting ? (
                            <Loader2Icon className="size-4 animate-spin" />
                        ) : (
                            <DownloadIcon className="size-4" />
                        )}
                        {isExporting ? 'Exporting…' : 'Download'}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
