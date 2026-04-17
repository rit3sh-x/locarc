import { useEffect, useRef, useState, useCallback } from 'react'
import { useQuery, useMutation } from 'convex/react'
import { api } from '@backend/api'
import type { Id } from '@backend/dataModel'
import HackrfModule from '~/native'
import type { ScanSettings, AlgoSettings } from '~/native'
import type { HackrfStatus } from '../types'

export function useHackrf() {
    const [status, setStatus] = useState<HackrfStatus>('idle')
    const [error, setError] = useState<string | null>(null)
    const [lastJobId, setLastJobId] = useState<string | null>(null)
    const [hackrfConnected, setHackrfConnected] = useState(false)

    const processedJobRef = useRef<string | null>(null)
    const busyRef = useRef(false)

    const controller = useQuery(api.public.controller.getController)
    const latestJob = useQuery(api.public.controller.getLatestJob)
    const submitMeasurements = useMutation(api.public.controller.submitMeasurements)

    useEffect(() => {
        let mounted = true

        HackrfModule.isConnected()
            .then((c) => {
                if (mounted) setHackrfConnected(c)
            })
            .catch(() => {
                if (mounted) setHackrfConnected(false)
            })

        const attachSub = HackrfModule.addListener('onHackrfAttached', () => {
            setHackrfConnected(true)
        })
        const detachSub = HackrfModule.addListener('onHackrfDetached', () => {
            setHackrfConnected(false)
        })

        return () => {
            mounted = false
            attachSub.remove()
            detachSub.remove()
        }
    }, [])

    const runScan = useCallback(
        async (
            batchId: Id<'jobBatch'>,
            settings: ScanSettings,
            algoSettings: AlgoSettings,
            cancelled: { current: boolean },
        ) => {
            const startedAt = Date.now()
            console.log(`[useHackrf] scan START ${batchId}`)
            try {
                setStatus('scanning')
                setError(null)

                const measurements = await HackrfModule.runFullScan(settings, algoSettings)
                console.log(
                    `[useHackrf] scan RX: ${measurements.length} measurements in ${Date.now() - startedAt} ms`,
                )

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
                const msg = err instanceof Error ? err.message : String(err)
                console.error(`[useHackrf] scan FAILED ${batchId}:`, msg)
                if (!cancelled.current) {
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

        if (processedJobRef.current === batchId || busyRef.current) return

        if (!controller.algoSettings) {
            console.warn('[useHackrf] controller has no algoSettings — skipping job')
            return
        }

        processedJobRef.current = batchId
        busyRef.current = true

        const cancelled = { current: false }

        const settings: ScanSettings = {
            minFrequencyHz: controller.rfSettings.minFreq,
            maxFrequencyHz: controller.rfSettings.maxFreq,
            sampleRateHz: controller.rfSettings.sampleRate,
            lnaGainDb: controller.rfSettings.lnaGain,
            vgaGainDb: controller.rfSettings.vgaGain,
            bufferSizeKb: controller.rfSettings.bufferSize,
        }

        runScan(batchId as Id<'jobBatch'>, settings, controller.algoSettings, cancelled)

        return () => {
            cancelled.current = true
        }
    }, [controller, latestJob, runScan])

    return { status, error, lastJobId, controller, hackrfConnected }
}
