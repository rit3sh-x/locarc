import { useForm } from '@tanstack/react-form'
import { RotateCcwIcon, SaveIcon } from 'lucide-react'

import { Accordion } from '@/components/ui/accordion'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select'
import { Field, FieldLabel, FieldError, FieldDescription } from '@/components/ui/field'
import { Separator } from '@/components/ui/separator'

import { SettingsSection } from './settings-section'
import type {
    ChannelMappingSettings,
    LocalizationSettings,
    Phase1Settings,
    Phase2Settings,
    PowerDetectionSettings,
    UpdateSettingsInput,
} from '../../types'

interface NumericFieldProps {
    state: {
        value: number
        meta: {
            isTouched: boolean
            isValid: boolean
            errors: Array<{ message?: string } | undefined>
        }
    }
    handleBlur: () => void
    handleChange: (value: number) => void
}

interface SettingsFormProps {
    initialValues: {
        phase1: Phase1Settings
        phase2: Phase2Settings
        powerDetection?: PowerDetectionSettings
        channelMapping: ChannelMappingSettings
        localization: LocalizationSettings
    }
    onSubmit: (values: UpdateSettingsInput) => Promise<void>
    onReset: () => Promise<void>
    isPending: boolean
    isResetPending: boolean
}

function NumericField({
    field,
    label,
    unit,
    description,
}: {
    field: NumericFieldProps
    label: string
    unit?: string
    description?: string
}) {
    const isInvalid = field.state.meta.isTouched && !field.state.meta.isValid
    return (
        <Field data-invalid={isInvalid}>
            <FieldLabel className="text-xs font-medium text-muted-foreground">{label}</FieldLabel>
            <div className="relative">
                <Input
                    type="number"
                    step="any"
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(e) => field.handleChange(Number(e.target.value))}
                    className={unit ? 'pr-14' : ''}
                />
                {unit && (
                    <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[10px] font-medium tracking-wider text-muted-foreground/70 uppercase">
                        {unit}
                    </span>
                )}
            </div>
            {description && (
                <FieldDescription className="text-[11px]">{description}</FieldDescription>
            )}
            {isInvalid && <FieldError errors={field.state.meta.errors} />}
        </Field>
    )
}

const POWER_DETECTION_DEFAULTS: PowerDetectionSettings = {
    priorKnowledgeBwHz: 10_000,
    zoomFsPowerHz: 50_000,
    sigBwPowHz: 5_000,
    maxThPow: 0.4,
    kaiserBetaPow: 60,
    noiseMinPeaksPow: 15,
    noiseMaxDiffPow: 10,
}

export const SettingsForm = ({
    initialValues,
    onSubmit,
    onReset,
    isPending,
    isResetPending,
}: SettingsFormProps) => {
    const pd = initialValues.powerDetection ?? POWER_DETECTION_DEFAULTS
    const form = useForm({
        defaultValues: {
            'phase1.sigBwHz': initialValues.phase1.sigBwHz ?? 200_000,
            'phase1.perOlf': initialValues.phase1.perOlf ?? 0,
            'phase1.numSamUseRatio': initialValues.phase1.numSamUseRatio ?? 0.5,
            'phase1.maxTh': initialValues.phase1.maxTh ?? 0.09,
            'phase1.kaiserBeta': initialValues.phase1.kaiserBeta ?? 36,
            'phase1.highpassOrder': initialValues.phase1.highpassOrder ?? 1,
            'phase1.highpassCutoff': initialValues.phase1.highpassCutoff ?? 0.0001,
            'phase1.noiseMinPeaks': initialValues.phase1.noiseMinPeaks ?? 10,
            'phase1.noiseMaxDiff': initialValues.phase1.noiseMaxDiff ?? 10,
            'phase2.requiredFs1Hz': initialValues.phase2.requiredFs1Hz ?? 200_000,
            'phase2.chSpacingHz': initialValues.phase2.chSpacingHz ?? 10_000,
            'phase2.perOlfP1': initialValues.phase2.perOlfP1 ?? 0,
            'phase2.numSamUseRatioP1': initialValues.phase2.numSamUseRatioP1 ?? 0.5,
            'phase2.maxThP1': initialValues.phase2.maxThP1 ?? 0.4,
            'phase2.kaiserBetaP1': initialValues.phase2.kaiserBetaP1 ?? 60,
            'phase2.lpfOrder': initialValues.phase2.lpfOrder ?? 2,
            'phase2.lpfCutoff': initialValues.phase2.lpfCutoff ?? 0.03,
            'phase2.noiseMinPeaksP2': initialValues.phase2.noiseMinPeaksP2 ?? 25,
            'phase2.noiseMaxDiffP2': initialValues.phase2.noiseMaxDiffP2 ?? 10,
            'phase2.dcGuardHz': initialValues.phase2.dcGuardHz ?? 12_500,
            'powerDetection.enabled': initialValues.powerDetection !== undefined,
            'powerDetection.priorKnowledgeBwHz': pd.priorKnowledgeBwHz ?? 10_000,
            'powerDetection.zoomFsPowerHz': pd.zoomFsPowerHz ?? 50_000,
            'powerDetection.sigBwPowHz': pd.sigBwPowHz ?? 5_000,
            'powerDetection.maxThPow': pd.maxThPow ?? 0.4,
            'powerDetection.kaiserBetaPow': pd.kaiserBetaPow ?? 60,
            'powerDetection.noiseMinPeaksPow': pd.noiseMinPeaksPow ?? 15,
            'powerDetection.noiseMaxDiffPow': pd.noiseMaxDiffPow ?? 10,
            'channelMapping.bandStartFreqHz':
                initialValues.channelMapping.bandStartFreqHz ?? 300_000_000,
            'channelMapping.bandEndFreqHz':
                initialValues.channelMapping.bandEndFreqHz ?? 500_000_000,
            'channelMapping.channelSpacingMapHz':
                initialValues.channelMapping.channelSpacingMapHz ?? 12_500,
            'channelMapping.powerCalOffsetDb':
                initialValues.channelMapping.powerCalOffsetDb ?? -90,
            'channelMapping.sidelobeDedupHz':
                initialValues.channelMapping.sidelobeDedupHz ?? 12_500,
            'localization.algorithm': initialValues.localization.algorithm ?? 'annulus',
            'localization.pathLossExponent': initialValues.localization.pathLossExponent ?? 3.5,
            'localization.ptSearchRangeMinDbm':
                initialValues.localization.ptSearchRangeMinDbm ?? 20.0,
            'localization.ptSearchRangeMaxDbm':
                initialValues.localization.ptSearchRangeMaxDbm ?? 43.0,
            'localization.ptSearchStepDbm': initialValues.localization.ptSearchStepDbm ?? 0.5,
            'localization.powerErrorRangeDb': initialValues.localization.powerErrorRangeDb ?? 3.0,
            'localization.channelBinHz': initialValues.localization.channelBinHz ?? 12_500,
            'localization.minControllersPerChannel':
                initialValues.localization.minControllersPerChannel ?? 3,
            'localization.minPeakDbm': initialValues.localization.minPeakDbm ?? -110,
        },
        onSubmit: async ({ value }) => {
            const payload: UpdateSettingsInput = {
                phase1: {
                    sigBwHz: value['phase1.sigBwHz'],
                    perOlf: value['phase1.perOlf'],
                    numSamUseRatio: value['phase1.numSamUseRatio'],
                    maxTh: value['phase1.maxTh'],
                    kaiserBeta: value['phase1.kaiserBeta'],
                    highpassOrder: value['phase1.highpassOrder'],
                    highpassCutoff: value['phase1.highpassCutoff'],
                    noiseMinPeaks: value['phase1.noiseMinPeaks'],
                    noiseMaxDiff: value['phase1.noiseMaxDiff'],
                },
                phase2: {
                    requiredFs1Hz: value['phase2.requiredFs1Hz'],
                    chSpacingHz: value['phase2.chSpacingHz'],
                    perOlfP1: value['phase2.perOlfP1'],
                    numSamUseRatioP1: value['phase2.numSamUseRatioP1'],
                    maxThP1: value['phase2.maxThP1'],
                    kaiserBetaP1: value['phase2.kaiserBetaP1'],
                    lpfOrder: value['phase2.lpfOrder'],
                    lpfCutoff: value['phase2.lpfCutoff'],
                    noiseMinPeaksP2: value['phase2.noiseMinPeaksP2'],
                    noiseMaxDiffP2: value['phase2.noiseMaxDiffP2'],
                    dcGuardHz: value['phase2.dcGuardHz'],
                },
                channelMapping: {
                    bandStartFreqHz: value['channelMapping.bandStartFreqHz'],
                    bandEndFreqHz: value['channelMapping.bandEndFreqHz'],
                    channelSpacingMapHz: value['channelMapping.channelSpacingMapHz'],
                    powerCalOffsetDb: value['channelMapping.powerCalOffsetDb'],
                    sidelobeDedupHz: value['channelMapping.sidelobeDedupHz'],
                },
                localization: {
                    algorithm: value['localization.algorithm'],
                    pathLossExponent: value['localization.pathLossExponent'],
                    ptSearchRangeMinDbm: value['localization.ptSearchRangeMinDbm'],
                    ptSearchRangeMaxDbm: value['localization.ptSearchRangeMaxDbm'],
                    ptSearchStepDbm: value['localization.ptSearchStepDbm'],
                    powerErrorRangeDb: value['localization.powerErrorRangeDb'],
                    channelBinHz: value['localization.channelBinHz'],
                    minControllersPerChannel: value['localization.minControllersPerChannel'],
                    minPeakDbm: value['localization.minPeakDbm'],
                },
            }
            if (value['powerDetection.enabled']) {
                payload.powerDetection = {
                    priorKnowledgeBwHz: value['powerDetection.priorKnowledgeBwHz'],
                    zoomFsPowerHz: value['powerDetection.zoomFsPowerHz'],
                    sigBwPowHz: value['powerDetection.sigBwPowHz'],
                    maxThPow: value['powerDetection.maxThPow'],
                    kaiserBetaPow: value['powerDetection.kaiserBetaPow'],
                    noiseMinPeaksPow: value['powerDetection.noiseMinPeaksPow'],
                    noiseMaxDiffPow: value['powerDetection.noiseMaxDiffPow'],
                }
            }
            await onSubmit(payload)
        },
    })

    return (
        <form
            onSubmit={(e) => {
                e.preventDefault()
                form.handleSubmit()
            }}
            className="flex flex-col"
        >
            <Accordion type="multiple" defaultValue={['phase1']}>
                <SettingsSection
                    value="phase1"
                    title="Coarse Detection"
                    description="Phase 1 — Wide-band sweep to find active frequency regions"
                    fieldCount={9}
                >
                    <form.Field name="phase1.sigBwHz">
                        {(field) => (
                            <NumericField field={field} label="Signal Bandwidth" unit="Hz" />
                        )}
                    </form.Field>
                    <form.Field name="phase1.perOlf">
                        {(field) => (
                            <NumericField
                                field={field}
                                label="Overlap Factor"
                                description="0 = no overlap, 1 = full"
                            />
                        )}
                    </form.Field>
                    <form.Field name="phase1.numSamUseRatio">
                        {(field) => (
                            <NumericField
                                field={field}
                                label="Sample Use Ratio"
                                description="Fraction of frame size"
                            />
                        )}
                    </form.Field>
                    <form.Field name="phase1.maxTh">
                        {(field) => (
                            <NumericField
                                field={field}
                                label="Peak Threshold"
                                description="% of max for peak detection"
                            />
                        )}
                    </form.Field>
                    <form.Field name="phase1.kaiserBeta">
                        {(field) => <NumericField field={field} label="Kaiser Beta" />}
                    </form.Field>
                    <form.Field name="phase1.highpassOrder">
                        {(field) => <NumericField field={field} label="Highpass Order" />}
                    </form.Field>
                    <form.Field name="phase1.highpassCutoff">
                        {(field) => <NumericField field={field} label="Highpass Cutoff" />}
                    </form.Field>
                    <form.Field name="phase1.noiseMinPeaks">
                        {(field) => <NumericField field={field} label="Noise Min Peaks" />}
                    </form.Field>
                    <form.Field name="phase1.noiseMaxDiff">
                        {(field) => <NumericField field={field} label="Noise Max Diff" unit="dB" />}
                    </form.Field>
                </SettingsSection>

                <SettingsSection
                    value="phase2"
                    title="Fine Detection"
                    description="Phase 2 — Narrowband zoom for precise frequency identification"
                    fieldCount={11}
                >
                    <form.Field name="phase2.requiredFs1Hz">
                        {(field) => (
                            <NumericField field={field} label="Decimated Sample Rate" unit="Hz" />
                        )}
                    </form.Field>
                    <form.Field name="phase2.chSpacingHz">
                        {(field) => (
                            <NumericField field={field} label="Channel Spacing" unit="Hz" />
                        )}
                    </form.Field>
                    <form.Field name="phase2.perOlfP1">
                        {(field) => <NumericField field={field} label="Overlap Factor" />}
                    </form.Field>
                    <form.Field name="phase2.numSamUseRatioP1">
                        {(field) => <NumericField field={field} label="Sample Use Ratio" />}
                    </form.Field>
                    <form.Field name="phase2.maxThP1">
                        {(field) => <NumericField field={field} label="Peak Threshold" />}
                    </form.Field>
                    <form.Field name="phase2.kaiserBetaP1">
                        {(field) => <NumericField field={field} label="Kaiser Beta" />}
                    </form.Field>
                    <form.Field name="phase2.lpfOrder">
                        {(field) => <NumericField field={field} label="LPF Order" />}
                    </form.Field>
                    <form.Field name="phase2.lpfCutoff">
                        {(field) => <NumericField field={field} label="LPF Cutoff" />}
                    </form.Field>
                    <form.Field name="phase2.noiseMinPeaksP2">
                        {(field) => <NumericField field={field} label="Noise Min Peaks" />}
                    </form.Field>
                    <form.Field name="phase2.noiseMaxDiffP2">
                        {(field) => <NumericField field={field} label="Noise Max Diff" unit="dB" />}
                    </form.Field>
                    <form.Field name="phase2.dcGuardHz">
                        {(field) => (
                            <NumericField
                                field={field}
                                label="DC Guard"
                                unit="Hz"
                                description="Reject peaks within ±this distance of the LO"
                            />
                        )}
                    </form.Field>
                </SettingsSection>

                <SettingsSection
                    value="channelMapping"
                    title="Channel Mapping"
                    description="Frequency band boundaries, channel grid, and power calibration"
                    fieldCount={5}
                >
                    <form.Field name="channelMapping.bandStartFreqHz">
                        {(field) => <NumericField field={field} label="Band Start" unit="Hz" />}
                    </form.Field>
                    <form.Field name="channelMapping.bandEndFreqHz">
                        {(field) => <NumericField field={field} label="Band End" unit="Hz" />}
                    </form.Field>
                    <form.Field name="channelMapping.channelSpacingMapHz">
                        {(field) => (
                            <NumericField field={field} label="Channel Spacing" unit="Hz" />
                        )}
                    </form.Field>
                    <form.Field name="channelMapping.powerCalOffsetDb">
                        {(field) => (
                            <NumericField
                                field={field}
                                label="Power Calibration Offset"
                                unit="dB"
                                description="Maps ADC dBFS → RF dBm; tune per LNA/VGA gain"
                            />
                        )}
                    </form.Field>
                    <form.Field name="channelMapping.sidelobeDedupHz">
                        {(field) => (
                            <NumericField
                                field={field}
                                label="Sidelobe Dedup Window"
                                unit="Hz"
                                description="Merge peaks within this spacing to kill FFT sidelobes"
                            />
                        )}
                    </form.Field>
                </SettingsSection>

                <SettingsSection
                    value="powerDetection"
                    title="Power Detection (optional)"
                    description="Legacy Python-only zoom pipeline; leave disabled for the native path"
                    fieldCount={8}
                >
                    <form.Field name="powerDetection.enabled">
                        {(field) => (
                            <Field>
                                <FieldLabel className="text-xs font-medium text-muted-foreground">
                                    Enable Power Detection
                                </FieldLabel>
                                <Select
                                    value={field.state.value ? 'on' : 'off'}
                                    onValueChange={(v) => field.handleChange(v === 'on')}
                                >
                                    <SelectTrigger className="w-full">
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="off">Disabled</SelectItem>
                                        <SelectItem value="on">Enabled</SelectItem>
                                    </SelectContent>
                                </Select>
                                <FieldDescription className="text-[11px]">
                                    Optional — used only by the legacy Python reference pipeline
                                </FieldDescription>
                            </Field>
                        )}
                    </form.Field>
                    <form.Field name="powerDetection.priorKnowledgeBwHz">
                        {(field) => (
                            <NumericField field={field} label="Integration Bandwidth" unit="Hz" />
                        )}
                    </form.Field>
                    <form.Field name="powerDetection.zoomFsPowerHz">
                        {(field) => (
                            <NumericField field={field} label="Zoom Sample Rate" unit="Hz" />
                        )}
                    </form.Field>
                    <form.Field name="powerDetection.sigBwPowHz">
                        {(field) => (
                            <NumericField field={field} label="Signal Bandwidth" unit="Hz" />
                        )}
                    </form.Field>
                    <form.Field name="powerDetection.maxThPow">
                        {(field) => <NumericField field={field} label="Peak Threshold" />}
                    </form.Field>
                    <form.Field name="powerDetection.kaiserBetaPow">
                        {(field) => <NumericField field={field} label="Kaiser Beta" />}
                    </form.Field>
                    <form.Field name="powerDetection.noiseMinPeaksPow">
                        {(field) => <NumericField field={field} label="Noise Min Peaks" />}
                    </form.Field>
                    <form.Field name="powerDetection.noiseMaxDiffPow">
                        {(field) => <NumericField field={field} label="Noise Max Diff" unit="dB" />}
                    </form.Field>
                </SettingsSection>

                <SettingsSection
                    value="localization"
                    title="Localization"
                    description="Transmitter position estimation from multi-controller power readings"
                    fieldCount={9}
                >
                    <form.Field name="localization.algorithm">
                        {(field) => (
                            <Field>
                                <FieldLabel className="text-xs font-medium text-muted-foreground">
                                    Algorithm
                                </FieldLabel>
                                <Select
                                    value={field.state.value}
                                    onValueChange={(v: 'fourCircle' | 'annulus') =>
                                        field.handleChange(v)
                                    }
                                >
                                    <SelectTrigger className="w-full">
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="annulus">
                                            Annulus Intersection
                                        </SelectItem>
                                        <SelectItem value="fourCircle">
                                            Four-Circle Intersection
                                        </SelectItem>
                                    </SelectContent>
                                </Select>
                                <FieldDescription className="text-[11px]">
                                    Annulus is more robust with noisy data
                                </FieldDescription>
                            </Field>
                        )}
                    </form.Field>
                    <form.Field name="localization.pathLossExponent">
                        {(field) => (
                            <NumericField
                                field={field}
                                label="Path Loss Exponent"
                                description="Typically 2-4; higher = more attenuation"
                            />
                        )}
                    </form.Field>
                    <form.Field name="localization.ptSearchRangeMinDbm">
                        {(field) => <NumericField field={field} label="Tx Power Min" unit="dBm" />}
                    </form.Field>
                    <form.Field name="localization.ptSearchRangeMaxDbm">
                        {(field) => <NumericField field={field} label="Tx Power Max" unit="dBm" />}
                    </form.Field>
                    <form.Field name="localization.ptSearchStepDbm">
                        {(field) => <NumericField field={field} label="Tx Power Step" unit="dBm" />}
                    </form.Field>
                    <form.Field name="localization.powerErrorRangeDb">
                        {(field) => (
                            <NumericField
                                field={field}
                                label="Power Error Range"
                                unit="dB"
                                description="Expected measurement uncertainty"
                            />
                        )}
                    </form.Field>
                    <form.Field name="localization.channelBinHz">
                        {(field) => (
                            <NumericField
                                field={field}
                                label="Channel Bin"
                                unit="Hz"
                                description="Grid used to group measurements by frequency"
                            />
                        )}
                    </form.Field>
                    <form.Field name="localization.minControllersPerChannel">
                        {(field) => (
                            <NumericField
                                field={field}
                                label="Min Controllers / Channel"
                                description="Minimum receivers observing a channel to localize"
                            />
                        )}
                    </form.Field>
                    <form.Field name="localization.minPeakDbm">
                        {(field) => (
                            <NumericField
                                field={field}
                                label="Min Peak Power"
                                unit="dBm"
                                description="Reject channels whose strongest reading is weaker"
                            />
                        )}
                    </form.Field>
                </SettingsSection>
            </Accordion>

            <Separator className="mt-2" />

            <div className="flex items-center justify-end gap-3 pt-4">
                <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={isResetPending}
                    onClick={async () => {
                        await onReset()
                    }}
                >
                    <RotateCcwIcon />
                    {isResetPending ? 'Resetting...' : 'Reset to Defaults'}
                </Button>
                <form.Subscribe selector={(s) => [s.canSubmit, s.isDirty] as const}>
                    {([canSubmit, isDirty]) => (
                        <Button
                            type="submit"
                            size="sm"
                            disabled={!canSubmit || !isDirty || isPending}
                        >
                            <SaveIcon />
                            {isPending ? 'Saving...' : 'Save Changes'}
                        </Button>
                    )}
                </form.Subscribe>
            </div>
        </form>
    )
}
