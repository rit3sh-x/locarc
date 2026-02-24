import { requireAdmin } from "@/lib/auth-utils";
import { MapView, MapViewSkeleton } from "@/modules/map/ui/views/map-view";
import { Suspense } from "react";

const Page = async (): Promise<React.JSX.Element> => {
    await requireAdmin();

    return (
        <div className="flex-1 w-full h-full">
            <Suspense fallback={<MapViewSkeleton />}>
                <MapView />
            </Suspense>
        </div>
    );
};

export default Page;
