import { api } from '@backend/api'
import { useQuery } from 'convex-helpers/react/cache'
import { useEffect, useMemo, useRef, useState } from 'react'
import { REPLAY_DEFAULT_SPEED, REPLAY_TICK_MS, REPLAY_TRAIL_MS } from '../constants'
import type { ReplayLocation, ReplayResult } from '../types'

interface UseReplayArgs {
    startMs: number | null
    endMs: number | null
}

export const useReplayData = ({ startMs, endMs }: UseReplayArgs) => {
    const args = startMs != null && endMs != null ? { startMs, endMs } : 'skip'
    const data = useQuery(api.private.localization.replay, args)

    return {
        data,
        isLoading: startMs != null && endMs != null && data === undefined,
    }
}

interface UsePlaybackArgs {
    startMs: number | null
    endMs: number | null
    locations: ReplayLocation[]
}

export const usePlayback = ({ startMs, endMs, locations }: UsePlaybackArgs) => {
    const [currentMs, setCurrentMs] = useState<number>(startMs ?? 0)
    const [playing, setPlaying] = useState(false)
    const [speed, setSpeed] = useState<number>(REPLAY_DEFAULT_SPEED)
    const rafRef = useRef<number | null>(null)
    const lastTsRef = useRef<number | null>(null)

    useEffect(() => {
        if (startMs != null) setCurrentMs(startMs)
        setPlaying(false)
        lastTsRef.current = null
    }, [startMs, endMs])

    useEffect(() => {
        if (!playing || startMs == null || endMs == null) {
            if (rafRef.current) cancelAnimationFrame(rafRef.current)
            rafRef.current = null
            lastTsRef.current = null
            return
        }

        const tick = (ts: number) => {
            if (lastTsRef.current == null) lastTsRef.current = ts
            const dt = ts - lastTsRef.current
            if (dt >= REPLAY_TICK_MS) {
                lastTsRef.current = ts
                setCurrentMs((prev) => {
                    const next = prev + dt * speed
                    if (next >= endMs) {
                        setPlaying(false)
                        return endMs
                    }
                    return next
                })
            }
            rafRef.current = requestAnimationFrame(tick)
        }
        rafRef.current = requestAnimationFrame(tick)

        return () => {
            if (rafRef.current) cancelAnimationFrame(rafRef.current)
            rafRef.current = null
            lastTsRef.current = null
        }
    }, [playing, speed, startMs, endMs])

    const visibleLocations = useMemo(() => {
        const trailStart = currentMs - REPLAY_TRAIL_MS
        return locations.filter((l) => l.createdAt >= trailStart && l.createdAt <= currentMs)
    }, [locations, currentMs])

    const seekTo = (ms: number) => {
        if (startMs == null || endMs == null) return
        const clamped = Math.max(startMs, Math.min(endMs, ms))
        setCurrentMs(clamped)
        lastTsRef.current = null
    }

    const togglePlay = () => {
        if (startMs == null || endMs == null) return
        if (!playing && currentMs >= endMs) setCurrentMs(startMs)
        setPlaying((p) => !p)
    }

    return {
        currentMs,
        playing,
        speed,
        setSpeed,
        seekTo,
        togglePlay,
        visibleLocations,
    }
}
