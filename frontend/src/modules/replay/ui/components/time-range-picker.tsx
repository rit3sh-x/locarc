import { ClockIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'

interface TimeRangePickerProps {
    startHour: number
    startMinute: number
    endHour: number
    endMinute: number
    onChange: (v: {
        startHour: number
        startMinute: number
        endHour: number
        endMinute: number
    }) => void
}

const pad = (n: number) => String(n).padStart(2, '0')

const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n))

export const TimeRangePicker = ({
    startHour,
    startMinute,
    endHour,
    endMinute,
    onChange,
}: TimeRangePickerProps): React.JSX.Element => {
    return (
        <Popover>
            <PopoverTrigger asChild>
                <Button variant="outline" className="justify-start gap-2 font-normal">
                    <ClockIcon className="size-4" />
                    {pad(startHour)}:{pad(startMinute)} – {pad(endHour)}:{pad(endMinute)}
                </Button>
            </PopoverTrigger>
            <PopoverContent className="w-64">
                <div className="grid gap-3">
                    <div className="grid grid-cols-2 gap-2">
                        <div>
                            <Label className="text-xs">Start H</Label>
                            <Input
                                type="number"
                                min={0}
                                max={23}
                                value={startHour}
                                onChange={(e) =>
                                    onChange({
                                        startHour: clamp(Number(e.target.value) || 0, 0, 23),
                                        startMinute,
                                        endHour,
                                        endMinute,
                                    })
                                }
                            />
                        </div>
                        <div>
                            <Label className="text-xs">Start M</Label>
                            <Input
                                type="number"
                                min={0}
                                max={59}
                                value={startMinute}
                                onChange={(e) =>
                                    onChange({
                                        startHour,
                                        startMinute: clamp(Number(e.target.value) || 0, 0, 59),
                                        endHour,
                                        endMinute,
                                    })
                                }
                            />
                        </div>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                        <div>
                            <Label className="text-xs">End H</Label>
                            <Input
                                type="number"
                                min={0}
                                max={23}
                                value={endHour}
                                onChange={(e) =>
                                    onChange({
                                        startHour,
                                        startMinute,
                                        endHour: clamp(Number(e.target.value) || 0, 0, 23),
                                        endMinute,
                                    })
                                }
                            />
                        </div>
                        <div>
                            <Label className="text-xs">End M</Label>
                            <Input
                                type="number"
                                min={0}
                                max={59}
                                value={endMinute}
                                onChange={(e) =>
                                    onChange({
                                        startHour,
                                        startMinute,
                                        endHour,
                                        endMinute: clamp(Number(e.target.value) || 0, 0, 59),
                                    })
                                }
                            />
                        </div>
                    </div>
                </div>
            </PopoverContent>
        </Popover>
    )
}
