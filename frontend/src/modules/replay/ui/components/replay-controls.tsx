import { PauseIcon, PlayIcon, RotateCcwIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Slider } from '@/components/ui/slider'
import { REPLAY_SPEEDS } from '../../constants'

interface ReplayControlsProps {
    startMs: number
    endMs: number
    currentMs: number
    playing: boolean
    speed: number
    onTogglePlay: () => void
    onSeek: (ms: number) => void
    onSetSpeed: (s: number) => void
    visibleCount: number
    totalCount: number
}

const formatTime = (ms: number) =>
    new Date(ms).toLocaleString(undefined, {
        dateStyle: 'short',
        timeStyle: 'medium',
    })

export const ReplayControls = ({
    startMs,
    endMs,
    currentMs,
    playing,
    speed,
    onTogglePlay,
    onSeek,
    onSetSpeed,
    visibleCount,
    totalCount,
}: ReplayControlsProps): React.JSX.Element => {
    const progress = endMs > startMs ? ((currentMs - startMs) / (endMs - startMs)) * 100 : 0

    return (
        <div className="pointer-events-auto w-full bg-popover/95 backdrop-blur border rounded-md shadow-lg p-3 space-y-2">
            <div className="flex items-center gap-2">
                <Button size="icon" variant="secondary" onClick={onTogglePlay} className="shrink-0">
                    {playing ? <PauseIcon className="size-4" /> : <PlayIcon className="size-4" />}
                </Button>
                <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => onSeek(startMs)}
                    className="shrink-0"
                >
                    <RotateCcwIcon className="size-4" />
                </Button>

                <div className="flex-1 flex items-center gap-3 min-w-0">
                    <span className="font-mono text-xs text-muted-foreground shrink-0">
                        {formatTime(currentMs)}
                    </span>
                    <Slider
                        value={[progress]}
                        min={0}
                        max={100}
                        step={0.1}
                        onValueChange={(v) => {
                            const pct = v[0] / 100
                            onSeek(startMs + pct * (endMs - startMs))
                        }}
                        className="flex-1"
                    />
                </div>

                <div className="flex items-center gap-1 shrink-0">
                    {REPLAY_SPEEDS.map((s) => (
                        <Button
                            key={s}
                            size="sm"
                            variant={speed === s ? 'default' : 'ghost'}
                            onClick={() => onSetSpeed(s)}
                            className="h-7 px-2 text-xs font-mono"
                        >
                            {s}x
                        </Button>
                    ))}
                </div>
            </div>

            <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>
                    {formatTime(startMs)} → {formatTime(endMs)}
                </span>
                <span>
                    {visibleCount} visible · {totalCount} total in range
                </span>
            </div>
        </div>
    )
}
