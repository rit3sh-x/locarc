import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Loader2Icon, CircleIcon, SquareIcon } from 'lucide-react'
import { useToggle } from '../../hooks/use-map'
import { Skeleton } from '@/components/ui/skeleton'

interface ToggleButtonProps {
    started: boolean
}

export const ToggleButton = ({ started }: ToggleButtonProps): React.JSX.Element => {
    const { toggle, isPending } = useToggle()

    return (
        <Button
            onClick={() => toggle(started)}
            disabled={isPending}
            aria-label={started ? 'Stop recording' : 'Start recording'}
            className={cn(
                'h-12 w-36 gap-2 rounded-full shadow-xl font-medium pointer-events-auto transition-all',
                isPending && 'opacity-70 cursor-not-allowed',
                started
                    ? 'bg-red-600 text-white hover:bg-red-700'
                    : 'bg-background text-foreground border border-border hover:bg-muted',
            )}
        >
            {isPending ? (
                <Loader2Icon className="h-4 w-4 animate-spin" />
            ) : started ? (
                <CircleIcon className="h-4 w-4 fill-white text-white animate-pulse" />
            ) : (
                <SquareIcon className="h-4 w-4" />
            )}
            <span>{isPending ? 'Updating...' : started ? 'Recording' : 'Stopped'}</span>
        </Button>
    )
}

export const ToggleButtonSkeleton = (): React.JSX.Element => {
    return <Skeleton className="h-12 w-36 rounded-full shadow-xl" />
}
