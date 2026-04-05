import { useEffect, useRef, useState, useCallback } from 'react'
import { useQuery, useMutation } from 'convex/react'
import { api } from '@backend/api'
import type { Id } from '@backend/dataModel'
import HackrfModule from '~/native'
import type { ScanSettings } from '~/native'

type HackrfStatus = 'idle' | 'waiting' | 'scanning' | 'submitting' | 'done' | 'error'

export function useHackrf() {
    const [status, setStatus] = useState<HackrfStatus>('idle')
    const [error, setError] = useState<string | null>(null)
    const [lastJobId, setLastJobId] = useState<string | null>(null)

    const processedJobRef = useRef<string | null>(null)
    const busyRef = useRef(false)

    const controller = useQuery(api.public.controller.getController)
    const latestJob = useQuery(api.public.controller.getLatestJob)
    const submitMeasurements = useMutation(api.public.controller.submitMeasurements)

    const runScan = useCallback(
        async (
            batchId: Id<'jobBatch'>,
            settings: ScanSettings,
            cancelled: { current: boolean },
        ) => {
            try {
                setStatus('scanning')
                setError(null)

                const measurements = await HackrfModule.runFullScan(settings)
                if (cancelled.current) return

                if (measurements.length === 0) {
                    setError('Scan produced no measurements')
                    setStatus('error')
                    return
                }

                setStatus('submitting')

                await submitMeasurements({
                    jobBatchId: batchId,
                    measurements: measurements.map((m) => ({
                        frequencyHz: m.frequency,
                        powerDbm: m.powerDbm,
                    })),
                })

                if (cancelled.current) return

                setLastJobId(batchId)
                setError(null)
                setStatus('done')
            } catch (err) {
                if (!cancelled.current) {
                    const msg = err instanceof Error ? err.message : String(err)
                    setError(msg)
                    setStatus('error')
                }
            } finally {
                busyRef.current = false
            }
        },
        [submitMeasurements],
    )

    useEffect(() => {
        if (!controller || !latestJob) {
            setStatus('waiting')
            return
        }

        if (!latestJob.hasJob || !latestJob.job) {
            setStatus('idle')
            return
        }

        const { batchId, alreadySubmitted } = latestJob.job

        if (alreadySubmitted) {
            setStatus('idle')
            return
        }

        if (processedJobRef.current === batchId || busyRef.current) {
            return
        }

        processedJobRef.current = batchId
        busyRef.current = true

        const cancelled = { current: false }

        const settings: ScanSettings = {
            minFrequencyHz: controller.settings.minFreq,
            maxFrequencyHz: controller.settings.maxFreq,
            sampleRateHz: controller.settings.sampleRate,
            lnaGainDb: controller.settings.lnaGain,
            vgaGainDb: controller.settings.vgaGain,
            bufferSizeKb: controller.settings.bufferSize,
        }

        runScan(batchId as Id<'jobBatch'>, settings, cancelled)

        return () => {
            cancelled.current = true
        }
    }, [controller, latestJob, runScan])

    return { status, error, lastJobId }
}
