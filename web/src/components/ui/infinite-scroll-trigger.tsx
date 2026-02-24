import { useEffect, useRef } from "react";
import { Button } from "./button";
import { cn } from "@/lib/utils";

interface InfiniteScrollTriggerProps {
    canLoadMore: boolean;
    isLoadingMore: boolean;
    onLoadMore: () => void;
    noMoreText?: string;
    className?: string;
    loadMoreText?: string;
    useIntersectionObserver?: boolean;
}

export const InfiniteScrollTrigger = ({
    canLoadMore,
    isLoadingMore,
    onLoadMore,
    noMoreText = "",
    className,
    loadMoreText = "Load more",
    useIntersectionObserver = true,
}: InfiniteScrollTriggerProps) => {
    const triggerRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!useIntersectionObserver || !canLoadMore || isLoadingMore) return;

        const observer = new IntersectionObserver(
            ([entry]) => {
                if (entry?.isIntersecting) {
                    onLoadMore();
                }
            },
            { threshold: 0.2 }
        );

        const element = triggerRef.current;
        if (element) observer.observe(element);

        return () => {
            if (element) observer.unobserve(element);
        };
    }, [canLoadMore, isLoadingMore, onLoadMore, useIntersectionObserver]);

    let text = loadMoreText;
    if (isLoadingMore) text = "Loading...";
    else if (!canLoadMore) text = noMoreText;

    return (
        <div
            className={cn("flex w-full justify-center py-2", className)}
            ref={triggerRef}
        >
            <Button
                disabled={!canLoadMore || isLoadingMore}
                onClick={onLoadMore}
                size="sm"
                variant="ghost"
            >
                {text}
            </Button>
        </div>
    );
};
