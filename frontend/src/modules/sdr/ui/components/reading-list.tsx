import { ReadingCard } from './reading-card'
import { InfiniteScrollTrigger } from '@/components/infinite-scroll-trigger'
import { Skeleton } from '@/components/ui/skeleton'
import { SDR_PAGE_SIZE } from '../../constants'
import { useSdrReadings } from '../../hooks/use-sdr'
import type { Id } from '@backend/dataModel'
import type { SdrReading } from '../../types'
import { RadioIcon } from 'lucide-react'

interface ReadingListProps {
    controllerId: Id<'controller'> | undefined
    onView?: (reading: SdrReading) => void
}

export const ReadingList = ({ controllerId, onView }: ReadingListProps): React.JSX.Element => {
    const { results, status, loadMore } = useSdrReadings(controllerId)

    const hasNextPage = status === 'CanLoadMore'
    const isFetchingNextPage = status === 'LoadingMore'
    const isFetchingFirstPage = status === 'LoadingFirstPage'

    if (isFetchingFirstPage) return <ReadingListSkeleton />

    if (results.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center py-16 text-center text-muted-foreground gap-2">
                <RadioIcon className="size-10 opacity-50" />
                <div className="font-medium">No SDR readings yet</div>
                <div className="text-xs max-w-sm">
                    Readings appear here when controllers submit measurements. Older than 1 day are
                    auto-pruned.
                </div>
            </div>
        )
    }

    return (
        <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {results.map((reading) => (
                    <ReadingCard key={reading.id} reading={reading} onView={onView} />
                ))}
            </div>

            <InfiniteScrollTrigger
                canLoadMore={hasNextPage}
                isLoadingMore={isFetchingNextPage}
                onLoadMore={() => loadMore(SDR_PAGE_SIZE)}
                noMoreText="No more readings to load"
            />
        </div>
    )
}

export const ReadingListSkeleton = (): React.JSX.Element => {
    return (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="p-4 border border-border rounded-lg space-y-3">
                    <div className="flex items-center justify-between">
                        <Skeleton className="h-4 w-1/2" />
                        <Skeleton className="h-5 w-16" />
                    </div>
                    <Skeleton className="h-3 w-1/3" />
                    <div className="grid grid-cols-2 gap-2">
                        <Skeleton className="h-3 w-full" />
                        <Skeleton className="h-3 w-full" />
                        <Skeleton className="h-3 w-full" />
                        <Skeleton className="h-3 w-full" />
                    </div>
                    <Skeleton className="h-3 w-2/3" />
                </div>
            ))}
        </div>
    )
}
