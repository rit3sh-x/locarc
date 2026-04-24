import { useEffect, useMemo } from 'react'
import { useForm } from '@tanstack/react-form'
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
    DialogFooter,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Field, FieldError, FieldLabel } from '@/components/ui/field'
import { editControllerSchema, addControllerSchema } from '../../schema'
import type { Controller, AddControllerInput, ModifyControllerInput } from '../../types'

const toFloat = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = parseFloat(e.target.value)
    return isNaN(v) ? 0 : v
}

type ViewControllerModalProps = {
    open: boolean
    onOpenChange: (v: boolean) => void
    controller: Controller
}

export const ViewControllerModal = ({
    open,
    onOpenChange,
    controller,
}: ViewControllerModalProps): React.JSX.Element => {
    const hasValidCoordinates = controller.latitude !== -1 && controller.longitude !== -1

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-3xl">
                <DialogHeader>
                    <DialogTitle>Controller Details</DialogTitle>
                    <DialogDescription>
                        View the controller profile and radio configuration details.
                    </DialogDescription>
                </DialogHeader>
                <div className="grid grid-cols-2 gap-4">
                    <FieldDisplay label="Name" value={controller.name} />
                    <FieldDisplay label="Username" value={controller.username} />
                    {hasValidCoordinates && (
                        <>
                            <FieldDisplay label="Latitude" value={controller.latitude.toFixed(6)} />
                            <FieldDisplay
                                label="Longitude"
                                value={controller.longitude.toFixed(6)}
                            />
                        </>
                    )}
                    <FieldDisplay
                        label="Min Frequency"
                        value={`${(controller.settings.minFrequencyHz / 1_000_000).toFixed(3)} MHz`}
                    />
                    <FieldDisplay
                        label="Max Frequency"
                        value={`${(controller.settings.maxFrequencyHz / 1_000_000).toFixed(3)} MHz`}
                    />
                    <FieldDisplay
                        label="Sample Rate"
                        value={`${(controller.settings.sampleRateHz / 1_000_000).toFixed(3)} MHz`}
                    />
                    <FieldDisplay label="VGA Gain" value={`${controller.settings.vgaGainDb} dB`} />
                    <FieldDisplay label="LNA Gain" value={`${controller.settings.lnaGainDb} dB`} />
                    <FieldDisplay
                        label="Buffer Size"
                        value={`${controller.settings.bufferSizeKb} KB`}
                    />
                    {controller.settings.powerCalOffsetDbOverride !== undefined && (
                        <FieldDisplay
                            label="Power Cal Offset (override)"
                            value={`${controller.settings.powerCalOffsetDbOverride} dB`}
                        />
                    )}
                </div>
            </DialogContent>
        </Dialog>
    )
}

const FieldDisplay = ({ label, value }: { label: string; value?: string | number }) => (
    <div className="flex flex-col gap-1">
        <span className="text-xs text-muted-foreground">{label}</span>
        <span className="text-sm font-medium">{value ?? '—'}</span>
    </div>
)

export type EditControllerFormValues = Omit<ModifyControllerInput, 'controllerId'>

type EditControllerModalProps = {
    open: boolean
    onOpenChange: (v: boolean) => void
    controller: Controller
    onSubmit: (data: EditControllerFormValues) => void
    isPending?: boolean
}

export function EditControllerModal({
    open,
    onOpenChange,
    controller,
    onSubmit,
    isPending,
}: EditControllerModalProps): React.JSX.Element {
    const form = useForm({
        defaultValues: {
            name: controller.name,
            username: controller.username,
            password: '',
            settings: {
                minFrequencyHz: controller.settings.minFrequencyHz,
                maxFrequencyHz: controller.settings.maxFrequencyHz,
                sampleRateHz: controller.settings.sampleRateHz,
                lnaGainDb: controller.settings.lnaGainDb,
                vgaGainDb: controller.settings.vgaGainDb,
                bufferSizeKb: controller.settings.bufferSizeKb,
                powerCalOffsetDbOverride: controller.settings.powerCalOffsetDbOverride,
            },
        },
        validators: { onSubmit: editControllerSchema },
        onSubmit: async ({ value }) => {
            const { username, password, ...rest } = value
            const submitData: EditControllerFormValues = { ...rest }
            if (username) submitData.username = username
            if (password) submitData.password = password
            onSubmit(submitData)
        },
    })

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>Edit Controller</DialogTitle>
                    <DialogDescription>
                        Update the controller details and save the changes.
                    </DialogDescription>
                </DialogHeader>
                <form
                    onSubmit={(e) => {
                        e.preventDefault()
                        form.handleSubmit()
                    }}
                    className="space-y-4"
                >
                    <form.Field name="name">
                        {(f) => {
                            const isInvalid = !!f.state.meta.isTouched && !f.state.meta.isValid
                            return (
                                <Field data-invalid={isInvalid}>
                                    <FieldLabel>Name</FieldLabel>
                                    <Input
                                        type="text"
                                        value={f.state.value}
                                        onBlur={f.handleBlur}
                                        onChange={(e) => f.handleChange(e.target.value)}
                                        placeholder="Controller name"
                                    />
                                    {isInvalid && <FieldError errors={f.state.meta.errors} />}
                                </Field>
                            )
                        }}
                    </form.Field>

                    <form.Field name="username">
                        {(f) => {
                            const isInvalid = !!f.state.meta.isTouched && !f.state.meta.isValid
                            return (
                                <Field data-invalid={isInvalid}>
                                    <FieldLabel>Username (optional)</FieldLabel>
                                    <Input
                                        type="text"
                                        value={f.state.value}
                                        onBlur={f.handleBlur}
                                        onChange={(e) => f.handleChange(e.target.value)}
                                        placeholder="New username"
                                    />
                                    {isInvalid && <FieldError errors={f.state.meta.errors} />}
                                </Field>
                            )
                        }}
                    </form.Field>

                    <form.Field name="password">
                        {(f) => {
                            const isInvalid = !!f.state.meta.isTouched && !f.state.meta.isValid
                            return (
                                <Field data-invalid={isInvalid}>
                                    <FieldLabel>Password (optional)</FieldLabel>
                                    <Input
                                        type="password"
                                        value={f.state.value}
                                        onBlur={f.handleBlur}
                                        onChange={(e) => f.handleChange(e.target.value)}
                                        placeholder="New password"
                                    />
                                    {isInvalid && <FieldError errors={f.state.meta.errors} />}
                                </Field>
                            )
                        }}
                    </form.Field>

                    <form.Field name="settings.minFrequencyHz">
                        {(f) => {
                            const isInvalid = !!f.state.meta.isTouched && !f.state.meta.isValid
                            return (
                                <Field data-invalid={isInvalid}>
                                    <FieldLabel>Min Frequency (Hz)</FieldLabel>
                                    <Input
                                        type="number"
                                        value={f.state.value}
                                        onBlur={f.handleBlur}
                                        onChange={(e) => f.handleChange(toFloat(e))}
                                        placeholder="e.g. 400000000"
                                    />
                                    {isInvalid && <FieldError errors={f.state.meta.errors} />}
                                </Field>
                            )
                        }}
                    </form.Field>
                    <form.Field name="settings.maxFrequencyHz">
                        {(f) => {
                            const isInvalid = !!f.state.meta.isTouched && !f.state.meta.isValid
                            return (
                                <Field data-invalid={isInvalid}>
                                    <FieldLabel>Max Frequency (Hz)</FieldLabel>
                                    <Input
                                        type="number"
                                        value={f.state.value}
                                        onBlur={f.handleBlur}
                                        onChange={(e) => f.handleChange(toFloat(e))}
                                        placeholder="e.g. 440000000"
                                    />
                                    {isInvalid && <FieldError errors={f.state.meta.errors} />}
                                </Field>
                            )
                        }}
                    </form.Field>
                    <form.Field name="settings.sampleRateHz">
                        {(f) => {
                            const isInvalid = !!f.state.meta.isTouched && !f.state.meta.isValid
                            return (
                                <Field data-invalid={isInvalid}>
                                    <FieldLabel>Sample Rate (Hz)</FieldLabel>
                                    <Input
                                        type="number"
                                        value={f.state.value}
                                        onBlur={f.handleBlur}
                                        onChange={(e) => f.handleChange(toFloat(e))}
                                        placeholder="e.g. 10000000"
                                    />
                                    {isInvalid && <FieldError errors={f.state.meta.errors} />}
                                </Field>
                            )
                        }}
                    </form.Field>

                    <div className="grid grid-cols-2 gap-4">
                        <form.Field name="settings.vgaGainDb">
                            {(f) => {
                                const isInvalid = !!f.state.meta.isTouched && !f.state.meta.isValid
                                return (
                                    <Field data-invalid={isInvalid}>
                                        <FieldLabel>VGA Gain (0-62 dB, step 2)</FieldLabel>
                                        <Input
                                            type="number"
                                            value={f.state.value}
                                            onBlur={f.handleBlur}
                                            onChange={(e) => f.handleChange(toFloat(e))}
                                            placeholder="VGA gain"
                                        />
                                        {isInvalid && <FieldError errors={f.state.meta.errors} />}
                                    </Field>
                                )
                            }}
                        </form.Field>
                        <form.Field name="settings.lnaGainDb">
                            {(f) => {
                                const isInvalid = !!f.state.meta.isTouched && !f.state.meta.isValid
                                return (
                                    <Field data-invalid={isInvalid}>
                                        <FieldLabel>LNA Gain (0, 8, 16, 24, 32, 40)</FieldLabel>
                                        <Input
                                            type="number"
                                            value={f.state.value}
                                            onBlur={f.handleBlur}
                                            onChange={(e) => f.handleChange(toFloat(e))}
                                            placeholder="LNA gain"
                                        />
                                        {isInvalid && <FieldError errors={f.state.meta.errors} />}
                                    </Field>
                                )
                            }}
                        </form.Field>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                        <form.Field name="settings.bufferSizeKb">
                            {(f) => {
                                const isInvalid = !!f.state.meta.isTouched && !f.state.meta.isValid
                                return (
                                    <Field data-invalid={isInvalid}>
                                        <FieldLabel>Buffer Size (KB)</FieldLabel>
                                        <Input
                                            type="number"
                                            value={f.state.value}
                                            onBlur={f.handleBlur}
                                            onChange={(e) => f.handleChange(toFloat(e))}
                                            placeholder="Buffer size"
                                        />
                                        {isInvalid && <FieldError errors={f.state.meta.errors} />}
                                    </Field>
                                )
                            }}
                        </form.Field>
                        <form.Field name="settings.powerCalOffsetDbOverride">
                            {(f) => {
                                const isInvalid = !!f.state.meta.isTouched && !f.state.meta.isValid
                                const raw = f.state.value
                                return (
                                    <Field data-invalid={isInvalid}>
                                        <FieldLabel>Power Cal Offset (dB, per-device)</FieldLabel>
                                        <Input
                                            type="number"
                                            step="any"
                                            value={raw ?? ''}
                                            onBlur={f.handleBlur}
                                            onChange={(e) => {
                                                const v = e.target.value
                                                f.handleChange(v === '' ? undefined : Number(v))
                                            }}
                                            placeholder="Blank = use org default"
                                        />
                                        {isInvalid && <FieldError errors={f.state.meta.errors} />}
                                    </Field>
                                )
                            }}
                        </form.Field>
                    </div>

                    <DialogFooter>
                        <form.Subscribe selector={(s) => s.canSubmit}>
                            {(canSubmit) => (
                                <Button
                                    type="submit"
                                    disabled={!canSubmit || isPending}
                                    className="w-full"
                                >
                                    {isPending ? 'Saving...' : 'Save Changes'}
                                </Button>
                            )}
                        </form.Subscribe>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    )
}

export type AddControllerFormValues = AddControllerInput

type AddControllerInitialValues = Omit<Partial<AddControllerFormValues>, 'settings'> & {
    settings?: Partial<AddControllerFormValues['settings']>
}

const DEFAULT_ADD_CONTROLLER_VALUES: AddControllerFormValues = {
    name: '',
    username: '',
    password: '',
    settings: {
        minFrequencyHz: 400_000_000,
        maxFrequencyHz: 440_000_000,
        sampleRateHz: 10_000_000,
        lnaGainDb: 0,
        vgaGainDb: 0,
        bufferSizeKb: 1024,
    },
}

type AddControllerModalProps = {
    open: boolean
    onOpenChange: (v: boolean) => void
    onSubmit: (data: AddControllerFormValues) => void
    isPending?: boolean
    initialValues?: AddControllerInitialValues
}

export function AddControllerModal({
    open,
    onOpenChange,
    onSubmit,
    isPending,
    initialValues,
}: AddControllerModalProps): React.JSX.Element {
    const mergedDefaultValues = useMemo<AddControllerFormValues>(() => {
        return {
            ...DEFAULT_ADD_CONTROLLER_VALUES,
            ...initialValues,
            settings: {
                ...DEFAULT_ADD_CONTROLLER_VALUES.settings,
                ...initialValues?.settings,
            },
        }
    }, [initialValues])

    const form = useForm({
        defaultValues: mergedDefaultValues,
        validators: { onSubmit: addControllerSchema },
        onSubmit: async ({ value }) => {
            await onSubmit(value)
        },
    })

    useEffect(() => {
        if (open) {
            form.reset(mergedDefaultValues)
        }
    }, [form, open, mergedDefaultValues])

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>Create Controller</DialogTitle>
                    <DialogDescription>
                        Add a new controller and set its configuration.
                    </DialogDescription>
                </DialogHeader>
                <form
                    onSubmit={(e) => {
                        e.preventDefault()
                        form.handleSubmit()
                    }}
                    className="space-y-4"
                >
                    <form.Field name="name">
                        {(f) => {
                            const isInvalid = !!f.state.meta.isTouched && !f.state.meta.isValid
                            return (
                                <Field data-invalid={isInvalid}>
                                    <FieldLabel>Name</FieldLabel>
                                    <Input
                                        type="text"
                                        value={f.state.value}
                                        onBlur={f.handleBlur}
                                        onChange={(e) => f.handleChange(e.target.value)}
                                        placeholder="Controller name"
                                    />
                                    {isInvalid && <FieldError errors={f.state.meta.errors} />}
                                </Field>
                            )
                        }}
                    </form.Field>

                    <form.Field name="username">
                        {(f) => {
                            const isInvalid = !!f.state.meta.isTouched && !f.state.meta.isValid
                            return (
                                <Field data-invalid={isInvalid}>
                                    <FieldLabel>Username</FieldLabel>
                                    <Input
                                        type="text"
                                        value={f.state.value}
                                        onBlur={f.handleBlur}
                                        onChange={(e) => f.handleChange(e.target.value)}
                                        placeholder="Username"
                                    />
                                    {isInvalid && <FieldError errors={f.state.meta.errors} />}
                                </Field>
                            )
                        }}
                    </form.Field>

                    <form.Field name="password">
                        {(f) => {
                            const isInvalid = !!f.state.meta.isTouched && !f.state.meta.isValid
                            return (
                                <Field data-invalid={isInvalid}>
                                    <FieldLabel>Password</FieldLabel>
                                    <Input
                                        type="password"
                                        value={f.state.value}
                                        onBlur={f.handleBlur}
                                        onChange={(e) => f.handleChange(e.target.value)}
                                        placeholder="Password"
                                    />
                                    {isInvalid && <FieldError errors={f.state.meta.errors} />}
                                </Field>
                            )
                        }}
                    </form.Field>

                    <form.Field name="settings.minFrequencyHz">
                        {(f) => {
                            const isInvalid = !!f.state.meta.isTouched && !f.state.meta.isValid
                            return (
                                <Field data-invalid={isInvalid}>
                                    <FieldLabel>Min Frequency (Hz)</FieldLabel>
                                    <Input
                                        type="number"
                                        value={f.state.value}
                                        onBlur={f.handleBlur}
                                        onChange={(e) => f.handleChange(toFloat(e))}
                                        placeholder="e.g. 400000000"
                                    />
                                    {isInvalid && <FieldError errors={f.state.meta.errors} />}
                                </Field>
                            )
                        }}
                    </form.Field>
                    <form.Field name="settings.maxFrequencyHz">
                        {(f) => {
                            const isInvalid = !!f.state.meta.isTouched && !f.state.meta.isValid
                            return (
                                <Field data-invalid={isInvalid}>
                                    <FieldLabel>Max Frequency (Hz)</FieldLabel>
                                    <Input
                                        type="number"
                                        value={f.state.value}
                                        onBlur={f.handleBlur}
                                        onChange={(e) => f.handleChange(toFloat(e))}
                                        placeholder="e.g. 440000000"
                                    />
                                    {isInvalid && <FieldError errors={f.state.meta.errors} />}
                                </Field>
                            )
                        }}
                    </form.Field>
                    <form.Field name="settings.sampleRateHz">
                        {(f) => {
                            const isInvalid = !!f.state.meta.isTouched && !f.state.meta.isValid
                            return (
                                <Field data-invalid={isInvalid}>
                                    <FieldLabel>Sample Rate (Hz)</FieldLabel>
                                    <Input
                                        type="number"
                                        value={f.state.value}
                                        onBlur={f.handleBlur}
                                        onChange={(e) => f.handleChange(toFloat(e))}
                                        placeholder="e.g. 10000000"
                                    />
                                    {isInvalid && <FieldError errors={f.state.meta.errors} />}
                                </Field>
                            )
                        }}
                    </form.Field>

                    <div className="grid grid-cols-2 gap-4">
                        <form.Field name="settings.vgaGainDb">
                            {(f) => {
                                const isInvalid = !!f.state.meta.isTouched && !f.state.meta.isValid
                                return (
                                    <Field data-invalid={isInvalid}>
                                        <FieldLabel>VGA Gain (0-62 dB, step 2)</FieldLabel>
                                        <Input
                                            type="number"
                                            value={f.state.value}
                                            onBlur={f.handleBlur}
                                            onChange={(e) => f.handleChange(toFloat(e))}
                                            placeholder="VGA gain"
                                        />
                                        {isInvalid && <FieldError errors={f.state.meta.errors} />}
                                    </Field>
                                )
                            }}
                        </form.Field>
                        <form.Field name="settings.lnaGainDb">
                            {(f) => {
                                const isInvalid = !!f.state.meta.isTouched && !f.state.meta.isValid
                                return (
                                    <Field data-invalid={isInvalid}>
                                        <FieldLabel>LNA Gain (0, 8, 16, 24, 32, 40)</FieldLabel>
                                        <Input
                                            type="number"
                                            value={f.state.value}
                                            onBlur={f.handleBlur}
                                            onChange={(e) => f.handleChange(toFloat(e))}
                                            placeholder="LNA gain"
                                        />
                                        {isInvalid && <FieldError errors={f.state.meta.errors} />}
                                    </Field>
                                )
                            }}
                        </form.Field>
                    </div>

                    <form.Field name="settings.bufferSizeKb">
                        {(f) => {
                            const isInvalid = !!f.state.meta.isTouched && !f.state.meta.isValid
                            return (
                                <Field data-invalid={isInvalid}>
                                    <FieldLabel>Buffer Size (KB)</FieldLabel>
                                    <Input
                                        type="number"
                                        value={f.state.value}
                                        onBlur={f.handleBlur}
                                        onChange={(e) => f.handleChange(toFloat(e))}
                                        placeholder="Buffer size"
                                    />
                                    {isInvalid && <FieldError errors={f.state.meta.errors} />}
                                </Field>
                            )
                        }}
                    </form.Field>

                    <DialogFooter>
                        <form.Subscribe selector={(s) => s.canSubmit}>
                            {(canSubmit) => (
                                <Button
                                    type="submit"
                                    disabled={!canSubmit || isPending}
                                    className="w-full"
                                >
                                    {isPending ? 'Creating...' : 'Create Controller'}
                                </Button>
                            )}
                        </form.Subscribe>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    )
}
