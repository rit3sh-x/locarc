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
}: ViewControllerModalProps): React.JSX.Element => (
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
                <FieldDisplay label="Latitude" value={controller.latitude.toFixed(6)} />
                <FieldDisplay label="Longitude" value={controller.longitude.toFixed(6)} />
                <FieldDisplay
                    label="Min Frequency"
                    value={`${(controller.settings.minFreqHz / 1_000_000).toFixed(2)} MHz`}
                />
                <FieldDisplay
                    label="Max Frequency"
                    value={`${(controller.settings.maxFreqHz / 1_000_000).toFixed(2)} MHz`}
                />
                <FieldDisplay label="Sample Rate" value={`${controller.settings.sampleRate} Hz`} />
                <FieldDisplay label="VGA Gain" value={`${controller.settings.vgaGain} dB`} />
                <FieldDisplay label="LNA Gain" value={`${controller.settings.lnaGain} dB`} />
                <FieldDisplay label="Buffer Size" value={`${controller.settings.bufferSize} KB`} />
            </div>
        </DialogContent>
    </Dialog>
)

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
            latitude: controller.latitude,
            longitude: controller.longitude,
            settings: {
                minFreqHz: controller.settings.minFreqHz,
                maxFreqHz: controller.settings.maxFreqHz,
                sampleRate: controller.settings.sampleRate,
                vgaGain: controller.settings.vgaGain,
                lnaGain: controller.settings.lnaGain,
                bufferSize: controller.settings.bufferSize,
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

                    <div className="grid grid-cols-2 gap-4">
                        <form.Field name="latitude">
                            {(f) => {
                                const isInvalid = !!f.state.meta.isTouched && !f.state.meta.isValid
                                return (
                                    <Field data-invalid={isInvalid}>
                                        <FieldLabel>Latitude</FieldLabel>
                                        <Input
                                            type="number"
                                            step="any"
                                            value={f.state.value}
                                            onBlur={f.handleBlur}
                                            onChange={(e) => f.handleChange(toFloat(e))}
                                            placeholder="Latitude"
                                        />
                                        {isInvalid && <FieldError errors={f.state.meta.errors} />}
                                    </Field>
                                )
                            }}
                        </form.Field>
                        <form.Field name="longitude">
                            {(f) => {
                                const isInvalid = !!f.state.meta.isTouched && !f.state.meta.isValid
                                return (
                                    <Field data-invalid={isInvalid}>
                                        <FieldLabel>Longitude</FieldLabel>
                                        <Input
                                            type="number"
                                            step="any"
                                            value={f.state.value}
                                            onBlur={f.handleBlur}
                                            onChange={(e) => f.handleChange(toFloat(e))}
                                            placeholder="Longitude"
                                        />
                                        {isInvalid && <FieldError errors={f.state.meta.errors} />}
                                    </Field>
                                )
                            }}
                        </form.Field>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                        <form.Field name="settings.minFreqHz">
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
                                            placeholder="e.g., 1000000"
                                        />
                                        {isInvalid && <FieldError errors={f.state.meta.errors} />}
                                    </Field>
                                )
                            }}
                        </form.Field>
                        <form.Field name="settings.maxFreqHz">
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
                                            placeholder="e.g., 6000000000"
                                        />
                                        {isInvalid && <FieldError errors={f.state.meta.errors} />}
                                    </Field>
                                )
                            }}
                        </form.Field>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                        <form.Field name="settings.sampleRate">
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
                                            placeholder="Sample rate"
                                        />
                                        {isInvalid && <FieldError errors={f.state.meta.errors} />}
                                    </Field>
                                )
                            }}
                        </form.Field>
                        <form.Field name="settings.bufferSize">
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
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                        <form.Field name="settings.vgaGain">
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
                        <form.Field name="settings.lnaGain">
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

type AddControllerModalProps = {
    open: boolean
    onOpenChange: (v: boolean) => void
    onSubmit: (data: AddControllerFormValues) => void
    isPending?: boolean
}

export function AddControllerModal({
    open,
    onOpenChange,
    onSubmit,
    isPending,
}: AddControllerModalProps): React.JSX.Element {
    const form = useForm({
        defaultValues: {
            name: '',
            username: '',
            password: '',
            latitude: 0,
            longitude: 0,
            settings: {
                minFreqHz: 1000000,
                maxFreqHz: 6000000000,
                sampleRate: 2000000,
                vgaGain: 0,
                lnaGain: 0,
                bufferSize: 1024,
            },
        },
        validators: { onSubmit: addControllerSchema },
        onSubmit: async ({ value }) => {
            await onSubmit(value)
        },
    })

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

                    <div className="grid grid-cols-2 gap-4">
                        <form.Field name="latitude">
                            {(f) => {
                                const isInvalid = !!f.state.meta.isTouched && !f.state.meta.isValid
                                return (
                                    <Field data-invalid={isInvalid}>
                                        <FieldLabel>Latitude</FieldLabel>
                                        <Input
                                            type="number"
                                            step="any"
                                            value={f.state.value}
                                            onBlur={f.handleBlur}
                                            onChange={(e) => f.handleChange(toFloat(e))}
                                            placeholder="Latitude"
                                        />
                                        {isInvalid && <FieldError errors={f.state.meta.errors} />}
                                    </Field>
                                )
                            }}
                        </form.Field>
                        <form.Field name="longitude">
                            {(f) => {
                                const isInvalid = !!f.state.meta.isTouched && !f.state.meta.isValid
                                return (
                                    <Field data-invalid={isInvalid}>
                                        <FieldLabel>Longitude</FieldLabel>
                                        <Input
                                            type="number"
                                            step="any"
                                            value={f.state.value}
                                            onBlur={f.handleBlur}
                                            onChange={(e) => f.handleChange(toFloat(e))}
                                            placeholder="Longitude"
                                        />
                                        {isInvalid && <FieldError errors={f.state.meta.errors} />}
                                    </Field>
                                )
                            }}
                        </form.Field>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                        <form.Field name="settings.minFreqHz">
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
                                            placeholder="e.g., 1000000"
                                        />
                                        {isInvalid && <FieldError errors={f.state.meta.errors} />}
                                    </Field>
                                )
                            }}
                        </form.Field>
                        <form.Field name="settings.maxFreqHz">
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
                                            placeholder="e.g., 6000000000"
                                        />
                                        {isInvalid && <FieldError errors={f.state.meta.errors} />}
                                    </Field>
                                )
                            }}
                        </form.Field>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                        <form.Field name="settings.sampleRate">
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
                                            placeholder="Sample rate"
                                        />
                                        {isInvalid && <FieldError errors={f.state.meta.errors} />}
                                    </Field>
                                )
                            }}
                        </form.Field>
                        <form.Field name="settings.bufferSize">
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
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                        <form.Field name="settings.vgaGain">
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
                        <form.Field name="settings.lnaGain">
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
