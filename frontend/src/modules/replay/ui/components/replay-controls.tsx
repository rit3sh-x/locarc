import { PauseIcon, PlayIcon, RotateCcwIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Slider } from '@/components/ui/slider'
import { REPLAY_FRAME_DURATIONS_MS } from '../../constants'

interface ReplayControlsProps {
    frameCount: number
    frameIdx: number
    frameTimestampMs: number | null
    frameLocationCount: number
    playing: boolean
    frameMs: number
    onTogglePlay: () => void
    onSeek: (idx: number) => void
    onSetFrameMs: (ms: number) => void
}

const formatTime = (ms: number | null) =>
    ms == null
        ? '—'
        : new Date(ms).toLocaleString(undefined, {
              dateStyle: 'short',
              timeStyle: 'medium',
          })

export const ReplayControls = ({
    frameCount,
    frameIdx,
    frameTimestampMs,
    frameLocationCount,
    playing,
    frameMs,
    onTogglePlay,
    onSeek,
    onSetFrameMs,
}: ReplayControlsProps): React.JSX.Element => {
    const disabled = frameCount === 0

    return (
        <div className="pointer-events-auto w-full bg-popover/95 backdrop-blur border rounded-md shadow-lg p-3 space-y-2">
            <div className="flex items-center gap-2">
                <Button
                    size="icon"
                    variant="secondary"
                    onClick={onTogglePlay}
                    className="shrink-0"
                    disabled={disabled}
                >
                    {playing ? <PauseIcon className="size-4" /> : <PlayIcon className="size-4" />}
                </Button>
                <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => onSeek(0)}
                    className="shrink-0"
                    disabled={disabled}
                >
                    <RotateCcwIcon className="size-4" />
                </Button>

                <div className="flex-1 flex items-center gap-3 min-w-0">
                    <span className="font-mono text-xs text-muted-foreground shrink-0">
                        {formatTime(frameTimestampMs)}
                    </span>
                    <Slider
                        value={[frameIdx]}
                        min={0}
                        max={Math.max(0, frameCount - 1)}
                        step={1}
                        onValueChange={(v) => onSeek(v[0])}
                        className="flex-1"
                        disabled={disabled}
                    />
                </div>

                <div className="flex items-center gap-1 shrink-0">
                    {REPLAY_FRAME_DURATIONS_MS.map((ms) => (
                        <Button
                            key={ms}
                            size="sm"
                            variant={frameMs === ms ? 'default' : 'ghost'}
                            onClick={() => onSetFrameMs(ms)}
                            className="h-7 px-2 text-xs font-mono"
                        >
                            {ms < 1000 ? `${ms}ms` : `${ms / 1000}s`}
                        </Button>
                    ))}
                </div>
            </div>

            <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>
                    Frame {frameCount === 0 ? 0 : frameIdx + 1} / {frameCount}
                </span>
                <span>{frameLocationCount} locations in frame</span>
            </div>
        </div>
    )
}
