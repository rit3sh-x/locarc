import { CalendarIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Calendar } from '@/components/ui/calendar'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import { REPLAY_WINDOW_DAYS } from '../../constants'
import type { DateRange } from '../../types'

interface DateRangePickerProps {
    range: DateRange
    onChange: (range: DateRange) => void
}

const formatRange = (range: DateRange): string => {
    if (!range.from) return 'Pick date range'
    const from = range.from.toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
    })
    if (!range.to) return from
    const to = range.to.toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
    })
    return `${from} – ${to}`
}

export const DateRangePicker = ({ range, onChange }: DateRangePickerProps): React.JSX.Element => {
    const today = new Date()
    const minDate = new Date()
    minDate.setDate(today.getDate() - REPLAY_WINDOW_DAYS)
    minDate.setHours(0, 0, 0, 0)

    return (
        <Popover>
            <PopoverTrigger asChild>
                <Button
                    variant="outline"
                    className={cn(
                        'justify-start gap-2 text-left font-normal',
                        !range.from && 'text-muted-foreground',
                    )}
                >
                    <CalendarIcon className="size-4" />
                    {formatRange(range)}
                </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
                <Calendar
                    mode="range"
                    selected={range as { from: Date; to?: Date }}
                    onSelect={(r) =>
                        onChange({
                            from: r?.from ?? undefined,
                            to: r?.to ?? undefined,
                        })
                    }
                    disabled={{ before: minDate, after: today }}
                    numberOfMonths={2}
                    defaultMonth={range.from ?? minDate}
                />
            </PopoverContent>
        </Popover>
    )
}
