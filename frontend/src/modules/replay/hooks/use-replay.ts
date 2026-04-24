import { api } from '@backend/api'
import { useQuery } from 'convex-helpers/react/cache'
import { useEffect, useRef, useState } from 'react'
import { REPLAY_DEFAULT_FRAME_MS } from '../constants'
import type { ReplayResult } from '../types'

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
    frameCount: number
}

export const usePlayback = ({ frameCount }: UsePlaybackArgs) => {
    const [frameIdx, setFrameIdx] = useState(0)
    const [playing, setPlaying] = useState(false)
    const [frameMs, setFrameMs] = useState<number>(REPLAY_DEFAULT_FRAME_MS)
    const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

    useEffect(() => {
        setFrameIdx(0)
        setPlaying(false)
    }, [frameCount])

    useEffect(() => {
        if (!playing || frameCount === 0) {
            if (intervalRef.current) clearInterval(intervalRef.current)
            intervalRef.current = null
            return
        }

        intervalRef.current = setInterval(() => {
            setFrameIdx((prev) => {
                const next = prev + 1
                if (next >= frameCount) {
                    setPlaying(false)
                    return frameCount - 1
                }
                return next
            })
        }, frameMs)

        return () => {
            if (intervalRef.current) clearInterval(intervalRef.current)
            intervalRef.current = null
        }
    }, [playing, frameMs, frameCount])

    const seekTo = (idx: number) => {
        if (frameCount === 0) return
        const clamped = Math.max(0, Math.min(frameCount - 1, idx))
        setFrameIdx(clamped)
    }

    const togglePlay = () => {
        if (frameCount === 0) return
        if (!playing && frameIdx >= frameCount - 1) setFrameIdx(0)
        setPlaying((p) => !p)
    }

    return {
        frameIdx,
        playing,
        frameMs,
        setFrameMs,
        seekTo,
        togglePlay,
    }
}
