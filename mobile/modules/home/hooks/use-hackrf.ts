import { useEffect, useRef, useState, useCallback } from 'react'
import { useQuery, useMutation } from 'convex/react'
import { api } from '@backend/api'
import type { Id } from '@backend/dataModel'
import HackrfModule from '~/native'
import type { ScanSettings, AlgoSettings } from '~/native'

type HackrfStatus = 'idle' | 'waiting' | 'scanning' | 'submitting' | 'done' | 'error'

const DEFAULT_ALGO_SETTINGS: AlgoSettings = {
    phase1: {
        sigBwHz: 200_000,
        chSpacingHz: 10_000,
        perOlf: 0,
        numSamUseRatio: 0.5,
        maxTh: 0.09,
        kaiserBeta: 36,
        highpassOrder: 1,
        highpassCutoff: 0.0001,
        noiseMinPeaks: 10,
        noiseMaxDiff: 10,
    },
    phase2: {
        requiredFs1Hz: 200_000,
        sigBwP1Hz: 10_000,
        perOlfP1: 0,
        numSamUseRatioP1: 0.5,
        maxThP1: 0.4,
        kaiserBetaP1: 60,
        lpfOrder: 2,
        lpfCutoff: 0.03,
        noiseMinPeaksP2: 5,
        noiseMaxDiffP2: 10,
    },
    phase3: {
        priorKnowledgeBwHz: 10_000,
        zoomFsPowerHz: 50_000,
        sigBwPowHz: 5_000,
        maxThPow: 0.4,
        kaiserBetaPow: 60,
        noiseMinPeaksPow: 2,
        noiseMaxDiffPow: 10,
    },
    channelMapping: {
        bandStartFreqHz: 300_000_000,
        bandEndFreqHz: 500_000_000,
        channelSpacingMapHz: 12_500,
    },
}

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
            algoSettings: AlgoSettings,
            cancelled: { current: boolean },
        ) => {
            try {
                setStatus('scanning')
                setError(null)

                const measurements = await HackrfModule.runFullScan(settings, algoSettings)
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
            minFrequencyHz: controller.rfSettings.minFreq,
            maxFrequencyHz: controller.rfSettings.maxFreq,
            sampleRateHz: controller.rfSettings.sampleRate,
            lnaGainDb: controller.rfSettings.lnaGain,
            vgaGainDb: controller.rfSettings.vgaGain,
            bufferSizeKb: controller.rfSettings.bufferSize,
        }

        const algoSettings: AlgoSettings = controller.algoSettings ?? DEFAULT_ALGO_SETTINGS

        runScan(batchId as Id<'jobBatch'>, settings, algoSettings, cancelled)

        return () => {
            cancelled.current = true
        }
    }, [controller, latestJob, runScan])

    return { status, error, lastJobId, controller }
}
