import { Loader2Icon } from 'lucide-react'
import { Suspense, lazy, useMemo, useState } from 'react'
import { set } from 'date-fns'
import { MapCursorProvider, useMapCursor } from '@/modules/map/context/map'
import { DateRangePicker } from '../components/date-range-picker'
import { TimeRangePicker } from '../components/time-range-picker'
import { ReplayControls } from '../components/replay-controls'
import { useReplayData, usePlayback } from '../../hooks/use-replay'
import type { DateRange } from '../../types'

const ReplayMap = lazy(() =>
    import('../components/replay-map').then((m) => ({ default: m.ReplayMap })),
)

const ReplayMapCursorPosition = (): React.JSX.Element => {
    const { pos } = useMapCursor()
    if (!pos) return <></>
    return (
        <div className="pointer-events-none absolute bottom-2 left-2 z-60 rounded-md border bg-popover px-2 py-1 text-xs shadow">
            Lat: {pos.latitude.toFixed(6)}, Lng: {pos.longitude.toFixed(6)}
        </div>
    )
}

const combine = (d: Date, hour: number, minute: number): number =>
    set(d, { hours: hour, minutes: minute, seconds: 0, milliseconds: 0 }).getTime()

export const ReplayView = (): React.JSX.Element => {
    const [range, setRange] = useState<DateRange>({
        from: undefined,
        to: undefined,
    })
    const [startHour, setStartHour] = useState(0)
    const [startMinute, setStartMinute] = useState(0)
    const [endHour, setEndHour] = useState(23)
    const [endMinute, setEndMinute] = useState(59)

    const { startMs, endMs } = useMemo(() => {
        if (!range.from) return { startMs: null, endMs: null }
        const toDate = range.to ?? range.from
        const s = combine(range.from, startHour, startMinute)
        const e = combine(toDate, endHour, endMinute)
        if (e < s) return { startMs: null, endMs: null }
        return { startMs: s, endMs: e }
    }, [range.from, range.to, startHour, startMinute, endHour, endMinute])

    const { data, isLoading } = useReplayData({ startMs, endMs })
    const frames = data?.frames ?? []
    const controllers = data?.controllers ?? []

    const { frameIdx, playing, frameMs, setFrameMs, seekTo, togglePlay } = usePlayback({
        frameCount: frames.length,
    })

    const hasCurrentFrame = frameIdx >= 0 && frameIdx < frames.length
    const currentFrame = hasCurrentFrame ? frames[frameIdx] : null
    const currentLocations = currentFrame ? currentFrame.locations : []
    const currentTimestamp = currentFrame ? currentFrame.timestampMs : null
    const rangeReady = startMs != null

    return (
        <MapCursorProvider>
            <div className="relative h-[calc(100vh-4rem)] w-full overflow-hidden">
                <div className="z-10 relative w-full h-full">
                    <Suspense fallback={<ReplayMapSkeleton />}>
                        <ReplayMap locations={currentLocations} controllers={controllers} />
                    </Suspense>
                </div>

                <div className="pointer-events-none w-full h-full p-2 absolute top-0 left-0 z-50 flex flex-col justify-between items-center gap-2">
                    <div className="pointer-events-auto flex flex-wrap items-center gap-2 bg-popover/95 backdrop-blur border rounded-md shadow-lg p-2">
                        <DateRangePicker range={range} onChange={setRange} />
                        <TimeRangePicker
                            startHour={startHour}
                            startMinute={startMinute}
                            endHour={endHour}
                            endMinute={endMinute}
                            onChange={(v) => {
                                setStartHour(v.startHour)
                                setStartMinute(v.startMinute)
                                setEndHour(v.endHour)
                                setEndMinute(v.endMinute)
                            }}
                        />
                    </div>

                    <div className="w-full max-w-4xl">
                        {rangeReady ? (
                            isLoading ? (
                                <div className="pointer-events-auto bg-popover/95 backdrop-blur border rounded-md shadow-lg px-3 py-2 text-xs flex items-center gap-2">
                                    <Loader2Icon className="size-4 animate-spin" />
                                    Loading batches…
                                </div>
                            ) : frames.length === 0 ? (
                                <div className="pointer-events-auto bg-popover/95 backdrop-blur border rounded-md shadow-lg px-3 py-2 text-xs text-muted-foreground">
                                    No batches in this range.
                                </div>
                            ) : (
                                <ReplayControls
                                    frameCount={frames.length}
                                    frameIdx={frameIdx}
                                    frameTimestampMs={currentTimestamp}
                                    frameLocationCount={currentLocations.length}
                                    playing={playing}
                                    frameMs={frameMs}
                                    onTogglePlay={togglePlay}
                                    onSeek={seekTo}
                                    onSetFrameMs={setFrameMs}
                                />
                            )
                        ) : (
                            <div className="pointer-events-auto bg-popover/95 backdrop-blur border rounded-md shadow-lg px-3 py-2 text-xs text-muted-foreground">
                                Pick a date range to replay.
                            </div>
                        )}
                    </div>

                    <div className="w-full">
                        <ReplayMapCursorPosition />
                    </div>
                </div>
            </div>
        </MapCursorProvider>
    )
}

const ReplayMapSkeleton = (): React.JSX.Element => (
    <div className="w-full h-full flex items-center justify-center">
        <Loader2Icon className="text-muted-foreground animate-spin" />
    </div>
)
