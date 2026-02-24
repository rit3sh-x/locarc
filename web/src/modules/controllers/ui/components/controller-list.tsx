"use client";

import { useGetControllers } from "../../hooks/use-controllers";
import { ControllerCard } from "./controller-card";
import { InfiniteScrollTrigger } from "@/components/ui/infinite-scroll-trigger";
import { Skeleton } from "@/components/ui/skeleton";
import { CONTROLLERS_PAGE_SIZE } from "../../constants";
import type { Controller } from "../../types";

interface ControllerListProps {
    onView?: (controller: Controller) => void;
    onEdit?: (controller: Controller) => void;
    onDelete?: (controller: Controller) => void;
}

export const ControllerList = ({
    onView,
    onEdit,
    onDelete,
}: ControllerListProps): React.JSX.Element => {
    const { results, status, loadMore } = useGetControllers();

    const hasNextPage = status === "CanLoadMore";
    const isFetchingNextPage = status === "LoadingMore";
    const isFetchingFirstPage = status === "LoadingFirstPage";

    if (isFetchingFirstPage) return <ControllerListSkeleton />;

    return (
        <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {results.map((controller) => (
                    <ControllerCard
                        key={controller.id}
                        controller={controller}
                        onView={onView}
                        onEdit={onEdit}
                        onDelete={onDelete}
                    />
                ))}
            </div>

            <InfiniteScrollTrigger
                canLoadMore={hasNextPage}
                isLoadingMore={isFetchingNextPage}
                onLoadMore={() => loadMore(CONTROLLERS_PAGE_SIZE)}
                noMoreText="No more controllers to load"
            />
        </div>
    );
};

export const ControllerListSkeleton = (): React.JSX.Element => {
    return (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="p-4 border border-border rounded-lg">
                    <div className="flex items-center gap-3">
                        <Skeleton className="h-4 w-1/3" />
                        <Skeleton className="h-4 w-10" />
                    </div>
                    <Skeleton className="h-3 w-1/2 mt-2" />
                    <Skeleton className="h-3 w-1/2 mt-2" />
                    <Skeleton className="h-3 w-1/2 mt-2" />
                </div>
            ))}
        </div>
    );
};
